import { beforeEach, describe, expect, it, vi } from "vitest";

const { currentPerson, checkPin, query } = vi.hoisted(() => ({ currentPerson: vi.fn(), checkPin: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/session", () => ({ currentPerson, currentSessionId: async () => "sess-1" }));
vi.mock("@/lib/auth", () => ({ checkPin }));
vi.mock("@/lib/db", () => ({ query }));
const { POST } = await import("./route");

const post = (body: unknown) => POST(new Request("http://x/api/auth/change-pin", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  currentPerson.mockResolvedValue({ id: 4, name: "Soham", role: "member" });
});

describe("POST /api/auth/change-pin", () => {
  it("refuses a signed-out device", async () => {
    currentPerson.mockResolvedValueOnce(null);
    expect((await post({ current: "1111", next: "2222" })).status).toBe(401);
    expect(checkPin).not.toHaveBeenCalled();
  });

  it("refuses a new PIN that is not 4 digits, before checking the current one", async () => {
    for (const next of ["123", "12345", "abcd", 1234]) expect((await post({ current: "1111", next })).status).toBe(400);
    expect(checkPin).not.toHaveBeenCalled();
  });

  it("checks the current PIN like a sign-in (same lockout) and changes nothing when it is wrong", async () => {
    checkPin.mockResolvedValueOnce({ ok: false, error: "wrong_pin", triesLeft: 2 });
    const res = await post({ current: "0000", next: "2222" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "wrong_pin", triesLeft: 2 });
    expect(checkPin).toHaveBeenCalledWith(4, "0000");
    expect(query).not.toHaveBeenCalled();
  });

  it("answers 423 while locked", async () => {
    checkPin.mockResolvedValueOnce({ ok: false, error: "locked", lockedUntil: "2026-09-29T12:00:00Z" });
    expect((await post({ current: "0000", next: "2222" })).status).toBe(423);
  });

  it("stores a hash of the new PIN and signs out the person's other phones, keeping this one", async () => {
    checkPin.mockResolvedValueOnce({ ok: true });
    query.mockResolvedValueOnce([{ changed: true }]);
    expect((await post({ current: "1111", next: "2222" })).status).toBe(200);
    const [sql, [id, hash, keep]] = query.mock.calls[0];
    expect(sql).toMatch(/update person set pin_hash = \$2\s+where id = \$1 and exists \(select 1 from device_session where person_id = \$1 and id::text = \$3\)/);
    expect(sql).toMatch(/delete from device_session where person_id in \(select id from p\) and id::text <> coalesce\(\$3/);
    expect([id, keep]).toEqual([4, "sess-1"]);
    expect(hash).not.toContain("2222");
  });

  it("changes nothing when the admin reset the tile in between", async () => {
    checkPin.mockResolvedValueOnce({ ok: true });
    query.mockResolvedValueOnce([{ changed: false }]);
    expect((await post({ current: "1111", next: "2222" })).status).toBe(409);
  });
});
