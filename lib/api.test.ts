import { afterEach, describe, expect, it, vi } from "vitest";
import { postReceipt } from "./api";

type Reply = "network" | { status: number; body?: unknown; html?: boolean };

// Stub the browser fetch with a script of replies and count the requests.
function stub(script: Reply[]) {
  const calls = { n: 0 };
  vi.stubGlobal("fetch", async () => {
    calls.n++;
    const r = script.shift()!;
    if (r === "network") throw new TypeError("Failed to fetch");
    if (r.html) return new Response("<html>Vercel page</html>", { status: r.status });
    return Response.json(r.body ?? {}, { status: r.status });
  });
  return calls;
}
const jpeg = new Blob(["x"], { type: "image/jpeg" });
const fail = (error: string, retryable: boolean) => ({ error, message: "m", retryable });

afterEach(() => vi.unstubAllGlobals());

describe("postReceipt", () => {
  it("returns the reading", async () => {
    stub([{ status: 200, body: { lines: [] } }]);
    expect(await postReceipt(jpeg)).toEqual({ ok: true, reading: { lines: [] } });
  });

  it("does not auto-retry a bad reading: it is shown with Try again", async () => {
    const calls = stub([{ status: 502, body: fail("bad_output", true) }, { status: 200 }]);
    expect(await postReceipt(jpeg)).toMatchObject({ ok: false, error: "bad_output", retryable: true });
    expect(calls.n).toBe(1);
  });

  it("retries a network failure once, and nothing else: the server already retried Gemini", async () => {
    const a = stub(["network", { status: 200, body: { lines: [] } }]);
    expect((await postReceipt(jpeg)).ok).toBe(true);
    expect(a.n).toBe(2);
    const b = stub([{ status: 503, body: fail("unavailable", true) }, { status: 200 }]);
    expect(await postReceipt(jpeg)).toMatchObject({ ok: false, error: "unavailable", retryable: true });
    expect(b.n).toBe(1);
  });

  it("never resends after a client timeout: the first request may still be running", async () => {
    const calls = { n: 0 };
    vi.stubGlobal("fetch", async () => {
      calls.n++;
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    });
    expect(await postReceipt(jpeg)).toMatchObject({ ok: false, error: "timeout", retryable: true });
    expect(calls.n).toBe(1);
  });

  it("treats a non-JSON 4xx page as the answer: not retried, not retryable", async () => {
    const calls = stub([{ status: 401, html: true }, { status: 200 }]);
    expect(await postReceipt(jpeg)).toMatchObject({ ok: false, error: "internal", retryable: false });
    expect(calls.n).toBe(1);
  });
});
