import { beforeAll, describe, expect, it, vi } from "vitest";

const { query, jar } = vi.hoisted(() => ({ query: vi.fn(), jar: { value: "" } }));
vi.mock("./db", () => ({ query }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: jar.value }), set: (_: string, v: string) => (jar.value = v) }),
}));
const { currentPerson, readSessionId, signSession, startSession } = await import("./session");

const id = "3f1c2b8e-5d7a-4e9b-8c1f-0a2b3c4d5e6f";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-that-is-long-enough-000000";
});

describe("session cookie", () => {
  it("reads back the session id it signed", () => {
    expect(readSessionId(signSession(id))).toBe(id);
  });

  it("refuses an edited id, an edited signature, and an unsigned value", () => {
    const good = signSession(id);
    const otherId = "3f1c2b8e-5d7a-4e9b-8c1f-0a2b3c4d5e70";
    expect(readSessionId(good.replace(id, otherId))).toBeNull();
    expect(readSessionId(good.slice(0, -2) + "xx")).toBeNull();
    expect(readSessionId(id)).toBeNull();
    expect(readSessionId(undefined)).toBeNull();
  });

  it("refuses a cookie signed with another secret", () => {
    const good = signSession(id);
    process.env.SESSION_SECRET = "a-different-secret-also-long-enough-111";
    expect(readSessionId(good)).toBeNull();
  });
});

describe("sessions and PIN changes", () => {
  it("records the stamp a session was signed in with, and counts it only while it is the person's current one", async () => {
    query.mockResolvedValueOnce([{ id: id }]);
    await startSession(4, "stamp-1");
    expect(query.mock.calls[0][0]).toMatch(/select id, pin_stamp from person where id = \$1 and pin_stamp = \$2::uuid/);
    expect(query.mock.calls[0][1]).toEqual([4, "stamp-1"]);
    expect(readSessionId(jar.value)).toBe(id);
    query.mockResolvedValueOnce([]);
    expect(await currentPerson()).toBeNull();
    expect(query.mock.calls[1][0]).toMatch(/where s\.id = \$1 and s\.pin_stamp = p\.pin_stamp/);
  });
});
