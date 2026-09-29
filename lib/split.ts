// How much the partner owes for one bill. Pure and exact: integer cents in, integer cents out.
//
// Each item is the payer's own, split equally, or the partner's in full. A discount belongs to
// the item directly above it and takes its share. Fees (surcharges) are shared in proportion to
// the value of the split and partner items. Special cases, as agreed with the owner:
//   every item split   -> half the receipt total (taxes and fees included)
//   every item partner -> the whole receipt total
// (the sum of all lines stands in when no total was read). Rounded half-up, once per bill.
import type { LineKind } from "./receipt";

export type Share = "payer" | "split" | "partner";
export type SplitLine = { price_cents: number; kind: LineKind; share?: Share | null };

// Round a non-negative fraction num/den half-up, exactly.
const roundHalfUp = (num: number, den: number) => Math.floor((2 * num + den) / (2 * den));

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
