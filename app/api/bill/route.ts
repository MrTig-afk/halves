// POST /api/bill - multipart "bill" (JSON, see lib/bill.ts) + optional "photo" (the cropped
// receipt) -> the bill is saved, immutably, and the tab with that partner is returned.
// One SQL statement does all of it, so a bill is saved whole or not at all. The scan id is the
// key: a retried save hits it, the whole statement rolls back, and the answer is the bill that
// was stored the first time - never a second bill, never the retry's edits.
import { query } from "@/lib/db";
import { BillError, parseBill, type NewBill, type Saved } from "@/lib/bill";
import { fail } from "@/lib/http";
import { ImageError, MAX_UPLOAD_BYTES, normaliseImage } from "@/lib/image";
import { firstName } from "@/lib/names";
import { PHOTO_CAP_BYTES } from "@/lib/photos";
import { MAX_LINES, MAX_NAME } from "@/lib/receipt";
import { hasPush, notifyLater } from "@/lib/push";
import { currentPerson } from "@/lib/session";
import { partnerOwes } from "@/lib/split";
import { tabs } from "@/lib/tab";

export const maxDuration = 30;

const SAVE = `
  with p as (select id from person where id = $3 and id <> $2),
  b as (
    insert into bill (payer_id, partner_id, description, bill_date, receipt_total_cents, total_cents,
                      partner_owes_cents, ai_items, photo_state, typed)
    select $2, $3, $4, $5::date, $6, $7, $8, $9::jsonb,
           case when $10::text is null then 'none'
                when pg_database_size(current_database()) < $11 then 'kept' else 'not_kept_full' end,
           $13
    from p returning id, photo_state
  ),
  s as (insert into scan_request (scan_id, person_id, bill_id) select $1, $2, b.id from b returning 1),
  l as (
    insert into line_item (bill_id, position, name, price_cents, kind, share)
    select b.id, x.position, x.name, x.price_cents, x.kind, x.share
    from b, jsonb_to_recordset($12::jsonb) as x(position int, name text, price_cents int, kind text, share text)
    returning 1
  ),
  ph as (
    insert into receipt_photo (bill_id, jpeg, byte_size)
    select b.id, j.bytes, octet_length(j.bytes) from b, (select decode($10, 'base64') as bytes) j
    where b.photo_state = 'kept'
    returning 1
  )
  select (select id::int from b) as id, (select photo_state from b) as photo_state,
         -- the tab before this bill: the statement's snapshot does not see its own inserts
         (select coalesce(sum(case when payer_id = $2 then partner_owes_cents else -partner_owes_cents end), 0)::int
          from bill where settlement_id is null
            and ((payer_id = $2 and partner_id = $3) or (payer_id = $3 and partner_id = $2))) as was`;

// The bill a scan id already saved, for this payer only.
const STORED = `
  select b.partner_id::int as partner_id, b.partner_owes_cents as owes, b.description, b.total_cents,
         to_char(b.bill_date, 'YYYY-MM-DD') as date, b.photo_state as photo
  from scan_request s join bill b on b.id = s.bill_id
  where s.scan_id = $1 and s.person_id = $2`;

export async function POST(req: Request) {
  const me = await currentPerson();
  if (!me) return fail(401, "signed_out", "Sign in again to save this bill.");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 256 * 1024) return fail(413, "too_large", "That bill is too big to save.");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "bad_request", "Nothing was sent.");
  }
  // Every name travels twice (the edited lines and the AI's original reading); ~100 chars of JSON per line besides.
  const maxChars = 2 * MAX_LINES * (MAX_NAME + 100) + 10_000;
  const raw = form.get("bill");
  const photo = form.get("photo");
  if (typeof raw !== "string" || raw.length > maxChars) return fail(400, "bad_request", "Nothing was sent.");

  let bill: NewBill;
  try {
    bill = parseBill(raw);
  } catch (e) {
    if (e instanceof BillError) return fail(400, "bad_bill", "Something on this bill isn't right. Check the lines and try again.");
    throw e;
  }
  if (bill.partner_id === me.id) return fail(400, "bad_bill", "Pick who this bill is with."); // before any image work
  let jpeg: Buffer | null = null;
  try {
    if (photo instanceof Blob && !bill.typed) jpeg = await normaliseImage(Buffer.from(await photo.arrayBuffer()));
  } catch (e) {
    // The cropper's own JPEG already passed this check when it was read; a photo that fails it
    // now is left out and the bill still saves.
    if (!(e instanceof ImageError)) throw e;
  }

  const owes = partnerOwes(bill.lines, bill.total_cents);
  const total = bill.total_cents ?? bill.lines.reduce((s, l) => s + l.price_cents, 0);
  const partnerPush = hasPush(bill.partner_id); // never throws; runs alongside the save
  let saved: Saved;
  try {
    const [r] = await query<{ id: number | null; photo_state: Saved["photo"]; was: number }>(SAVE, [
      bill.scan_id,
      me.id,
      bill.partner_id,
      bill.description,
      bill.date,
      bill.total_cents,
      total,
      owes,
      bill.ai ? JSON.stringify(bill.ai) : null,
      jpeg ? jpeg.toString("base64") : null,
      PHOTO_CAP_BYTES,
      JSON.stringify(bill.lines.map((l, i) => ({ position: i + 1, ...l }))),
      bill.typed,
    ]);
    if (r.id === null) return fail(400, "bad_bill", "Pick who this bill is with.");
    notifyLater(bill.partner_id, { title: `${firstName(me.name)} added a bill`, url: `/bill/${r.id}` });
    saved = { duplicate: false, photo: r.photo_state, owes, partner_id: bill.partner_id, description: bill.description, total_cents: total, date: bill.date, same: true, was: r.was, notified: false };
  } catch (e) {
    const err = e as { code?: string; constraint?: string };
    if (err.code !== "23505" || err.constraint !== "scan_request_pkey") throw e;
    const [stored] = await query<Omit<Saved, "duplicate" | "same" | "was" | "notified">>(STORED, [bill.scan_id, me.id]);
    // A scan id used by the other person is refused.
    if (!stored) return fail(409, "conflict", "This bill couldn't be saved. Scan it again.");
    const balance = (await tabs(me.id)).find((t) => t.partner_id === stored.partner_id)?.balance ?? 0;
    // Compared here, where both bills are normalised the same way.
    const same = stored.description === bill.description && stored.total_cents === total && stored.date === bill.date && stored.partner_id === bill.partner_id && stored.owes === owes;
    saved = { duplicate: true, ...stored, same, was: balance - stored.owes, notified: false };
  }
  saved.notified = await (saved.partner_id === bill.partner_id ? partnerPush : hasPush(saved.partner_id));
  console.info(JSON.stringify({ event: saved.duplicate ? "bill_duplicate" : "bill_saved", lines: bill.lines.length, photo: saved.photo }));
  return Response.json(saved);
}
