import { describe, expect, it } from "vitest";
import { formatCents } from "./money";

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
