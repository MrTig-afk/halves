import { describe, expect, it } from "vitest";
import { parseReceipt, ReceiptError } from "./receipt";

const good = {
  store_name: "COLES SUPERMARKETS",
  date: "2026-09-29",
  total_cents: 4994,
  lines: [
    { name: "CHICKEN BREAST", price_cents: 1200, kind: "item" },
    { name: "MEMBER PRICE", price_cents: -200, kind: "discount" },
    { name: "CARD SURCHARGE", price_cents: 35, kind: "surcharge" },
  ],
};
const parse = (o: unknown) => parseReceipt(JSON.stringify(o));
const code = (o: unknown) => {
  try {
    parse(o);
    return "accepted";
  } catch (e) {
    return (e as ReceiptError).code;
  }
};

describe("parseReceipt", () => {
  it("accepts a well-formed reading unchanged", () => {
    expect(parse(good)).toEqual(good);
  });

  it("accepts nulls for fields the receipt did not show", () => {
    expect(parse({ ...good, store_name: null, date: null, total_cents: null }).date).toBeNull();
  });

  it("accepts a meal deal whose name lists what is in it (a real Pizza Hut read, 94 characters)", () => {
    const deal = "2 For Tuesday (Large Hot & Spicy Veggie Traditional, Large Creamy Garlic Paneer Traditional)";
    expect(parse({ ...good, lines: [{ name: deal, price_cents: 1645, kind: "item" }] }).lines[0].name).toBe(deal);
  });

  it("reads empty strings for store and date as not shown, keeping the lines", () => {
    const r = parse({ ...good, store_name: " ", date: "" });
    expect([r.store_name, r.date, r.lines.length]).toEqual([null, null, 3]);
  });

  it.each([
    ["an extra top-level field", { ...good, note: "hi" }],
    ["an extra line field", { ...good, lines: [{ ...good.lines[0], qty: 2 }] }],
    ["a fractional price", { ...good, lines: [{ ...good.lines[0], price_cents: 12.5 }] }],
    ["a price as text", { ...good, lines: [{ ...good.lines[0], price_cents: "1200" }] }],
    ["an unknown kind", { ...good, lines: [{ ...good.lines[0], kind: "tax" }] }],
    ["a positive discount", { ...good, lines: [good.lines[0], { ...good.lines[1], price_cents: 200 }] }],
    ["a negative item", { ...good, lines: [{ ...good.lines[0], price_cents: -1 }] }],
    ["a discount with no item above it", { ...good, lines: [good.lines[1], good.lines[0]] }],
    ["a discount right after a fee", { ...good, lines: [good.lines[0], good.lines[2], good.lines[1]] }],
    ["a runaway name", { ...good, lines: [{ ...good.lines[0], name: "x".repeat(201) }] }],
    ["a control character in a name", { ...good, lines: [{ ...good.lines[0], name: "MILK\u0007" }] }],
    ["an impossible date", { ...good, date: "2026-02-30" }],
    ["a misread giant total", { ...good, total_cents: 99_999_999 }],
    ["a bare string", "not an object"],
  ])("rejects %s", (_label, o) => {
    expect(code(o)).toBe("bad_output");
  });

  it("rejects text that is not JSON", () => {
    expect(() => parseReceipt("not json {")).toThrow(ReceiptError);
  });

  it("reports an empty receipt as no_items, not a bad reading", () => {
    expect(code({ ...good, lines: [] })).toBe("no_items");
    expect(code({ ...good, lines: [good.lines[2]] })).toBe("no_items");
  });
});
