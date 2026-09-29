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
    checkPin.mockResolvedValueOnce({ ok: true, stamp: "stamp-1" });
    query.mockResolvedValueOnce([{ changed: true }]);
    expect((await post({ current: "1111", next: "2222" })).status).toBe(200);
    const [sql, [id, hash, keep, stamp]] = query.mock.calls[0];
    // only while the PIN is still the one just checked
    expect(sql).toMatch(/update person set pin_hash = \$2, pin_stamp = gen_random_uuid\(\)\s+where id = \$1 and pin_stamp = \$4::uuid/);
    expect(sql).toMatch(/update device_session d set pin_stamp = p.pin_stamp from p where d.id = \$3::uuid/); // this phone stays signed in
    expect(sql).toMatch(/delete from device_session d using p where d.person_id = p.id and d.id is distinct from \$3::uuid/);
    expect([id, keep, stamp]).toEqual([4, "sess-1", "stamp-1"]);
    expect(hash).not.toContain("2222");
  });

  it("changes nothing when the PIN changed in between (an admin reset, another phone)", async () => {
    checkPin.mockResolvedValueOnce({ ok: true, stamp: "stamp-1" });
    query.mockResolvedValueOnce([{ changed: false }]);
    expect((await post({ current: "1111", next: "2222" })).status).toBe(409);
  });
});
