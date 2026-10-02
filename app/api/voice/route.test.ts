import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiError } from "@/lib/gemini";

const { hearVoice, currentPerson, people } = vi.hoisted(() => ({ hearVoice: vi.fn(), currentPerson: vi.fn(), people: vi.fn() }));
vi.mock("@/lib/groq", () => ({ hearVoice }));
vi.mock("@/lib/session", () => ({ currentPerson }));
vi.mock("@/lib/people", () => ({ people }));
const { POST } = await import("./route");

const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(100)]);
const post = (bytes: Buffer, items: unknown = ["MILK", "BREAD"], ids: unknown = [1, 7, 8]) => {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: "audio/webm" }), "voice");
  form.append("items", typeof items === "string" ? items : JSON.stringify(items));
  if (ids !== null) form.append("people", typeof ids === "string" ? ids : JSON.stringify(ids));
  return POST(new Request("http://x/api/voice", { method: "POST", body: form }));
};
const json = async (res: Response) => ({ status: res.status, ...(await res.json()) });

beforeEach(() => {
  hearVoice.mockReset();
  currentPerson.mockResolvedValue({ id: 1, name: "Kaushik", role: "admin" });
  people.mockResolvedValue([
    { id: 1, name: "Kaushik" },
    { id: 7, name: "Rahul" },
    { id: 8, name: "Priya" },
    { id: 9, name: "Ana" },
  ]);
});

describe("POST /api/voice", () => {
  it("refuses a signed-out device before spending anything", async () => {
    currentPerson.mockResolvedValueOnce(null);
    expect(await json(await post(WEBM))).toMatchObject({ status: 401, error: "signed_out" });
    expect(hearVoice).not.toHaveBeenCalled();
  });

  it("takes the audio type from the bytes, not the browser's label", async () => {
    hearVoice.mockResolvedValueOnce({ reading: { transcript: "t", changes: [], dropped: [] }, model: "m" });
    const wav = Buffer.concat([Buffer.from("RIFF\0\0\0\0WAVEfmt ", "latin1"), Buffer.alloc(100)]); // labelled audio/webm by post()
    expect((await post(wav)).status).toBe(200);
    expect(hearVoice.mock.calls[0][1]).toBe("audio/wav");
  });

  it("rejects bytes that are not a known audio format", async () => {
    expect(await json(await post(Buffer.from("<html>not audio</html>")))).toMatchObject({ status: 415, error: "unsupported_audio" });
    expect(hearVoice).not.toHaveBeenCalled();
  });

  it("rejects a missing or malformed item list, saying so", async () => {
    for (const items of ["[]", "not json", JSON.stringify([1, 2]), JSON.stringify(["x".repeat(201)]), JSON.stringify(Array(201).fill("a"))]) {
      expect(await json(await post(WEBM, items))).toMatchObject({ status: 400, error: "bad_items" });
    }
    expect(hearVoice).not.toHaveBeenCalled();
  });

  it("takes an item name as long as the receipt allows", async () => {
    hearVoice.mockResolvedValueOnce({ reading: { transcript: "t", changes: [], dropped: [] }, model: "m" });
    expect((await post(WEBM, Array(200).fill("x".repeat(200)))).status).toBe(200);
  });

  it("refuses a bad people field before calling Gemini", async () => {
    for (const ids of [null, "not json", [1], [1, 7, 8, 9, 10, 11], [1, 7, 7], [7, 8], [1, 0], [1, "7"], [1, 1.5], {}]) {
      expect(await json(await post(WEBM, ["MILK"], ids))).toMatchObject({ status: 400, error: "bad_items" });
    }
    expect(hearVoice).not.toHaveBeenCalled();
  });

  it("hears through hearVoice only, with the item names and the bill's first names (not Ana's)", async () => {
    hearVoice.mockResolvedValueOnce({ reading: { transcript: "t", changes: [], dropped: [] }, model: "m" });
    people.mockResolvedValueOnce([{ id: 1, name: "Kaushik N" }, { id: 7, name: "Rahul" }, { id: 8, name: "Priya" }, { id: 9, name: "Ana" }]);
    await post(WEBM);
    expect(hearVoice).toHaveBeenCalledTimes(1);
    expect(hearVoice.mock.calls[0].slice(2)).toEqual([["MILK", "BREAD"], ["Kaushik", "Rahul", "Priya"]]);
  });

  it("maps me, everyone and names to the bill's people ids", async () => {
    hearVoice.mockResolvedValueOnce({
      reading: {
        transcript: "t",
        changes: [
          { item: 1, who: ["me"] },
          { item: 2, who: ["Everyone"] },
          { item: 3, who: ["Rahul's"] },
          { item: 4, who: ["me", "priya"] },
          { item: 5, who: ["Ana's"] },
          { item: 6, who: ["me", "Ana"] },
        ],
        dropped: [9],
      },
      model: "m",
    });
    const r = await json(await post(WEBM, ["a", "b", "c", "d", "e", "f"], [1, 7, 8]));
    expect(r).toMatchObject({
      status: 200,
      dropped: [9],
      changes: [{ item: 1, people: [1] }, { item: 2, people: [1, 7, 8] }, { item: 3, people: [7] }, { item: 4, people: [1, 8] }, { item: 6, people: [1] }],
    });
  });

  it("takes the speaker's and everyone's other spoken forms, punctuation and all", async () => {
    hearVoice.mockResolvedValueOnce({
      reading: { transcript: "t", changes: [{ item: 1, who: ["I"] }, { item: 2, who: ["Mine."] }, { item: 3, who: ["All"] }, { item: 4, who: ["Everybody!"] }], dropped: [] },
      model: "m",
    });
    const r = await json(await post(WEBM, ["a", "b", "c", "d"], [1, 7, 8]));
    expect(r.changes).toEqual([{ item: 1, people: [1] }, { item: 2, people: [1] }, { item: 3, people: [1, 7, 8] }, { item: 4, people: [1, 7, 8] }]);
  });

  it("reads split/shared as everyone, and a pronoun as the other person only on a bill of two", async () => {
    const reply = { transcript: "t", changes: [{ item: 1, who: ["split"] }, { item: 2, who: ["them"] }, { item: 3, who: ["Hers"] }], dropped: [] };
    hearVoice.mockResolvedValueOnce({ reading: reply, model: "m" });
    expect((await json(await post(WEBM, ["a", "b", "c"], [1, 7]))).changes).toEqual([{ item: 1, people: [1, 7] }, { item: 2, people: [7] }, { item: 3, people: [7] }]);
    hearVoice.mockResolvedValueOnce({ reading: reply, model: "m" });
    expect((await json(await post(WEBM, ["a", "b", "c"], [1, 7, 8]))).changes).toEqual([{ item: 1, people: [1, 7, 8] }]); // no one person to give "them" to
  });

  it("pauses voice on the free-tier limit and says until when", async () => {
    hearVoice.mockRejectedValueOnce(new GeminiError("quota", "429", false, 60, true));
    const r = await json(await post(WEBM));
    expect(r).toMatchObject({ status: 429, error: "ai_paused", retryable: false });
    expect(Date.parse(r.until) - Date.now()).toBeGreaterThan(55_000);
  });

  it("treats a non-transient Gemini failure as not retryable", async () => {
    hearVoice.mockRejectedValueOnce(new GeminiError("unavailable", "400", false));
    expect(await json(await post(WEBM))).toMatchObject({ status: 502, retryable: false });
  });
});
