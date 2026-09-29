import { describe, expect, it } from "vitest";
import { hashPin, isValidPin, verifyPin } from "./pin";

describe("PIN hashing", () => {
  it("verifies the right PIN and refuses a wrong one", async () => {
    const stored = await hashPin("4821");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(stored).not.toContain("4821");
    expect(await verifyPin("4821", stored)).toBe(true);
    expect(await verifyPin("4822", stored)).toBe(false);
  });

  it("salts every hash, so the same PIN never hashes the same way twice", async () => {
    expect(await hashPin("1111")).not.toBe(await hashPin("1111"));
  });

  it("accepts exactly four digits", () => {
    expect(["0000", "9876"].every(isValidPin)).toBe(true);
    expect(["123", "12345", "12a4", " 1234", 1234, null].some(isValidPin)).toBe(false);
  });

  it("refuses a malformed stored hash instead of throwing", async () => {
    expect(await verifyPin("1234", "plain-text")).toBe(false);
  });
});
