import { describe, expect, it } from "vitest";
import { dayMonth, firstName, initial, isToday, localDate, shortDate } from "./names";

describe("names and dates", () => {
  it("shortens names", () => {
    expect(firstName("  Soham Sabharwal ")).toBe("Soham");
    expect(initial("kaushik")).toBe("K");
  });

  it("reads a bill date as written, with no time-zone shift", () => {
    expect(dayMonth("2026-09-01")).toEqual({ day: 1, month: "Sep" });
    expect(shortDate("2026-12-31")).toBe("31 Dec");
  });

  it("reads a moment on the roommates' clock (Sydney), not the server's UTC", () => {
    // 14:30 UTC on 29 Sep is 00:30 on 30 Sep in Sydney (AEST, UTC+10).
    expect(localDate("2026-09-29T14:30:00Z")).toBe("2026-09-30");
    expect(isToday("2026-09-29T14:30:00Z", new Date("2026-09-30T01:00:00Z"))).toBe(true);
    expect(isToday("2026-09-29T13:30:00Z", new Date("2026-09-30T01:00:00Z"))).toBe(false);
  });
});
