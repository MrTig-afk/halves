import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiError } from "@/lib/gemini";

const { readReceipt, currentPerson } = vi.hoisted(() => ({ readReceipt: vi.fn(), currentPerson: vi.fn() }));
vi.mock("@/lib/gemini", async (orig) => ({ ...(await orig<typeof import("@/lib/gemini")>()), readReceipt }));
vi.mock("@/lib/session", () => ({ currentPerson }));
const { POST } = await import("./route");

const post = (bytes: Buffer) => {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), "r.jpg");
  return POST(new Request("http://x/api/receipt", { method: "POST", body: form }));
};
const receipt = readFileSync("fixtures/public/coles.jpg");
const answer = async (e: unknown) => {
  readReceipt.mockRejectedValueOnce(e);
  const res = await post(receipt);
  return { status: res.status, ...(await res.json()) };
};

beforeEach(() => {
  readReceipt.mockReset();
  currentPerson.mockResolvedValue({ id: 1, name: "K", role: "admin" });
});

describe("POST /api/receipt", () => {
  it("returns the reading for a real photo", async () => {
    readReceipt.mockResolvedValueOnce({ reading: { lines: [] }, model: "m" });
    const res = await post(receipt);
    expect(res.status).toBe(200);
    expect(readReceipt).toHaveBeenCalledOnce();
  });

  it("marks a permanent Gemini failure as not worth retrying", async () => {
    expect(await answer(new GeminiError("unavailable", "400", false))).toMatchObject({ status: 502, retryable: false });
  });

  it("marks a transient failure as retryable, and a timeout as 504", async () => {
    expect(await answer(new GeminiError("unavailable", "503", true))).toMatchObject({ status: 503, retryable: true });
    expect(await answer(new GeminiError("timeout", "slow", true))).toMatchObject({ status: 504, retryable: true });
  });

  it("stops at the free-tier limit with the paused message", async () => {
    expect(await answer(new GeminiError("quota", "429"))).toMatchObject({ status: 429, error: "ai_paused", retryable: false });
  });

  it("refuses a signed-out device before reading anything", async () => {
    currentPerson.mockResolvedValueOnce(null);
    const res = await post(receipt);
    expect(res.status).toBe(401);
    expect(readReceipt).not.toHaveBeenCalled();
  });

  it("refuses a non-image before calling Gemini", async () => {
    const res = await post(Buffer.from("<html>not an image</html>"));
    expect(res.status).toBe(415);
    expect(readReceipt).not.toHaveBeenCalled();
  });
});
