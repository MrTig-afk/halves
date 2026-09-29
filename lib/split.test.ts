import { describe, expect, it } from "vitest";
import { partnerOwes, type Share, type SplitLine } from "./split";

// The master Artifact's sample receipt (Coles, total $49.94).
const coles = (shares: Record<number, Share>): SplitLine[] => {
  const raw: [number, SplitLine["kind"]][] = [
    [310, "item"], [450, "item"], [419, "item"], [350, "item"], [1200, "item"],
    [-200, "discount"], [900, "item"], [680, "item"], [850, "item"], [35, "surcharge"],
  ];
  return raw.map(([price_cents, kind], i) => ({ price_cents, kind, share: kind === "item" ? (shares[i] ?? "payer") : null }));
};
const all = (s: Share) => coles(Object.fromEntries([0, 1, 2, 3, 4, 6, 7, 8].map((i) => [i, s])));

describe("partnerOwes", () => {
  it.each([
    ["milk, bread, bananas, chicken, eggs split", coles({ 0: "split", 1: "split", 2: "split", 4: "split", 7: "split" }), 1440],
    ["the voice example: 1, 2, 5, eggs split, coffee Priya's", coles({ 0: "split", 1: "split", 4: "split", 7: "split", 8: "partner" }), 2085],
    ["everything split: half the receipt total", all("split"), 2497],
    ["everything Priya's: the whole receipt total", all("partner"), 4994],
    ["everything mine: nothing", all("payer"), 0],
  ])("matches the Artifact sample - %s", (_label, lines, cents) => {
    expect(partnerOwes(lines, 4994)).toBe(cents);
  });

  it("uses the sum of the lines when no total was read", () => {
    expect(partnerOwes(all("partner"), null)).toBe(4994);
    expect(partnerOwes(all("split"), null)).toBe(2497);
  });

  it("rounds half a cent up, once per bill", () => {
    expect(partnerOwes([{ price_cents: 101, kind: "item", share: "split" }], 101)).toBe(51); // 50.5 -> 51
    // three odd halves would drift by 3 cents if each were rounded; once per bill it is 1
    const three: SplitLine[] = [101, 101, 101].map((p) => ({ price_cents: p, kind: "item", share: "split" }));
    three.push({ price_cents: 100, kind: "item", share: "payer" });
    expect(partnerOwes(three, null)).toBe(152); // 303 / 2 = 151.5 -> 152
  });

  it("gives a discount to the item above it, whatever that item's share", () => {
    const lines: SplitLine[] = [
      { price_cents: 1000, kind: "item", share: "partner" },
      { price_cents: -300, kind: "discount" },
      { price_cents: 500, kind: "item", share: "payer" },
    ];
    expect(partnerOwes(lines, 1200)).toBe(700);
  });

  it("shares a fee in proportion to split and partner value", () => {
    const lines: SplitLine[] = [
      { price_cents: 1000, kind: "item", share: "split" },
      { price_cents: 1000, kind: "item", share: "payer" },
      { price_cents: 100, kind: "surcharge" },
    ];
    // half of (1000 + 100 * 1000/2000) = 525
    expect(partnerOwes(lines, 2100)).toBe(525);
  });

  it("returns 0 rather than dividing by zero or going negative", () => {
    expect(partnerOwes([], null)).toBe(0);
    expect(partnerOwes([{ price_cents: 35, kind: "surcharge" }], 35)).toBe(0);
  });
});
