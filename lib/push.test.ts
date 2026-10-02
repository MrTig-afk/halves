import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, sendNotification } = vi.hoisted(() => ({ query: vi.fn(), sendNotification: vi.fn() }));
vi.mock("./db", () => ({ query }));
vi.mock("web-push", () => ({ default: { sendNotification } }));
const { hasPush, notify, pushEndpoint } = await import("./push");

const sub = (id: number) => ({ id, endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, p256dh: "p", auth: "a" });

beforeEach(() => {
  query.mockReset();
  sendNotification.mockReset();
  vi.stubEnv("VAPID_PUBLIC_KEY", "public");
  vi.stubEnv("VAPID_PRIVATE_KEY", "private");
  vi.stubEnv("ADMIN_EMAIL", "admin@example.com");
});

describe("pushEndpoint", () => {
  it("accepts the browser push services and nothing else", () => {
    for (const ok of [
      "https://fcm.googleapis.com/fcm/send/abc:APA91b",
      "https://web.push.apple.com/QGx",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAA",
      "https://wns2-par02p.notify.windows.com/w/?token=x",
    ]) {
      expect(pushEndpoint(ok)).toBe(ok);
    }
    for (const bad of [
      "https://evil.com/?fcm.googleapis.com",
      "https://fcm.googleapis.com.evil.com/x",
      "http://fcm.googleapis.com/x",
      "https://localhost/x",
      "https://169.254.169.254/latest",
      Object.assign(new URL("https://fcm.googleapis.com/x"), { username: "someone" }).href, // userinfo in the URL
      `https://fcm.googleapis.com/${"x".repeat(1000)}`,
      42,
      null,
    ]) {
      expect(pushEndpoint(bad)).toBeNull();
    }
  });
});

describe("notify", () => {
  it("sends the note to every phone of that person, and deletes a subscription the push service no longer knows", async () => {
    query.mockResolvedValueOnce([sub(1), sub(2), sub(3), sub(4)]).mockResolvedValue([]);
    sendNotification
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }))
      .mockRejectedValueOnce(Object.assign(new Error("busy"), { statusCode: 503 }))
      .mockRejectedValueOnce(Object.assign(new Error("key mismatch"), { statusCode: 403 }));
    await notify(4, { title: "Kaushik added a bill", url: "/bill/5" });
    expect(query.mock.calls[0]).toEqual(["select id::int, endpoint, p256dh, auth from push_targets($1)", [4]]); // no personId: the function reads another person's phones
    expect(sendNotification).toHaveBeenCalledTimes(4);
    const [target, payload, options] = sendNotification.mock.calls[0];
    expect(target).toEqual({ endpoint: sub(1).endpoint, keys: { p256dh: "p", auth: "a" } });
    expect(JSON.parse(payload)).toEqual({ title: "Kaushik added a bill", url: "/bill/5" });
    expect(options.vapidDetails).toEqual({ subject: "mailto:admin@example.com", publicKey: "public", privateKey: "private" });
    // gone (410) and refused for our key (403) are removed; a busy push service is not a dead subscription
    expect(query.mock.calls.slice(1)).toEqual([
      ["select drop_push($1)", [2]],
      ["select drop_push($1)", [4]],
    ]);
  });

  it("sends nothing when the keys are not configured", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    await notify(4, { title: "x", url: "/" });
    expect(query).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe("hasPush", () => {
  it("is true only when push is set up and the person has a phone for it, and never throws", async () => {
    query.mockResolvedValueOnce([{ yes: true }]);
    expect(await hasPush(4)).toBe(true);
    expect(query.mock.calls[0]).toEqual(["select exists (select 1 from push_targets($1)) as yes", [4]]);
    query.mockRejectedValueOnce(new Error("connection reset"));
    expect(await hasPush(4)).toBe(false); // the bill is already saved; the flag must not fail it
    vi.stubEnv("ADMIN_EMAIL", "");
    query.mockResolvedValueOnce([{ yes: true }]);
    expect(await hasPush(4)).toBe(false); // nothing would be sent
  });
});
