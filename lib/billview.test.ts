import { describe, expect, it } from "vitest";
import { breakdownView, savedView, typedFoot, typedHint } from "./billview";
import type { Saved } from "./bill";

const on = [{ id: 1, name: "Kaushik Rao" }, { id: 2, name: "Priya Shah" }, { id: 3, name: "Rahul" }];

describe("typedFoot", () => {
  it("adds up what the others owe you when you paid, and lists each", () => {
    expect(typedFoot({ 1: 0, 2: 1200, 3: 1200 }, on, 1, 1)).toEqual({ who: "Owed to you", cents: 2400, each: "Priya $12.00 · Rahul $12.00", owe: false });
  });
  it("shows what you owe the payer, in your own amount, when someone else paid", () => {
    expect(typedFoot({ 1: 1900, 2: 0 }, on.slice(0, 2), 2, 1)).toEqual({ who: "You owe Priya", cents: 1900, each: "You $19.00", owe: true });
  });
  it("is zero while nothing is owed", () => {
    expect(typedFoot({}, on.slice(0, 2), 1, 1)).toMatchObject({ cents: 0, each: "Priya $0.00" });
  });
});

describe("typedHint", () => {
  it("says who owes it all, in words that fit", () => {
    expect(typedHint([2], 1, 1, on)).toBe("Priya owes it all.");
    expect(typedHint([1], 2, 1, on)).toBe("You owe it all.");
  });
  it("splits equally between everyone ticked, the payer included", () => {
    expect(typedHint([1, 2], 1, 1, on)).toBe("Split equally between 2 people.");
    expect(typedHint([1, 2, 3], 1, 1, on)).toBe("Split equally between 3 people.");
  });
  it("says there is nothing to split when only the payer is ticked", () => {
    expect(typedHint([1], 1, 1, on)).toBe("Nothing to split: only whoever paid is ticked.");
    expect(typedHint([2], 2, 1, on)).toBe("Nothing to split: only whoever paid is ticked.");
  });
});

const names = { 2: "Priya Shah", 3: "Rahul", 4: "Sam" };
const base: Saved = { duplicate: false, same: true, photo: "kept", description: "Coles", total_cents: 4994, date: "2026-09-29", payer_id: 1, shares: [], tabs: [], notified: [] };

describe("savedView", () => {
  it("names someone missing from the names as 'your partner', never a first word of it", () => {
    const v = savedView({ ...base, shares: [{ person_id: 9, owes: 500 }], tabs: [{ person_id: 9, was: 0 }] }, names);
    expect(v.heading).toBe("Your tab with your partner");
    expect(v.rows[0].label).toBe("your partner owes you");
  });
  it("reads two people as one line, one tab and one name notified", () => {
    const v = savedView({ ...base, shares: [{ person_id: 2, owes: 1200 }], tabs: [{ person_id: 2, was: 420 }], notified: [2] }, names);
    expect(v).toEqual({ line: [{ label: "Priya owes", cents: 1200 }], heading: "Your tab with Priya", rows: [{ label: "Priya owes you", cents: 1620, owed: true, was: "was $4.20" }], notified: "Priya has been notified." });
  });
  it("drops a $0 share from the line but keeps the tab card with two people", () => {
    const v = savedView({ ...base, shares: [{ person_id: 2, owes: 0 }], tabs: [{ person_id: 2, was: 420 }] }, names);
    expect(v.line).toEqual([]);
    expect(v.rows).toEqual([{ label: "Priya owes you", cents: 420, owed: true, was: "was $4.20" }]);
    expect(v.notified).toBeNull();
  });
  it("spells a negative was in words, and a tab that flips as 'You owe'", () => {
    const v = savedView({ ...base, shares: [{ person_id: 2, owes: 100 }], tabs: [{ person_id: 2, was: -300 }] }, names);
    expect(v.rows[0]).toEqual({ label: "You owe Priya", cents: 200, owed: false, was: "was You owe Priya $3.00" });
  });
  it("gives each person above $0 a line and a row when you paid with 2+ others", () => {
    const v = savedView(
      { ...base, shares: [{ person_id: 2, owes: 960 }, { person_id: 3, owes: 1816 }, { person_id: 4, owes: 0 }], tabs: [{ person_id: 2, was: 1620 }, { person_id: 3, was: 0 }, { person_id: 4, was: 50 }], notified: [2, 3] },
      names,
    );
    expect(v.line).toEqual([{ label: "Priya owes", cents: 960 }, { label: "Rahul owes", cents: 1816 }]);
    expect(v.heading).toBeNull();
    expect(v.rows).toEqual([
      { label: "Priya owes you", cents: 2580, owed: true, was: "was $16.20" },
      { label: "Rahul owes you", cents: 1816, owed: true, was: "was $0.00" },
    ]);
    expect(v.notified).toBe("Priya and Rahul have been notified.");
  });
  it("reads a bill someone else paid from your side (H2)", () => {
    const v = savedView({ ...base, payer_id: 2, shares: [{ person_id: 1, owes: 1900 }], tabs: [{ person_id: 2, was: 1620 }], notified: [2] }, names);
    expect(v).toEqual({
      line: [{ label: "Priya paid" }, { label: "you owe", cents: 1900 }],
      heading: "Your tab with Priya",
      rows: [{ label: "You owe Priya", cents: 280, owed: false, was: "was: Priya owes you $16.20" }],
      notified: "Priya has been notified.",
    });
  });
  it("shows no card when a third person paid and your own share is $0", () => {
    const v = savedView({ ...base, payer_id: 3, shares: [{ person_id: 1, owes: 0 }, { person_id: 2, owes: 500 }], tabs: [{ person_id: 2, was: 0 }, { person_id: 3, was: 0 }] }, names);
    expect(v.line).toEqual([{ label: "Rahul paid" }]);
    expect(v.rows).toEqual([]);
  });
});

// The Artifact's Coles receipt, total $49.94; K (1) paid, P (2) Priya, R (3) Rahul. Protein bar and shampoo are K's, coffee R's.
const K = 1, P = 2, R = 3;
const everyone = [K, P, R];
type Lines = Parameters<typeof breakdownView>[0];
const coles = [
  { name: "Milk 2L", price_cents: 310, kind: "item", people: everyone },
  { name: "Wholemeal bread", price_cents: 450, kind: "item", people: everyone },
  { name: "Bananas 1.2kg", price_cents: 419, kind: "item", people: everyone },
  { name: "Protein bar", price_cents: 350, kind: "item", people: [K] },
  { name: "Chicken breast", price_cents: 1200, kind: "item", people: everyone },
  { name: "Member price", price_cents: -200, kind: "discount" },
  { name: "Shampoo", price_cents: 900, kind: "item", people: [K] },
  { name: "Eggs 12pk", price_cents: 680, kind: "item", people: everyone },
  { name: "Coffee pods", price_cents: 850, kind: "item", people: [R] },
  { name: "Card surcharge", price_cents: 35, kind: "surcharge" },
] as Lines;
const trio = [{ id: K, name: "Kaushik Rao" }, { id: P, name: "Priya Shah" }, { id: R, name: "Rahul" }];

describe("breakdownView", () => {
  it("shows Priya's parts, her share of the fee and what was not hers (B5c)", () => {
    expect(breakdownView(coles, trio, K, 4994, P, K)).toEqual({
      head: "Priya owes you",
      total: 960,
      rows: [
        { label: "Milk 2L", n: 3, cents: 103 },
        { label: "Wholemeal bread", n: 3, cents: 150 },
        { label: "Bananas 1.2kg", n: 3, cents: 140 },
        { label: "Chicken breast, less discount", n: 3, cents: 333 },
        { label: "Eggs 12pk", n: 3, cents: 227 },
        { label: "Card fee, Priya's share", n: 1, cents: 7 },
      ],
      rounding: null,
      not: "Not Priya's: Protein bar, Shampoo, Coffee pods.",
    });
  });
  it("words the head by who paid, with You for the viewer, and omits Not when they had everything", () => {
    const pizza = [{ name: "Pizza", price_cents: 2000, kind: "item", people: [K, P] }] as Lines;
    expect(breakdownView(pizza, trio.slice(0, 2), P, 2000, K, K)).toMatchObject({ head: "You owe Priya", total: 1000, not: null });
    expect(breakdownView(pizza, trio, R, 2000, P, K).head).toBe("Priya owes Rahul");
  });
  it("spells a rounding cent with its sign", () => {
    const sushi = [{ name: "Sushi", price_cents: 1001, kind: "item", people: [P, R] }] as Lines;
    expect(breakdownView(sushi, trio, K, 1001, R, K)).toMatchObject({ total: 500, rounding: "-$0.01" }); // 501 + 500 would be a cent over
    expect(breakdownView(sushi, trio, K, 1001, P, K).rounding).toBeNull();
  });
  it("says 'your share' for the viewer's own fee, and calls an unnamed row Item", () => {
    const lines = [{ name: " ", price_cents: 1000, kind: "item", people: [K, R] }, { name: "Fee", price_cents: 100, kind: "surcharge" }] as Lines;
    const v = breakdownView(lines, trio, P, 1100, K, K);
    expect(v.rows).toEqual([{ label: "Item", n: 2, cents: 500 }, { label: "Card fee, your share", n: 1, cents: 50 }]);
  });
});
