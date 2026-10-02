import { describe, expect, it } from "vitest";
import { breakdown, eachCents, owes, partnerOwes, type Share, type SplitLine } from "./split";

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

  it("splits a bill without a receipt (one line, its amount as the total): half rounds up, or all of it", () => {
    const typed = (share: Share): SplitLine[] => [{ price_cents: 2401, kind: "item", share }];
    expect(partnerOwes(typed("split"), 2401)).toBe(1201);
    expect(partnerOwes(typed("partner"), 2401)).toBe(2401);
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

// People K=1 (pays), P=2, R=3, S=4. Coles line indexes: 0 milk, 1 bread, 2 bananas, 3 protein bar,
// 4 chicken (5 its discount), 6 shampoo, 7 eggs, 8 coffee, 9 the fee. Items not named are Everyone.
const [K, P, R, S] = [1, 2, 3, 4];
const colesFor = (people: number[], sets: Record<number, number[]>, fallback: number[] = people): SplitLine[] =>
  coles({}).map((l, i) => ({ price_cents: l.price_cents, kind: l.kind, people: l.kind === "item" ? (sets[i] ?? fallback) : null }));
const two = [K, P];
const three = [K, P, R];
const four = [K, P, R, S];
const item = (price_cents: number, people: number[]): SplitLine => ({ price_cents, kind: "item", people });

describe("owes", () => {
  it("never throws on a half-typed amount in a live preview", () => {
    expect(() => partnerOwes([{ price_cents: 12.5, kind: "item", share: "split" }], null)).not.toThrow();
    expect(() => owes([item(9_007_199_254_740.5, [P])], [K, P], K, null)).not.toThrow();
  });

  it("never makes the others owe more than the bill: a cent comes off, later name first on a tie", () => {
    // K paid and had none of it: 1001 between P and R would round to 501 + 501.
    expect(owes([item(1001, [P, R])], [K, P, R], K, 1001)).toEqual({ [K]: 0, [P]: 501, [R]: 500 });
    expect(owes([item(1001, [P, R])], [K, R, P], K, 1001)).toEqual({ [K]: 0, [R]: 501, [P]: 500 }); // the order decides
    // 3 cents, everyone of five: 4 x 1 cent would be 4; the last one owes 0.
    const five = [K, P, R, S, 5];
    const tiny = owes([item(3, five)], five, K, 3);
    expect(tiny).toEqual({ [K]: 0, [P]: 1, [R]: 1, [S]: 1, 5: 0 });
    // the one rounded up most pays, not simply the last name: exact 2.75 / 0.50 / 2.75 -> 3 / 1 / 3 is 7 on a bill of 6
    const fee = [item(1, [P, R, S]), item(3, [P, S]), { price_cents: 2, kind: "surcharge" as const }];
    expect(owes(fee, [K, P, R, S], K, null)).toEqual({ [K]: 0, [P]: 3, [R]: 0, [S]: 3 });
    // a discount bigger than its item: R's share is below 0, so P's share is the whole bill, not more
    const credit = [item(500, [P]), item(100, [R]), { price_cents: -300, kind: "discount" as const }];
    expect(owes(credit, [K, P, R], K, 300)).toEqual({ [K]: 0, [P]: 300, [R]: 0 });
    // positive control: when nothing over-collects, nobody is touched
    expect(owes([item(1000, [P, R])], [K, P, R], K, 1000)).toEqual({ [K]: 0, [P]: 500, [R]: 500 });
  });

  const every = (who: number) => colesFor(two, Object.fromEntries([0, 1, 2, 3, 4, 6, 7, 8].map((i) => [i, [who]])));
  it.each([
    ["milk, bread, bananas, chicken, eggs both", colesFor(two, { 3: [K], 6: [K], 8: [K] }), 1440],
    ["the voice example: 1, 2, 5, eggs both, coffee P's", colesFor(two, { 2: [K], 3: [K], 6: [K], 8: [P] }), 2085],
    ["everything Everyone", colesFor(two, {}), 2497],
    ["everything P's", every(P), 4994],
    ["everything K's", every(K), 0],
  ])("matches the v2.3 sample - %s", (_label, lines, cents) => {
    expect(owes(lines, two, K, 4994)[P]).toBe(cents);
  });

  it("splits a bill without a receipt: half rounds up, or all of it", () => {
    expect(owes([item(2401, two)], two, K, 2401)[P]).toBe(1201);
    expect(owes([item(2401, [P])], two, K, 2401)[P]).toBe(2401);
  });

  it("uses the sum of the lines when no total was read", () => {
    expect(owes(colesFor(two, {}), two, K, null)[P]).toBe(2497);
  });

  it("rounds half a cent up, once per bill", () => {
    expect(owes([item(101, two)], two, K, 101)[P]).toBe(51);
    expect(owes([item(101, two), item(101, two), item(101, two), item(100, [K])], two, K, null)[P]).toBe(152);
  });

  it("gives a discount to the item above it, whatever that item's set", () => {
    const lines: SplitLine[] = [item(1000, [P]), { price_cents: -300, kind: "discount" }, item(500, [K])];
    expect(owes(lines, two, K, 1200)[P]).toBe(700);
  });

  it("shares a fee in proportion", () => {
    const lines: SplitLine[] = [item(1000, two), item(1000, [K]), { price_cents: 100, kind: "surcharge" }];
    expect(owes(lines, two, K, 2100)[P]).toBe(525);
  });

  it("returns 0 with nothing to divide", () => {
    expect(owes([], two, K, null)).toEqual({ [K]: 0, [P]: 0 });
    expect(owes([{ price_cents: 35, kind: "surcharge" }], two, K, 35)).toEqual({ [K]: 0, [P]: 0 });
  });

  it("three people, everything Everyone: the total in three", () => {
    expect(owes(colesFor(three, {}), three, K, 4994)).toEqual({ [K]: 0, [P]: 1665, [R]: 1665 });
  });

  it("three people: protein bar and shampoo K's, coffee R's, the rest Everyone", () => {
    const o = owes(colesFor(three, { 3: [K], 6: [K], 8: [R] }), three, K, 4994);
    expect(o).toEqual({ [K]: 0, [P]: 960, [R]: 1816 });
  });

  it("four people, mixed sets", () => {
    const lines = colesFor(four, { 0: [K, P], 1: [P, R], 2: [K, R], 3: [K], 4: [P, R, S], 6: [P], 7: four, 8: [S] });
    const o = owes(lines, four, K, 4994);
    expect(o).toEqual({ [K]: 0, [P]: 1796, [R]: 944, [S]: 1363 });
    expect(4994 - o[P] - o[R] - o[S]).toBe(891);
  });

  it("someone else paid", () => {
    expect(owes([item(3800, two)], two, P, 3800)).toEqual({ [K]: 1900, [P]: 0 });
  });

  it("is exact at the cap (no float drift)", () => {
    const five = [1, 2, 3, 4, 5];
    const big = owes([item(10_000_000, three)], five, 1, 10_000_000);
    expect(Object.values(big).every(Number.isInteger)).toBe(true);
    expect(big[2] + big[3]).toBe(6_666_666);
    const fee = owes([item(9_999_999, three), { price_cents: 1, kind: "surcharge" }], five, 1, 10_000_000);
    expect(Object.values(fee).every(Number.isInteger)).toBe(true);
    expect(fee[2] + fee[3]).toBeLessThanOrEqual(10_000_000); // the payer absorbs the rest, never a negative
    expect(fee[2]).toBe(3_333_333);
  });

  it("one person had everything (not the payer): the whole read total, else the lines' sum", () => {
    expect(owes(colesFor(two, {}, [P]), two, K, 5000)[P]).toBe(5000);
    expect(owes(colesFor(three, {}, [R]), three, K, 5000)).toEqual({ [K]: 0, [P]: 0, [R]: 5000 });
    expect(owes(colesFor(three, {}, [R]), three, K, null)[R]).toBe(4994);
  });

  it("owes nothing when the payer had everything", () => {
    expect(owes(colesFor(three, {}, [K]), three, K, 4994)).toEqual({ [K]: 0, [P]: 0, [R]: 0 });
  });
});

const case9 = colesFor(three, { 3: [K], 6: [K], 8: [R] });
const case10 = colesFor(four, { 0: [K, P], 1: [P, R], 2: [K, R], 3: [K], 4: [P, R, S], 6: [P], 7: four, 8: [S] });

describe("breakdown", () => {
  it("P in the three-person bill: five parts, a fee, no rounding", () => {
    expect(breakdown(case9, three, K, 4994, P)).toEqual({
      parts: [103, 150, 140, 333, 227].map((cents, i) => ({ line: [0, 1, 2, 4, 7][i], cents, n: 3 })),
      fee: 7,
      rounding: 0,
      total: 960,
    });
  });

  it("R in the four-person bill: rounding of -1", () => {
    const b = breakdown(case10, four, K, 4994, R);
    expect(b.parts.map((x) => x.cents)).toEqual([225, 210, 333, 170]);
    expect(b.parts.map((x) => x.n)).toEqual([2, 2, 3, 4]);
    expect(b.fee).toBe(7);
    expect(b.rounding).toBe(-1);
    expect(b.total).toBe(944);
  });
});

describe("owes and breakdown edges (tester)", () => {
  const disc = (price_cents: number): SplitLine => ({ price_cents, kind: "discount" });
  it("a bill whose items sum to nothing or less owes nothing, never a negative", () => {
    const lines = [item(100, [P]), disc(-300), item(50, [K])]; // V = -150
    expect(owes(lines, two, K, null)).toEqual({ [K]: 0, [P]: 0 });
    expect(owes([item(100, [P]), disc(-300)], two, K, -200)).toEqual({ [K]: 0, [P]: 0 });
  });

  it("a discount larger than its item makes that person's own value negative, clamped at 0", () => {
    const lines = [item(500, [K]), item(100, [P]), disc(-300)]; // V = 300, P value -200
    expect(owes(lines, two, K, 300)[P]).toBe(0);
  });

  it("breakdown rounds a negative part half up toward +infinity and shows the gap as Rounding", () => {
    const lines = [item(100, two), disc(-201), item(500, [K])]; // value -101, set of 2
    expect(breakdown(lines, two, K, null, P)).toEqual({ parts: [{ line: 0, cents: -50, n: 2 }], fee: null, rounding: 50, total: 0 });
  });

  it("eachCents of a line that is not an item is 0", () => {
    expect(eachCents(case9, 5)).toBe(0);
    expect(eachCents(case9, 99)).toBe(0);
  });
});

describe("eachCents", () => {
  it("is the item over its set size, discounts included, half up", () => {
    expect(eachCents(case9, 0)).toBe(103); // milk 310 / 3
    expect(eachCents(case9, 4)).toBe(333); // chicken 1200 - 200 over 3
  });
});
