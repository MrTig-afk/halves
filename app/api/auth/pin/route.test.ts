import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ value: undefined as string | undefined, set: [] as { name: string; value: string; opts: { httpOnly?: boolean } }[] }));
const checkPin = vi.hoisted(() => vi.fn());
const claimTile = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (n === "halves_device" && jar.value ? { value: jar.value } : undefined),
    set: (name: string, value: string, opts: { httpOnly?: boolean }) => jar.set.push({ name, value, opts }),
  }),
}));
vi.mock("@/lib/auth", () => ({ checkPin, claimTile }));
vi.mock("@/lib/db", () => ({ query: vi.fn().mockResolvedValue([{ id: "77" }]) }));

process.env.SESSION_SECRET = "test-secret-that-is-long-enough-000000";
const { POST } = await import("./route");
const { POST: claim } = await import("../claim/route");
const { mac, readSessionId, signSession } = await import("@/lib/session");
const { network } = await import("@/lib/authRoute");
const device = () => jar.set.filter((c) => c.name === "halves_device");

const ID = "0b7e1c2a-5d3f-4a6b-8c9d-1e2f3a4b5c6d";
const call = (headers: Record<string, string> = {}, body: unknown = { personId: 1, pin: "1234" }) =>
  POST(new Request("http://x/api/auth/pin", { method: "POST", headers, body: JSON.stringify(body) }));

beforeEach(() => {
  jar.value = undefined;
  jar.set = [];
  checkPin.mockReset().mockResolvedValue({ ok: false, error: "wrong_pin", triesLeft: 2 });
});

describe("POST /api/auth/pin phone key", () => {
  it("a valid device cookie is the key and no device cookie is set", async () => {
    jar.value = signSession(ID, "device:");
    await call();
    expect(checkPin).toHaveBeenCalledWith(1, "1234", `d:${ID}`);
    expect(jar.set).toEqual([]);
  });

  it("no cookie: a hashed address key; a signed httpOnly device cookie only with a right PIN", async () => {
    await call({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    const key = checkPin.mock.calls[0][2] as string;
    expect(key).toBe(`ip:${mac("203.0.113.7")}`);
    expect(key).not.toContain("203.0.113.7");
    expect(device()).toEqual([]); // a wrong PIN earns no fresh allowance
    checkPin.mockResolvedValue({ ok: true, stamp: "11111111-1111-4111-8111-111111111111" });
    await call({ "x-forwarded-for": "203.0.113.7" });
    expect(device()).toHaveLength(1);
    expect(device()[0].opts.httpOnly).toBe(true);
    expect(readSessionId(device()[0].value, "device:")).not.toBeNull();
    expect(readSessionId(device()[0].value)).toBeNull(); // never usable as a session
  });

  it("a session cookie offered as the device cookie counts as none", async () => {
    jar.value = signSession(ID); // what every sign-in mints - would be a fresh allowance per sign-in
    await call({ "x-forwarded-for": "203.0.113.7" });
    expect(checkPin.mock.calls[0][2]).toBe(`ip:${mac("203.0.113.7")}`);
  });

  it("claiming a tile hands out a device cookie too, and only on success", async () => {
    const req = () => new Request("http://x/api/auth/claim", { method: "POST", body: JSON.stringify({ personId: 1, pin: "1234" }) });
    claimTile.mockResolvedValue({ ok: false, error: "claimed" });
    await claim(req());
    expect(device()).toEqual([]);
    claimTile.mockResolvedValue({ ok: true, stamp: "11111111-1111-4111-8111-111111111111" });
    await claim(req());
    expect(readSessionId(device()[0].value, "device:")).not.toBeNull();
  });

  it("counts an IPv6 connection by its /64, an IPv4 one by its address", () => {
    expect(network("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(network("2001:0db8:0001:0002:ffff:ffff:ffff:ffff")).toBe("2001:db8:1:2::/64");
    expect(network("2001:db8::7")).toBe("2001:db8:0:0::/64");
    expect(network("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(network("203.0.113.7")).toBe("203.0.113.7");
  });

  it("an edited device cookie counts as none", async () => {
    jar.value = signSession(ID, "device:").replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    await call({ "x-forwarded-for": "203.0.113.7" });
    expect(checkPin.mock.calls[0][2]).toBe(`ip:${mac("203.0.113.7")}`);
  });

  it("slow_down answers 429 with until and sets no device cookie", async () => {
    const until = "2026-10-02T12:00:00.000Z";
    checkPin.mockResolvedValue({ ok: false, error: "slow_down", until });
    const res = await call({ "x-forwarded-for": "203.0.113.7" });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, error: "slow_down", until });
    expect(jar.set).toEqual([]);
  });

  it("no address header is one shared bucket, never no limit", async () => {
    await call();
    expect(checkPin.mock.calls[0][2]).toBe(`ip:${mac("local")}`);
  });

  it("x-vercel-forwarded-for wins over x-forwarded-for, first entry trimmed", async () => {
    await call({ "x-vercel-forwarded-for": " 198.51.100.9 , 10.0.0.1", "x-forwarded-for": "203.0.113.7" });
    expect(checkPin.mock.calls[0][2]).toBe(`ip:${mac("198.51.100.9")}`);
  });

  it("a bad body is 400, nothing counted, no device cookie", async () => {
    const res = await call({}, { personId: "x" });
    expect(res.status).toBe(400);
    expect(checkPin).not.toHaveBeenCalled();
    expect(jar.set).toEqual([]);
  });
});
