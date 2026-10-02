import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("./db", () => ({ query }));
const { checkPin } = await import("./auth");

const giveBack = () => query.mock.calls.filter(([sql]) => String(sql).includes("array_remove"));

beforeEach(() => query.mockReset());

describe("checkPin's try per phone", () => {
  it("is given back when the PIN check itself fails (a database error is no guess)", async () => {
    query
      .mockResolvedValueOnce([{ n: 3, at: "2026-10-02T10:00:00.000Z", until: "2026-10-02T10:15:00.000Z" }]) // the try is reserved
      .mockRejectedValueOnce(new Error("neon down")) // the tile check fails
      .mockResolvedValue([]);
    await expect(checkPin(1, "1234", "d:phone")).rejects.toThrow("neon down");
    expect(giveBack()).toHaveLength(1);
    expect(giveBack()[0][1]).toEqual(["d:phone", "2026-10-02T10:00:00.000Z"]);
  });

  it("is kept for an address key even when the check fails (positive control: same failure, other key)", async () => {
    query
      .mockResolvedValueOnce([{ n: 3, at: "2026-10-02T10:00:00.000Z", until: "2026-10-02T10:15:00.000Z" }])
      .mockRejectedValueOnce(new Error("neon down"))
      .mockResolvedValue([]);
    await expect(checkPin(1, "1234", "ip:abc")).rejects.toThrow("neon down");
    expect(giveBack()).toHaveLength(0);
  });

  it("a failed give-back leaves the answer alone (the try just stays spent)", async () => {
    query
      .mockResolvedValueOnce([{ n: 3, at: "2026-10-02T10:00:00.000Z", until: "2026-10-02T10:15:00.000Z" }])
      .mockRejectedValueOnce(new Error("neon down")); // the give-back fails
    await expect(checkPin(1, "12", "d:phone")).resolves.toEqual({ ok: false, error: "invalid_pin" });
    expect(giveBack()).toHaveLength(1);
  });
});
