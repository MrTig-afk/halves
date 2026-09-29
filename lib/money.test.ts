import { describe, expect, it } from "vitest";
import { formatCents, parseCents } from "./money";

describe("formatCents", () => {
  it("formats whole and fractional dollars", () => {
    expect(formatCents(1440)).toBe("$14.40");
    expect(formatCents(4994)).toBe("$49.94");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(0)).toBe("$0.00");
  });

  it("puts the sign before the dollar sign for discounts", () => {
    expect(formatCents(-200)).toBe("-$2.00");
  });
});

describe("parseCents", () => {
  it.each([
    ["12", 1200],
    ["12.5", 1250],
    ["12.50", 1250],
    ["$12.50", 1250],
    [" 3.1 ", 310],
    ["-2", -200],
    ["-$2.00", -200],
    ["0.05", 5],
  ])("reads %s as %i cents", (text, cents) => {
    expect(parseCents(text)).toBe(cents);
  });

  it.each(["", "abc", "12.345", "1,000", "$", "--2", "1e3", "1234567"])("refuses %j", (text) => {
    expect(parseCents(text)).toBeNull();
  });

  it("round-trips what formatCents prints", () => {
    for (const c of [0, 5, 310, -200, 4994]) expect(parseCents(formatCents(c))).toBe(c);
  });
});
