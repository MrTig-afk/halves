// POST /api/bill - multipart "bill" (JSON, see lib/bill.ts) + optional "photo" (the cropped
// receipt) -> the bill is saved, immutably, and what each person owes is returned.
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
import { owes as split } from "@/lib/split";
import { tabs } from "@/lib/tab";

export const maxDuration = 30;

// $8 = every person on the bill with what they owe ([{ person_id, owes }], the payer at 0), $12 =
// the lines with who had each item. No bill row exists unless every person is a real one.
const SAVE = `
  with ppl as (select x.person_id, x.owes from jsonb_to_recordset($8::jsonb) as x(person_id bigint, owes int)),
  ok as (select 1 where (select count(*) from person where id in (select person_id from ppl)) = (select count(*) from ppl)),
  b as (
    insert into bill (payer_id, added_by, description, bill_date, receipt_total_cents, total_cents, ai_items, photo_state, typed,
                      date_edited_at, total_edited_at)
    select $3, $2, $4, $5::date, $6, $7, $9::jsonb,
           case when $10::text is null then 'none'
                when pg_database_size(current_database()) < $11 then 'kept' else 'not_kept_full' end,
           $13, case when $14::boolean then now() end, case when $15::boolean then now() end
    from ok returning id, photo_state
  ),
  s as (insert into scan_request (scan_id, person_id, bill_id) select $1, $2, b.id from b returning 1),
  bp as (
    insert into bill_person (bill_id, person_id, owes_cents, settled_at)
    select b.id, ppl.person_id, ppl.owes, case when ppl.person_id <> $3::bigint and ppl.owes = 0 then now() end from b, ppl returning 1
  ),
  l as (
    insert into line_item (bill_id, position, name, price_cents, kind)
    select b.id, x.position, x.name, x.price_cents, x.kind
    from b, jsonb_to_recordset($12::jsonb) as x(position int, name text, price_cents int, kind text)
    returning id, position
  ),
  lp as (
    insert into line_item_person (line_item_id, person_id)
    select l.id, w.person_id::bigint
    from l join jsonb_to_recordset($12::jsonb) as x(position int, people jsonb) on x.position = l.position
    cross join lateral jsonb_array_elements_text(x.people) as w(person_id)
    returning 1
  ),
  ph as (
    insert into receipt_photo (bill_id, jpeg, byte_size)
    select b.id, j.bytes, octet_length(j.bytes) from b, (select decode($10, 'base64') as bytes) j
    where b.photo_state = 'kept'
    returning 1
  )
  select (select id::int from b) as id, (select photo_state from b) as photo_state,
         -- my tab with each other person before this bill: the statement's snapshot does not see its own inserts
         (select coalesce(jsonb_agg(jsonb_build_object('person_id', o.person_id, 'was',
                   (select coalesce(sum(case when x.payer_id = $2::bigint then q.owes_cents else -q.owes_cents end), 0)::int
                    from bill_person q join bill x on x.id = q.bill_id
                    where q.settlement_id is null and q.owes_cents > 0
                      and ((x.payer_id = $2::bigint and q.person_id = o.person_id) or (x.payer_id = o.person_id and q.person_id = $2::bigint))))
                 order by o.person_id), '[]'::jsonb)
          from ppl o where o.person_id <> $2::bigint) as tabs`;

// The bill's people in name order: it breaks a one-cent tie (PRD 6.3), so the server decides it, not the phone.
const NAMES = "select id::int as id from person where id = any($1::bigint[]) order by lower(name), id";

// The bill a scan id already saved, for this adder only: its people and what each owes.
const STORED = `
  select b.payer_id::int as payer_id, b.description, b.total_cents, to_char(b.bill_date, 'YYYY-MM-DD') as date, b.photo_state as photo,
         (select coalesce(jsonb_agg(jsonb_build_object('person_id', q.person_id, 'owes', q.owes_cents) order by q.person_id), '[]'::jsonb)
          from bill_person q where q.bill_id = b.id) as people
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
  // Every name travels twice (the edited lines and the AI's original reading); ~200 chars of JSON per line besides.
  const maxChars = 2 * MAX_LINES * (MAX_NAME + 200) + 10_000;
  const raw = form.get("bill");
  const photo = form.get("photo");
  if (typeof raw !== "string" || raw.length > maxChars) return fail(400, "bad_request", "Nothing was sent.");

  let bill: NewBill;
  try {
    bill = parseBill(raw);
  } catch (e) {
    if (e instanceof BillError) return fail(400, "bad_bill", e.user ?? "Something on this bill isn't right. Check the lines and try again.");
    throw e;
  }
  if (!bill.people.includes(me.id)) return fail(400, "bad_bill", "Pick who this bill is with."); // before any image work
  const named = await query<{ id: number }>(NAMES, [bill.people], me.id);
  if (named.length !== bill.people.length) return fail(400, "bad_bill", "Pick who this bill is with."); // an unknown person
  let jpeg: Buffer | null = null;
  try {
    if (photo instanceof Blob && !bill.typed) jpeg = await normaliseImage(Buffer.from(await photo.arrayBuffer()));
  } catch (e) {
    // The cropper's own JPEG already passed this check when it was read; a photo that fails it
    // now is left out and the bill still saves.
    if (!(e instanceof ImageError)) throw e;
  }

  // What each person owes, worked out here from the lines; name order breaks a one-cent tie.
  const owed = split(bill.lines, named.map((n) => n.id), bill.payer_id, bill.total_cents);
  const people = bill.people.map((p) => ({ person_id: p, owes: owed[p] }));
  const shares = people.filter((p) => p.person_id !== bill.payer_id);
  const total = bill.total_cents ?? bill.lines.reduce((s, l) => s + l.price_cents, 0);
  const others = bill.people.filter((p) => p !== me.id);
  const pushes = new Map(others.map((p) => [p, hasPush(p)])); // never throws; runs alongside the save
  let saved: Saved;
  let told: number[];
  try {
    const [r] = await query<{ id: number | null; photo_state: Saved["photo"]; tabs: Saved["tabs"] }>(
      SAVE,
      [
        bill.scan_id,
        me.id,
        bill.payer_id,
        bill.description,
        bill.date,
        bill.total_cents,
        total,
        JSON.stringify(people),
        bill.ai ? JSON.stringify(bill.ai) : null,
        jpeg ? jpeg.toString("base64") : null,
        PHOTO_CAP_BYTES,
        JSON.stringify(bill.lines.map((l, i) => ({ position: i + 1, ...l, people: l.people ?? [] }))),
        bill.typed,
        bill.edited.date,
        bill.edited.total,
      ],
      me.id,
    );
    if (r.id === null) return fail(400, "bad_bill", "Pick who this bill is with.");
    const adder = firstName(me.name);
    for (const p of others) {
      notifyLater(p, { title: p === bill.payer_id ? `${adder} added a bill you paid` : `${adder} added a bill`, url: `/bill/${r.id}` });
    }
    told = others;
    saved = { duplicate: false, same: true, photo: r.photo_state, description: bill.description, total_cents: total, date: bill.date, payer_id: bill.payer_id, shares, tabs: r.tabs, notified: [] };
  } catch (e) {
    const err = e as { code?: string; constraint?: string };
    if (err.code !== "23505" || err.constraint !== "scan_request_pkey") throw e;
    const [stored] = await query<{ payer_id: number; description: string; total_cents: number; date: string; photo: Saved["photo"]; people: { person_id: number; owes: number }[] }>(
      STORED,
      [bill.scan_id, me.id],
      me.id,
    );
    // A scan id used by the other person is refused.
    if (!stored) return fail(409, "conflict", "This bill couldn't be saved. Scan it again.");
    const storedShares = stored.people.filter((p) => p.person_id !== stored.payer_id);
    const mine = new Map((await tabs(me.id)).map((t) => [t.partner_id, t.balance]));
    // Today's balance minus this bill's effect on it (accepted: a share settled since is still taken off).
    const was = (p: number) => (mine.get(p) ?? 0) - (stored.payer_id === me.id ? (storedShares.find((s) => s.person_id === p)?.owes ?? 0) : stored.payer_id === p ? -(storedShares.find((s) => s.person_id === me.id)?.owes ?? 0) : 0);
    // Compared here, where both bills are normalised the same way.
    const key = (xs: { person_id: number; owes: number }[]) => xs.map((x) => `${x.person_id}:${x.owes}`).sort().join();
    const same =
      stored.description === bill.description &&
      stored.total_cents === total &&
      stored.date === bill.date &&
      stored.payer_id === bill.payer_id &&
      key(stored.people) === key(people);
    told = stored.people.map((p) => p.person_id).filter((p) => p !== me.id);
    saved = {
      duplicate: true,
      same,
      photo: stored.photo,
      description: stored.description,
      total_cents: stored.total_cents,
      date: stored.date,
      payer_id: stored.payer_id,
      shares: storedShares.map((s) => ({ person_id: s.person_id, owes: s.owes })),
      tabs: told.map((p) => ({ person_id: p, was: was(p) })),
      notified: [],
    };
  }
  const has = await Promise.all(told.map((p) => pushes.get(p) ?? hasPush(p)));
  saved.notified = told.filter((_, i) => has[i]);
  console.info(JSON.stringify({ event: saved.duplicate ? "bill_duplicate" : "bill_saved", lines: bill.lines.length, photo: saved.photo }));
  return Response.json(saved);
}
