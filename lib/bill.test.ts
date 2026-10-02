import { describe, expect, it } from "vitest";
import { BillError, edited, parseBill } from "./bill";
import type { ReceiptReading } from "./receipt";

const ok = {
  scan_id: "8f14e45f-ceea-467a-9a36-2b1c2f6c1a01",
  people: [1, 2, 3],
  payer_id: 1,
  description: "Coles",
  date: "2026-09-29",
  total_cents: 1000,
  lines: [
    { name: "Milk", price_cents: 310, kind: "item", people: [1, 2, 3] },
    { name: "Member price", price_cents: -100, kind: "discount", people: [1] },
    { name: "Card fee", price_cents: 10, kind: "surcharge", people: null },
  ],
  ai: null,
};
const parse = (patch: object) => parseBill(JSON.stringify({ ...ok, ...patch }));
const item = (people: unknown, price = 310) => ({ name: "Milk", price_cents: price, kind: "item", people });
const typedBill = (patch: object = {}) => ({
  typed: true,
  total_cents: 2400,
  lines: [{ name: "Uber", price_cents: 2400, kind: "item", people: [1, 2] }],
  people: [1, 2],
  ...patch,
});

describe("parseBill", () => {
  it("accepts a valid 3-person bill; sets only on items (discounts follow their item, fees are proportional)", () => {
    const b = parse({});
    expect(b.lines.map((l) => l.people)).toEqual([[1, 2, 3], null, null]);
    expect([b.people, b.payer_id]).toEqual([[1, 2, 3], 1]);
  });

  it("rejects the things the server must never trust", () => {
    const bad: object[] = [
      { scan_id: "not-a-uuid" },
      { people: undefined },
      { people: "1,2" },
      { people: [1] }, // fewer than 2
      { people: [1, 2, 3, 4, 5, 6] }, // more than 5
      { people: [1, 1, 2] }, // duplicates
      { people: [1, 2.5] },
      { people: [1, "2"] },
      { people: [1, 0] },
      { people: [1, -2] },
      { people: [1, 2 ** 60] },
      { payer_id: 9 }, // not on the bill
      { payer_id: "1" },
      { payer_id: undefined },
      { description: "" },
      { description: "x".repeat(61) },
      { date: "" },
      { date: "2026-02-30" },
      { total_cents: -1 },
      { total_cents: 1.5 },
      { lines: [] },
      { lines: [item([])] }, // nobody had it
      { lines: [item(null)] },
      { lines: [item(undefined)] },
      { lines: [item([1, 1])] }, // a duplicate in the set
      { lines: [item([1, 9])] }, // someone not on the bill
      { lines: [item("everyone")] },
      { lines: [{ name: "Promo", price_cents: -100, kind: "discount", people: null }, ...ok.lines] },
      { lines: [{ name: "Milk", price_cents: -310, kind: "item", people: [1] }] },
      { lines: Array(201).fill(ok.lines[0]) },
      { ai: { lines: "nope" } },
      { typed: "yes" },
      // a bill without a receipt is exactly one item line above $0.00, with no AI reading, shared with someone who did not pay
      typedBill({ total_cents: 0, lines: [{ name: "Uber", price_cents: 0, kind: "item", people: [1, 2] }] }),
      typedBill({ lines: [{ name: "Uber", price_cents: 2400, kind: "item", people: [1] }] }), // only the payer
      typedBill({ people: [1, 2, 3], payer_id: 2, lines: [{ name: "Uber", price_cents: 2400, kind: "item", people: [2] }] }), // only the payer (not the adder)
      typedBill({ total_cents: 10000 }), // its amount is its total
      typedBill({ total_cents: null }),
      typedBill({ total_cents: 700, lines: [{ name: "Uber", price_cents: 300, kind: "item", people: [1, 2] }, { name: "Tip", price_cents: 400, kind: "item", people: [1, 2] }] }),
      typedBill({ ai: { store_name: null, date: null, total_cents: 2400, lines: [{ name: "UBER", price_cents: 2400, kind: "item" }] } }),
    ];
    for (const b of bad) expect(() => parse(b), JSON.stringify(b)).toThrow(BillError);
  });

  it("says why too few or too many people, in words the person can read", () => {
    expect(() => parse({ people: [1], lines: [item([1])] })).toThrow("people");
    const user = (people: number[]) => {
      try {
        parse({ people, lines: [item(people.slice(0, 1))] });
      } catch (e) {
        return (e as BillError).user;
      }
    };
    expect(user([1])).toBe("Add at least one other person.");
    expect(user([1, 2, 3, 4, 5, 6])).toBe("A bill can have up to 5 people.");
    expect(user([1, 2, 3, 4, 5])).toBeUndefined(); // five is fine
  });

  it("accepts a bill without a receipt: one line named as the bill, its amount as the total, no AI reading", () => {
    const b = parse(typedBill({ description: "Uber to airport", total_cents: 2401, lines: [{ name: "Uber to airport", price_cents: 2401, kind: "item", people: [2] }] }));
    expect([b.typed, b.total_cents, b.lines, b.ai]).toEqual([true, 2401, [{ name: "Uber to airport", price_cents: 2401, kind: "item", people: [2] }], null]);
    expect(parse({}).typed).toBe(false); // a scanned bill, whatever its shape
    // someone else paid: the adder owes (PRD 6.3 acceptance), so the set may be just the adder
    expect(parse(typedBill({ payer_id: 2, total_cents: 3800, lines: [{ name: "Nandos", price_cents: 3800, kind: "item", people: [1, 2] }] })).payer_id).toBe(2);
  });

  it("saves scanned bills exactly as before, even ones that net to $0.00", () => {
    const voucher = [item([1, 2], 400), { name: "Voucher", price_cents: -400, kind: "discount", people: null }];
    expect(parse({ total_cents: null, lines: voucher }).lines).toHaveLength(2);
    expect(parse({ total_cents: 0, lines: [{ name: "Free sample", price_cents: 0, kind: "item", people: [1, 2] }] }).lines).toHaveLength(1);
  });

  it("still saves a scanned receipt whose total is $0.00 (paid by voucher) when its lines are not", () => {
    expect(parse({ total_cents: 0 }).total_cents).toBe(0);
  });

  it("caps a whole bill at $100,000 so the split arithmetic stays exact", () => {
    const line = item([1, 2], 5_000_000);
    expect(parse({ total_cents: null, lines: [line, line] }).lines).toHaveLength(2); // exactly $100,000
    expect(() => parse({ total_cents: null, lines: [line, line, item([1], 1)] })).toThrow(BillError);
  });

  it("drops what only the server may decide: amounts, who added it, the edit times", () => {
    const b = parse({
      owes: { 2: 1 },
      partner_owes_cents: 999999,
      added_by: 9,
      date_edited_at: "2020-01-01T00:00:00Z",
      total_edited_at: "2020-01-01T00:00:00Z",
    }) as Record<string, unknown>;
    for (const k of ["owes", "partner_owes_cents", "added_by", "date_edited_at", "total_edited_at"]) expect(b).not.toHaveProperty(k);
  });

  it("keeps a valid AI reading unchanged", () => {
    const ai = { store_name: "COLES", date: null, total_cents: 310, lines: [{ name: "MILK", price_cents: 310, kind: "item" }] };
    expect(parse({ ai }).ai).toEqual(ai);
  });

  it("turns the body's edit signals into edited() verdicts, and never lets a bill without a receipt carry one", () => {
    expect(parse({ date_edited: true, total_edited: true }).edited).toEqual({ date: true, total: true }); // no reading: the person's word
    expect(parse({}).edited).toEqual({ date: false, total: false });
    const both = { date_edited: true, total_edited: true };
    expect(parse({ ...typedBill(), ...both }).edited).toEqual({ date: false, total: false });
    expect(parse({ ...typedBill(), date_edited: "yes", total_edited: 1 }).edited).toEqual({ date: false, total: false });
    expect(parse({ date_edited: "yes", total_edited: 1 }).edited).toEqual({ date: false, total: false }); // anything but true is false
  });
});

describe("edited", () => {
  const reading = (patch: Partial<ReceiptReading> = {}): ReceiptReading => ({ store_name: "COLES", date: "2026-09-29", total_cents: 4994, lines: [], ...patch });
  const no = { date: false, total: false };
  const yes = { date: true, total: true };

  it("compares to what the reading had, whatever the client says", () => {
    expect(edited(reading(), "2026-09-28", 4994, no)).toEqual({ date: true, total: false }); // changed, signal false too
    expect(edited(reading(), "2026-09-29", 4994, yes)).toEqual(no); // changed and changed back
    expect(edited(reading(), "2026-09-29", 5000, no)).toEqual({ date: false, total: true });
    expect(edited(reading(), "2026-09-29", null, no)).toEqual({ date: false, total: true }); // cleared
    expect(edited(reading(), "2026-09-29", 4994, { date: false, total: true })).toEqual(no);
  });

  it("takes the person's word only for what the reading did not have", () => {
    expect(edited(null, "2026-09-29", 4994, no)).toEqual(no); // E3 Enter by hand
    expect(edited(null, "2026-09-29", 4994, { date: true, total: false })).toEqual({ date: true, total: false });
    expect(edited(null, "2026-09-29", 4994, { date: false, total: true })).toEqual({ date: false, total: true });
    expect(edited(reading({ date: null }), "2026-09-29", 4994, { date: true, total: false })).toEqual({ date: true, total: false });
    expect(edited(reading({ date: null }), "2026-09-29", 4994, no)).toEqual(no);
    expect(edited(reading({ total_cents: null }), "2026-09-29", 4994, { date: false, total: true })).toEqual({ date: false, total: true });
  });
});
