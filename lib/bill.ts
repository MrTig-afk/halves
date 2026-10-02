// A bill the browser asks to save, and the ONLY way that request becomes data. Everything is
// untrusted: the lines are checked exactly like model output (lib/receipt.ts), and what each person
// owes is never taken from the client - the server works it out (lib/split.ts).
import { parseReceipt, ReceiptError, type LineKind, type ReceiptReading } from "./receipt";

export type BillLine = { name: string; price_cents: number; kind: LineKind; people: number[] | null }; // people: who had an item
export type Edits = { date: boolean; total: boolean };
export type NewBill = {
  scan_id: string;
  people: number[]; // 2 to 5, the signed-in person among them, in the order the client shows them
  payer_id: number;
  description: string;
  date: string; // YYYY-MM-DD
  total_cents: number | null;
  lines: BillLine[];
  ai: ReceiptReading | null; // the AI's original reading, kept unchanged for measuring accuracy
  typed: boolean; // added without a receipt (PRD 6.3): exactly one item line above $0.00, no AI reading
  edited: Edits; // the verdict of edited(), never the raw body
};

// The body the browser sends: the lines and the people, plus whether the person changed the date / total.
export type BillBody = Omit<NewBill, "edited"> & { date_edited: boolean; total_edited: boolean };

// What saving answers: the stored bill's payer, description, total and date, every non-payer's share
// ($0 included; screens hide it), and my tab with each other person on it just before this bill
// (positive = they owe me). A retry of a bill already saved answers with the stored values.
// `notified`: the people told who have a phone that gets notifications.
export type Saved = {
  duplicate: boolean;
  same: boolean; // the stored bill is this one (false: an earlier, different bill holds the scan id)
  photo: "kept" | "not_kept_full" | "none";
  description: string;
  total_cents: number;
  date: string;
  payer_id: number;
  shares: { person_id: number; owes: number }[];
  tabs: { person_id: number; was: number }[];
  notified: number[];
};

// `user` is a message safe to show; without it the route's general one is used.
export class BillError extends Error {
  constructor(message: string, readonly user?: string) {
    super(message);
  }
}

// A whole bill stays under $100,000, which keeps the split arithmetic exact in a JS number.
export const MAX_BILL_CENTS = 10_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
const distinct = (a: number[]) => new Set(a).size === a.length;

// Whether the date / the receipt total count as edited (PRD 6.3 v3.2). When the reading had the
// value, the verdict is whether the saved one differs from it - the client's word is ignored. When it
// did not (no reading, or the field missing), only the person's word says they typed it.
export function edited(ai: ReceiptReading | null, date: string, totalCents: number | null, said: Edits): Edits {
  return {
    date: ai?.date != null ? date !== ai.date : said.date,
    total: ai?.total_cents != null ? totalCents !== ai.total_cents : said.total,
  };
}

export function parseBill(raw: string): NewBill {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw);
  } catch {
    throw new BillError("not JSON");
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new BillError("not an object");
  const { scan_id, people, payer_id, description, date, total_cents, lines, ai, typed = false } = o;
  if (typeof scan_id !== "string" || !UUID.test(scan_id)) throw new BillError("scan id");
  if (!Array.isArray(people) || !people.every(id)) throw new BillError("people");
  if (people.length < 2) throw new BillError("people", "Add at least one other person.");
  if (people.length > 5) throw new BillError("people", "A bill can have up to 5 people.");
  if (!distinct(people)) throw new BillError("people");
  if (!id(payer_id) || !people.includes(payer_id)) throw new BillError("payer");
  if (typeof date !== "string" || !date) throw new BillError("date");
  if (!Array.isArray(lines)) throw new BillError("lines");
  if (typeof typed !== "boolean") throw new BillError("typed");

  // Lines, date, description and total go through the receipt validator: same caps, same sign
  // rules, discounts only under an item, at least one item.
  let checked: ReceiptReading;
  try {
    checked = parseReceipt(
      JSON.stringify({
        store_name: description,
        date,
        total_cents: total_cents ?? null,
        lines: lines.map((l) => (l && typeof l === "object" ? { name: l.name, price_cents: l.price_cents, kind: l.kind } : l)),
      }),
    );
  } catch (e) {
    throw new BillError(e instanceof ReceiptError ? e.message : "lines");
  }
  if (!checked.store_name) throw new BillError("description");
  if (!checked.date) throw new BillError("date");
  const size = checked.lines.reduce((s, l) => s + Math.abs(l.price_cents), 0);
  if (size > MAX_BILL_CENTS) throw new BillError("bill too large"); // the total alone is capped by parseReceipt

  // Who had each item: a non-empty set of distinct people on this bill. Discounts follow their item
  // and fees are shared in proportion, so those carry none.
  const sets = lines.map((l: { people?: unknown }, i) => {
    if (checked.lines[i].kind !== "item") return null;
    const s = l.people;
    if (!Array.isArray(s) || !s.length || !s.every(id) || !distinct(s) || !s.every((p) => people.includes(p))) throw new BillError(`line ${i + 1} people`);
    return s as number[];
  });

  // A bill without a receipt is one amount above $0.00 - its line and its total - shared by at
  // least one person who did not pay (Artifact D1, D2 "Nothing to split").
  const one = checked.lines[0];
  const bad = ai != null || checked.lines.length !== 1 || one.kind !== "item" || one.price_cents <= 0 || checked.total_cents !== one.price_cents || !sets[0]?.some((p) => p !== payer_id);
  if (typed && bad) {
    throw new BillError("a bill without a receipt is one amount above $0.00, shared with someone who did not pay");
  }

  let reading: ReceiptReading | null = null;
  if (ai != null) {
    try {
      reading = parseReceipt(JSON.stringify(ai));
    } catch {
      throw new BillError("ai reading");
    }
  }
  return {
    scan_id: scan_id.toLowerCase(),
    people,
    payer_id,
    description: checked.store_name,
    date: checked.date,
    total_cents: checked.total_cents,
    lines: checked.lines.map((l, i) => ({ ...l, people: sets[i] })),
    ai: reading,
    typed,
    // A bill without a receipt never carries the tag; its date and amount do not come from one.
    edited: typed ? { date: false, total: false } : edited(reading, checked.date, checked.total_cents, { date: o.date_edited === true, total: o.total_edited === true }),
  };
}
