import { beforeEach, describe, expect, it, vi } from "vitest";

const { currentPerson, currentSessionId, query } = vi.hoisted(() => ({ currentPerson: vi.fn(), currentSessionId: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/session", () => ({ currentPerson, currentSessionId }));
vi.mock("@/lib/db", () => ({ query }));
const { GET, POST, DELETE } = await import("./route");

const SESSION = "1b4e28ba-2fa1-41d2-883f-0016d3cca427";
const endpoint = "https://fcm.googleapis.com/fcm/send/abc";
const keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };
const send = (method: "POST" | "DELETE", body: unknown) =>
  (method === "POST" ? POST : DELETE)(new Request("http://x/api/push", { method, body: JSON.stringify(body) }));

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue([{ yes: true }]);
  currentPerson.mockResolvedValue({ id: 4, name: "Soham", role: "member" });
  currentSessionId.mockResolvedValue(SESSION);
});

describe("/api/push", () => {
  it("is for a signed-in phone only", async () => {
    currentPerson.mockResolvedValue(null);
    expect((await send("POST", { endpoint, keys })).status).toBe(401);
    expect((await DELETE(new Request("http://x/api/push", { method: "DELETE", body: "{}" }))).status).toBe(401);
    expect((await GET(new Request(`http://x/api/push?endpoint=${endpoint}`))).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it("saves this phone's subscription for this person and session, one per session", async () => {
    expect(await (await send("POST", { endpoint, keys })).json()).toEqual({ on: true });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/delete from push_subscription where session_id = \$2 and endpoint <> \$3/);
    expect(sql).toMatch(/on conflict \(endpoint\) do update/);
    expect(params).toEqual([4, SESSION, endpoint, keys.p256dh, keys.auth]);
  });

  it("refuses an endpoint that is not a browser push service, and malformed keys", async () => {
    for (const body of [
      { endpoint: "https://169.254.169.254/latest/meta-data", keys },
      { endpoint: "http://fcm.googleapis.com/x", keys },
      { endpoint, keys: { p256dh: "short", auth: keys.auth } },
      { endpoint, keys: { p256dh: keys.p256dh, auth: "not base64!" } },
      { endpoint, keys: { p256dh: [keys.p256dh], auth: keys.auth } }, // an array stringifies to a valid key
      { endpoint },
      null,
    ]) {
      expect((await send("POST", body)).status).toBe(400);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("reports on only for this session's subscription, and removes only the person's own", async () => {
    expect(await (await GET(new Request(`http://x/api/push?endpoint=${encodeURIComponent(endpoint)}`))).json()).toEqual({ on: true });
    expect(query.mock.calls[0][1]).toEqual([endpoint, SESSION]);
    query.mockClear();
    expect(await (await GET(new Request("http://x/api/push?endpoint=https://evil.com/x"))).json()).toEqual({ on: false });
    expect(query).not.toHaveBeenCalled();
    await send("DELETE", { endpoint });
    expect(query.mock.calls[0]).toEqual(["delete from push_subscription where endpoint = $1 and person_id = $2", [endpoint, 4]]);
  });
});
