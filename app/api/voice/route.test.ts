import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiError } from "@/lib/gemini";

const { readVoice, currentPerson, query } = vi.hoisted(() => ({ readVoice: vi.fn(), currentPerson: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/gemini", async (orig) => ({ ...(await orig<typeof import("@/lib/gemini")>()), readVoice }));
vi.mock("@/lib/session", () => ({ currentPerson }));
vi.mock("@/lib/db", () => ({ query }));
const { POST } = await import("./route");

const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(100)]);
const post = (bytes: Buffer, items: unknown = ["MILK", "BREAD"]) => {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: "audio/webm" }), "voice");
  form.append("items", typeof items === "string" ? items : JSON.stringify(items));
  return POST(new Request("http://x/api/voice", { method: "POST", body: form }));
};
const json = async (res: Response) => ({ status: res.status, ...(await res.json()) });

beforeEach(() => {
  readVoice.mockReset();
  currentPerson.mockResolvedValue({ id: 1, name: "Kaushik", role: "admin" });
  query.mockResolvedValue([{ id: 7, name: "Soham" }]);
});

describe("POST /api/voice", () => {
  it("refuses a signed-out device before spending anything", async () => {
    currentPerson.mockResolvedValueOnce(null);
    expect(await json(await post(WEBM))).toMatchObject({ status: 401, error: "signed_out" });
    expect(readVoice).not.toHaveBeenCalled();
  });

  it("takes the audio type from the bytes, not the browser's label", async () => {
    readVoice.mockResolvedValueOnce({ reading: { transcript: "t", changes: [], dropped: [], partner_name: null }, model: "m" });
    const wav = Buffer.concat([Buffer.from("RIFF\0\0\0\0WAVEfmt ", "latin1"), Buffer.alloc(100)]); // labelled audio/webm by post()
    expect((await post(wav)).status).toBe(200);
    expect(readVoice.mock.calls[0][1]).toBe("audio/wav");
  });

  it("rejects bytes that are not a known audio format", async () => {
    expect(await json(await post(Buffer.from("<html>not audio</html>")))).toMatchObject({ status: 415, error: "unsupported_audio" });
    expect(readVoice).not.toHaveBeenCalled();
  });

  it("rejects a missing or malformed item list, saying so", async () => {
    for (const items of ["[]", "not json", JSON.stringify([1, 2]), JSON.stringify(["x".repeat(81)]), JSON.stringify(Array(201).fill("a"))]) {
      expect(await json(await post(WEBM, items))).toMatchObject({ status: 400, error: "bad_items" });
    }
    expect(readVoice).not.toHaveBeenCalled();
  });

  it("sends only the audio and item names, and maps a spoken name to the person's id", async () => {
    readVoice.mockResolvedValueOnce({ reading: { transcript: "t", changes: [{ item: 1, share: "split" }], dropped: [3], partner_name: "soham" }, model: "m" });
    const r = await json(await post(WEBM));
    expect(r).toMatchObject({ status: 200, partner: 7, dropped: [3], changes: [{ item: 1, share: "split" }] });
    expect(r).not.toHaveProperty("partner_name");
    expect(readVoice.mock.calls[0].slice(2)).toEqual([["MILK", "BREAD"]]);
  });

  it("answers partner null for a name that is nobody here", async () => {
    readVoice.mockResolvedValueOnce({ reading: { transcript: "t", changes: [], dropped: [], partner_name: "Priya" }, model: "m" });
    expect(await json(await post(WEBM))).toMatchObject({ status: 200, partner: null });
  });

  it("pauses voice on the free-tier limit and says until when", async () => {
    readVoice.mockRejectedValueOnce(new GeminiError("quota", "429", false, 60, true));
    const r = await json(await post(WEBM));
    expect(r).toMatchObject({ status: 429, error: "ai_paused", retryable: false });
    expect(Date.parse(r.until) - Date.now()).toBeGreaterThan(55_000);
  });

  it("treats a non-transient Gemini failure as not retryable", async () => {
    readVoice.mockRejectedValueOnce(new GeminiError("unavailable", "400", false));
    expect(await json(await post(WEBM))).toMatchObject({ status: 502, retryable: false });
  });
});
