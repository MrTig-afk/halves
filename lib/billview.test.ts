import { describe, expect, it } from "vitest";
import { savedView, typedFoot, typedHint } from "./billview";
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
