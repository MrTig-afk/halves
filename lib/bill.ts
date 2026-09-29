// A bill the browser asks to save, and the ONLY way that request becomes data. Everything is
// untrusted: the lines are checked exactly like model output (lib/receipt.ts), and the amount
// the partner owes is never taken from the client - the server works it out (lib/split.ts).
import { parseReceipt, ReceiptError, type LineKind, type ReceiptReading } from "./receipt";
import type { Share } from "./split";

export type BillLine = { name: string; price_cents: number; kind: LineKind; share: Share | null };
export type NewBill = {
  scan_id: string;
  partner_id: number;
  description: string;
  date: string; // YYYY-MM-DD
  total_cents: number | null;
  lines: BillLine[];
  ai: ReceiptReading | null; // the AI's original reading, kept unchanged for measuring accuracy
};

// What saving answers: the stored bill's partner, description, amount and photo state, and the tab
// with that partner just before this bill (positive = they owe me); after it is was + owes. A retry
// of a bill already saved answers with the stored values. `notified`: the partner has a phone that
// gets notifications, so "<Partner> has been notified." is true.
export type Saved = {
  duplicate: boolean;
  photo: "kept" | "not_kept_full" | "none";
  owes: number;
  partner_id: number;
  description: string;
  was: number;
  notified: boolean;
};

export class BillError extends Error {}

// A whole bill stays under $100,000, which keeps the split arithmetic exact in a JS number.
export const MAX_BILL_CENTS = 10_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHARES = ["payer", "split", "partner"];

export function parseBill(raw: string): NewBill {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw);
  } catch {
    throw new BillError("not JSON");
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new BillError("not an object");
  const { scan_id, partner_id, description, date, total_cents, lines, ai } = o;
  if (typeof scan_id !== "string" || !UUID.test(scan_id)) throw new BillError("scan id");
  if (typeof partner_id !== "number" || !Number.isInteger(partner_id) || partner_id < 1) throw new BillError("partner");
  if (typeof date !== "string" || !date) throw new BillError("date");
  if (!Array.isArray(lines)) throw new BillError("lines");

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

  const shares = lines.map((l: { share?: unknown }, i) => {
    const kind = checked.lines[i].kind;
    if (kind === "item") {
      if (!SHARES.includes(l.share as string)) throw new BillError(`line ${i + 1} share`);
      return l.share as Share;
    }
    return null; // discounts follow their item and fees are shared in proportion
  });

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
    partner_id,
    description: checked.store_name,
    date: checked.date,
    total_cents: checked.total_cents,
    lines: checked.lines.map((l, i) => ({ ...l, share: shares[i] })),
    ai: reading,
  };
}
