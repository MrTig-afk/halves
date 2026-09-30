import { describe, expect, it } from "vitest";
import { BillError, parseBill } from "./bill";

const ok = {
  scan_id: "8f14e45f-ceea-467a-9a36-2b1c2f6c1a01",
  partner_id: 2,
  description: "Coles",
  date: "2026-09-29",
  total_cents: 1000,
  lines: [
    { name: "Milk", price_cents: 310, kind: "item", share: "split" },
    { name: "Member price", price_cents: -100, kind: "discount", share: "payer" },
    { name: "Card fee", price_cents: 10, kind: "surcharge", share: null },
  ],
  ai: null,
};
const parse = (patch: object) => parseBill(JSON.stringify({ ...ok, ...patch }));

describe("parseBill", () => {
  it("accepts a valid bill; shares only on items (discounts follow their item, fees are proportional)", () => {
    expect(parse({}).lines.map((l) => l.share)).toEqual(["split", null, null]);
  });

  it("rejects the things the server must never trust", () => {
    const bad: object[] = [
      { scan_id: "not-a-uuid" },
      { partner_id: 0 },
      { partner_id: "2" },
      { description: "" },
      { description: "x".repeat(61) },
      { date: "" },
      { date: "2026-02-30" },
      { total_cents: -1 },
      { total_cents: 1.5 },
      { lines: [] },
      { lines: [{ name: "Milk", price_cents: 310, kind: "item", share: "half" }] },
      { lines: [{ name: "Milk", price_cents: 310, kind: "item" }] },
      { lines: [{ name: "Promo", price_cents: -100, kind: "discount", share: null }, ...ok.lines] },
      { lines: [{ name: "Milk", price_cents: -310, kind: "item", share: "payer" }] },
      { lines: Array(201).fill(ok.lines[0]) },
      { ai: { lines: "nope" } },
      { typed: "yes" },
      // a bill without a receipt is exactly one item line above $0.00, with no AI reading
      { typed: true, total_cents: 0, lines: [{ name: "Uber", price_cents: 0, kind: "item", share: "split" }] },
      { typed: true, total_cents: 2400, lines: [{ name: "Uber", price_cents: 2400, kind: "item", share: "payer" }] }, // split or owed in full only
      { typed: true, total_cents: 10000, lines: [{ name: "Uber", price_cents: 2400, kind: "item", share: "split" }] }, // its amount is its total
      { typed: true, total_cents: null, lines: [{ name: "Uber", price_cents: 2400, kind: "item", share: "split" }] },
      { typed: true, total_cents: 700, lines: [{ name: "Uber", price_cents: 300, kind: "item", share: "split" }, { name: "Tip", price_cents: 400, kind: "item", share: "split" }] },
      { typed: true, total_cents: 310, lines: [ok.lines[0]], ai: { store_name: null, date: null, total_cents: 310, lines: [{ name: "MILK", price_cents: 310, kind: "item" }] } },
    ];
    for (const b of bad) expect(() => parse(b), JSON.stringify(b)).toThrow(BillError);
  });

  it("accepts a bill without a receipt: one line named as the bill, its amount as the total, no AI reading", () => {
    const b = parse({ typed: true, description: "Uber to airport", total_cents: 2401, lines: [{ name: "Uber to airport", price_cents: 2401, kind: "item", share: "partner" }] });
    expect([b.typed, b.total_cents, b.lines, b.ai]).toEqual([true, 2401, [{ name: "Uber to airport", price_cents: 2401, kind: "item", share: "partner" }], null]);
    expect(parse({}).typed).toBe(false); // a scanned bill, whatever its shape
  });

  it("saves scanned bills exactly as before, even ones that net to $0.00", () => {
    const voucher = [{ name: "Coffee", price_cents: 400, kind: "item", share: "split" }, { name: "Voucher", price_cents: -400, kind: "discount", share: null }];
    expect(parse({ total_cents: null, lines: voucher }).lines).toHaveLength(2);
    expect(parse({ total_cents: 0, lines: [{ name: "Free sample", price_cents: 0, kind: "item", share: "split" }] }).lines).toHaveLength(1);
  });

  it("still saves a scanned receipt whose total is $0.00 (paid by voucher) when its lines are not", () => {
    expect(parse({ total_cents: 0 }).total_cents).toBe(0);
  });

  it("caps a whole bill at $100,000 so the split arithmetic stays exact", () => {
    const line = { name: "TV", price_cents: 5_000_000, kind: "item", share: "split" };
    expect(parse({ total_cents: null, lines: [line, line] }).lines).toHaveLength(2); // exactly $100,000
    expect(() => parse({ total_cents: null, lines: [line, line, { ...line, price_cents: 1 }] })).toThrow(BillError);
  });

  it("drops any client-sent amount: nothing but the listed fields comes back", () => {
    const b = parse({ partner_owes_cents: 999999, payer_id: 9 }) as Record<string, unknown>;
    expect(b).not.toHaveProperty("partner_owes_cents");
    expect(b).not.toHaveProperty("payer_id");
  });

  it("keeps a valid AI reading unchanged", () => {
    const ai = { store_name: "COLES", date: null, total_cents: 310, lines: [{ name: "MILK", price_cents: 310, kind: "item" }] };
    expect(parse({ ai }).ai).toEqual(ai);
  });
});
