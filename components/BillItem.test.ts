import { describe, expect, it } from "vitest";
import type { BillRow } from "@/lib/tab";
import { rowText } from "./BillItem";

const bill = (payer_id: number, size: number): BillRow => ({
  id: 1,
  description: "x",
  bill_date: "2026-09-29",
  total_cents: 3000,
  payer_id,
  payer: payer_id === 1 ? "Kaushik N" : "Priya S",
  size,
  // everyone on the bill but me (person 1): size - 1 people, the payer among them when not me
  others: [{ id: 2, name: "Priya S" }, { id: 3, name: "Rahul K" }, { id: 4, name: "Sam T" }].slice(0, size - 1),
  amount: 100,
});

describe("rowText", () => {
  it("Home with 3+ people: who paid, with whom, owed to me or what I owe", () => {
    expect(rowText(bill(1, 3), 1, "home")).toEqual({ line: "You paid · with Priya, Rahul", word: "owed" });
    expect(rowText(bill(1, 4), 1, "home").line).toBe("You paid · with Priya, Rahul, Sam");
    expect(rowText(bill(2, 3), 1, "home")).toEqual({ line: "Priya paid", word: "you owe" });
  });
  it("a person's tab: a two-person bill is signed as on Home", () => {
    expect(rowText(bill(1, 2), 1, "pair", "Priya")).toEqual({ line: "You paid", word: "owes" });
    expect(rowText(bill(2, 2), 1, "pair", "Priya")).toEqual({ line: "Priya paid", word: "you owe" });
  });
  it("a person's tab: a bigger bill gives that person's share, never her/his", () => {
    expect(rowText(bill(1, 3), 1, "pair", "Priya")).toEqual({ line: "You paid · 3 people", word: "Priya's share" });
    expect(rowText(bill(1, 4), 1, "pair", "Priya").line).toBe("You paid · 4 people");
    expect(rowText(bill(2, 4), 1, "pair", "Priya")).toEqual({ line: "Priya paid", word: "you owe" });
  });
});
