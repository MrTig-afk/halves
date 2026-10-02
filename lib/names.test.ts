import { describe, expect, it } from "vitest";
import { dayMonth, editedAt, firstName, initial, isToday, itemLabel, localDate, shortDate } from "./names";

describe("names and dates", () => {
  it("shortens names", () => {
    expect(firstName("  Soham ")).toBe("Soham");
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

describe("itemLabel", () => {
  const two = [{ id: 1, name: "Kaushik Rao" }, { id: 2, name: "Priya Shah" }];
  const four = [...two, { id: 3, name: "Rahul" }, { id: 4, name: "Asha" }];
  const me = 1;

  it("reads everyone on the bill as everyone, even with two people", () => {
    expect(itemLabel([1, 2], two, me)).toBe("everyone");
    expect(itemLabel([1, 2, 3], four.slice(0, 3), me)).toBe("everyone");
  });

  it("says yours for the viewer alone and the first name's for one other", () => {
    expect(itemLabel([1], two, me)).toBe("yours");
    expect(itemLabel([2], two, me)).toBe("Priya's");
    expect(itemLabel([2], two, 2)).toBe("yours");
  });

  it("joins names with You first, then id order", () => {
    expect(itemLabel([1, 2], four.slice(0, 3), me)).toBe("You, Priya");
    expect(itemLabel([2, 3], four, me)).toBe("Priya, Rahul");
    expect(itemLabel([3, 1], four, me)).toBe("You, Rahul");
    expect(itemLabel([2, 3], four, 3)).toBe("You, Priya");
  });

  it("has no label for a discount or surcharge, and never says split", () => {
    expect(itemLabel(null, two, me)).toBeNull();
    for (const set of [[1], [2], [1, 2], [1, 3], [2, 3, 4]]) expect(itemLabel(set, four, me)).not.toMatch(/split/i);
  });
});

describe("editedAt", () => {
  it("reads a moment as day, month, time on the roommates' clock", () => {
    expect(editedAt("2026-09-29T08:02:00Z")).toBe("29 Sep, 6:02 pm"); // AEST
    expect(editedAt("2026-10-05T08:02:00Z")).toBe("5 Oct, 7:02 pm"); // AEDT
  });

  it("writes midnight and noon as 12 am and 12 pm, on the Sydney day", () => {
    expect(editedAt("2026-09-28T14:00:00Z")).toBe("29 Sep, 12:00 am");
    expect(editedAt("2026-09-29T02:05:00Z")).toBe("29 Sep, 12:05 pm");
  });
});
