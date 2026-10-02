// How much the partner owes for one bill. Pure and exact: integer cents in, integer cents out.
//
// Each item is the payer's own, split equally, or the partner's in full. A discount belongs to
// the item directly above it and takes its share. Fees (surcharges) are shared in proportion to
// the value of the split and partner items. Special cases, as agreed with the owner:
//   every item split   -> half the receipt total (taxes and fees included)
//   every item partner -> the whole receipt total
// (the sum of all lines stands in when no total was read). Rounded half-up, once per bill.
import { firstName } from "./names";
import type { LineKind } from "./receipt";

export type Share = "payer" | "split" | "partner";
// share: the two-person split (partnerOwes); people: who had an item, 2 to 5 on a bill (owes).
export type SplitLine = { price_cents: number; kind: LineKind; share?: Share | null; people?: number[] | null };

// Round num/den (den > 0) half up toward +infinity. Exact while num is a safe integer, which
// MAX_BILL_CENTS guarantees for a bill that can be saved. Plain numbers below MAX_SAFE_INTEGER
// (floor of a safe-integer division is exact); at the cap the doubling passes it, so BigInt (no 2n
// literals: ES2017 target). A non-integer (a half-typed row in a live preview) takes the plain path
// and never throws.
const roundHalfUp = (num: number, den: number) => {
  const twice = 2 * num + den;
  if (!Number.isInteger(num) || Math.abs(twice) <= Number.MAX_SAFE_INTEGER) return Math.floor(twice / (2 * den));
  const a = BigInt(num) * BigInt(2) + BigInt(den);
  const d = BigInt(den) * BigInt(2);
  let q = a / d;
  if (a % d < BigInt(0)) q -= BigInt(1); // BigInt division truncates; floor it for a negative value
  return Number(q);
};

export function partnerOwes(lines: SplitLine[], receiptTotalCents: number | null): number {
  let S = 0; // split items (with their discounts)
  let T = 0; // partner items
  let M = 0; // payer's own items
  let F = 0; // fees
  let current: Share = "payer";
  for (const l of lines) {
    if (l.kind === "surcharge") {
      F += l.price_cents;
      continue;
    }
    if (l.kind === "item") current = l.share ?? "payer";
    const v = l.price_cents; // a discount is negative and follows the item above it
    if (current === "split") S += v;
    else if (current === "partner") T += v;
    else M += v;
  }
  const items = lines.filter((l) => l.kind === "item");
  const total = receiptTotalCents ?? S + T + M + F;
  if (items.length && items.every((l) => l.share === "split")) return roundHalfUp(Math.max(total, 0), 2);
  if (items.length && items.every((l) => l.share === "partner")) return Math.max(total, 0);

  const V = S + T + M;
  if (V <= 0 || S + 2 * T <= 0) return 0;
  // (S + F*S/V)/2 + T + F*T/V  ==  (V+F)(S+2T) / 2V
  return roundHalfUp((V + F) * (S + 2 * T), 2 * V);
}

// ---- 2 to 5 people (PRD 6.3 v3.1) ----
// An item's value is its price plus the discounts directly under it; a discount takes the set of
// the item above it, a surcharge has none. Sums are kept in 60ths of a cent (60 = LCM of 1..5) so
// "value / set size" stays an integer until the single rounding per person per bill.
type Item = { line: number; value: number; set: number[] };
const unpack = (lines: SplitLine[]) => {
  const items: Item[] = [];
  let F = 0;
  lines.forEach((l, i) => {
    if (l.kind === "surcharge") F += l.price_cents;
    else if (l.kind === "item") items.push({ line: i, value: l.price_cents, set: l.people ?? [] });
    else if (items.length) items[items.length - 1].value += l.price_cents;
  });
  const V = items.reduce((s, it) => s + it.value, 0);
  const sum = lines.reduce((s, l) => s + l.price_cents, 0);
  return { items, V, F, sum };
};
const v60 = (items: Item[], p: number) =>
  items.reduce((s, it) => (it.set.includes(p) ? s + it.value * (60 / it.set.length) : s), 0);

// `people` in name order: it breaks ties when a cent has to come off (below).
export function owes(lines: SplitLine[], people: number[], payer: number, receiptTotalCents: number | null): Record<number, number> {
  const { items, V, F, sum } = unpack(lines);
  const total = Math.max(receiptTotalCents ?? sum, 0);
  const out: Record<number, number> = {};
  const up: Record<number, number> = {}; // how far each amount was rounded up, over a shared denominator
  // The bill is shared over what each person had, in 60ths; a share below 0 (a discount bigger than
  // its item) counts as 0, so the others never owe more than the bill. W = 60 V when none is.
  const W = people.reduce((s, p) => s + Math.max(v60(items, p), 0), 0);
  const first = items[0]?.set[0];
  const everyone = items.length > 0 && items.every((it) => people.every((p) => it.set.includes(p)));
  const one = items.length > 0 && first !== payer && items.every((it) => it.set.length === 1 && it.set[0] === first);
  for (const p of people) {
    if (p === payer) out[p] = 0;
    else if (everyone) {
      out[p] = roundHalfUp(total, people.length);
      up[p] = out[p] * people.length - total;
    } else if (one) out[p] = p === first ? total : 0;
    else if (V <= 0 || W <= 0) out[p] = 0;
    else {
      const num = Math.max(v60(items, p), 0) * (V + F);
      out[p] = roundHalfUp(num, W);
      up[p] = out[p] * W - num;
    }
  }
  // Half up can make the others owe more than the bill when the payer had no part of something
  // ($10.01 between two others -> 501 + 501). The one rounded up most pays a cent less; on a tie,
  // the one later in name order.
  const bill = everyone ? total : V + F;
  const owing = people.filter((p) => p !== payer);
  let over = owing.reduce((s, p) => s + out[p], 0) - bill;
  const order = owing.map((p, i) => ({ p, i })).filter((x) => (up[x.p] ?? 0) > 0).sort((a, b) => up[b.p] - up[a.p] || b.i - a.i);
  for (const { p } of order) {
    if (over <= 0) break;
    out[p]--;
    over--;
  }
  return out;
}

export type Breakdown = { parts: { line: number; cents: number; n: number }[]; fee: number | null; rounding: number; total: number };

// What one non-payer's amount is made of (Artifact B5c/B5d): their items, their share of the
// fees, and the rounding that closes the gap to owes().
export function breakdown(lines: SplitLine[], people: number[], payer: number, receiptTotalCents: number | null, person: number): Breakdown {
  const { items, V, F } = unpack(lines);
  const parts = items
    .filter((it) => it.set.includes(person))
    .map((it) => ({ line: it.line, cents: roundHalfUp(it.value, it.set.length), n: it.set.length }));
  const W = people.reduce((s, p) => s + Math.max(v60(items, p), 0), 0);
  const fee = F !== 0 && V > 0 && W > 0 ? roundHalfUp(F * Math.max(v60(items, person), 0), W) : null;
  const total = owes(lines, people, payer, receiptTotalCents)[person];
  return { parts, fee, rounding: total - parts.reduce((s, x) => s + x.cents, 0) - (fee ?? 0), total };
}

// "$X each" / "your part $X": the item at index `item` with its discounts, over its set size.
export function eachCents(lines: SplitLine[], item: number): number {
  const it = unpack(lines).items.find((x) => x.line === item);
  return it && it.set.length ? roundHalfUp(it.value, it.set.length) : 0;
}

// ---- who is on a bill (PRD 6.3 v3.2, Artifact regroup / label) ----
// The people on a bill changed: an item that was Everyone stays Everyone, anyone taken off the bill
// leaves every item, and an item left with nobody goes back to Everyone.
export function regroup(set: number[], oldPeople: number[], newPeople: number[]): number[] {
  if (set.length === oldPeople.length && oldPeople.every((p) => set.includes(p))) return newPeople.slice();
  const kept = set.filter((p) => newPeople.includes(p));
  return kept.length ? kept : newPeople.slice();
}

// "Everyone" when the set is everyone on the bill, else first names, "Me" for the signed-in person
// (people in the order given: the viewer first, then id).
export function setLabel(set: number[], people: { id: number; name: string }[], me: number): string {
  if (people.every((p) => set.includes(p.id))) return "Everyone";
  return people
    .filter((p) => set.includes(p.id))
    .map((p) => (p.id === me ? "Me" : firstName(p.name)))
    .join(", ");
}
