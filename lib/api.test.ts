import { afterEach, describe, expect, it, vi } from "vitest";
import { postReceipt, postVoice, saveFailure } from "./api";

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

describe("postVoice", () => {
  it("sends the audio with the item names and returns what was heard", async () => {
    let sent: FormData | null = null;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent = init.body as FormData;
      return Response.json({ transcript: "t", changes: [{ item: 1, people: [1, 7] }], dropped: [] });
    });
    const r = await postVoice(new Blob(["a"], { type: "audio/webm" }), ["MILK", "BREAD"], [1, 7]);
    expect(r).toEqual({ ok: true, transcript: "t", changes: [{ item: 1, people: [1, 7] }], dropped: [] });
    expect(sent!.get("items")).toBe('["MILK","BREAD"]');
    expect(sent!.get("people")).toBe("[1,7]");
  });

  it("passes a paused-voice answer through with its time", async () => {
    stub([{ status: 429, body: { error: "ai_paused", message: "m", retryable: false, until: "2026-09-29T10:00:00Z" } }]);
    expect(await postVoice(new Blob(["a"]), ["MILK"], [1, 7])).toEqual({ ok: false, error: "ai_paused", message: "m", retryable: false, until: "2026-09-29T10:00:00Z" });
  });
});

describe("saveFailure", () => {
  const generic = { error: "bad_bill", message: "Something on this bill isn't right. Check the lines and try again.", retryable: false };
  it("offers Retry with the approved text for a failure worth sending again", () => {
    expect(saveFailure({ error: "network", message: "x", retryable: true })).toEqual({ text: "Couldn't save. Check your connection and try again. Nothing you entered is lost.", retry: true });
  });
  it("shows the server's own message for a refusal, with no Retry", () => {
    expect(saveFailure({ error: "bad_bill", message: "Add at least one other person.", retryable: false })).toEqual({ text: "Add at least one other person.", retry: false });
    expect(saveFailure(generic)).toEqual({ text: generic.message, retry: false });
  });
  it("never says 'Check the lines' on a screen with no lines", () => {
    expect(saveFailure(generic, false).text).toBe("Something went wrong. Try again.");
    expect(saveFailure({ ...generic, message: "Pick who this bill is with." }, false).text).toBe("Pick who this bill is with.");
  });
});
