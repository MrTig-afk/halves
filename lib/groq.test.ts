import { describe, expect, it } from "vitest";
import { GeminiError } from "./gemini";
import { hearVoice } from "./groq";
import { VoiceError } from "./voice";

type Reply = number | "timeout" | "null" | { text: string; noSpeech?: number } | { chat: unknown } | { gemini: unknown };
type Call = { url: string; body: unknown };

// A fake fetch answering each call from a script; records the URL and the body sent.
function fakeFetch(script: Reply[]) {
  const calls: Call[] = [];
  const f = (async (url: string, init: { body: unknown }) => {
    calls.push({ url: String(url), body: init.body });
    const r = script.shift()!;
    if (r === "timeout") throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    if (typeof r === "number") return new Response("{}", { status: r });
    if (r === "null") return new Response("null", { status: 200 });
    if ("text" in r) return Response.json({ text: r.text, segments: [{ no_speech_prob: r.noSpeech ?? 0.1, avg_logprob: -0.3 }] });
    if ("chat" in r) return Response.json({ choices: [{ message: { content: typeof r.chat === "string" ? r.chat : JSON.stringify(r.chat) } }] });
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(r.gemini) }] } }] });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const AUDIO = Buffer.from("fake-audio");
const ITEMS = ["MILK", "BREAD"];
const NAMES = ["Kaushik", "Rahul"];
const hear = (script: Reply[], over: { groqKey?: string; items?: string[]; names?: string[] } = {}) => {
  const { f, calls } = fakeFetch(script);
  const groqKey = "groqKey" in over ? over.groqKey : "test-groq";
  return { calls, p: hearVoice(AUDIO, "audio/webm", over.items ?? ITEMS, over.names ?? NAMES, { fetch: f, groqKey, geminiKey: "test-gemini" }) };
};
const geminiOk = { gemini: { transcript: "g", changes: [{ item: 1, who: ["me"] }] } };
const chatOk = { chat: { changes: [{ item: 2, who: ["Rahul"] }] } };
const isGemini = (c: Call) => c.url.includes("generativelanguage");

describe("hearVoice", () => {
  it("1. Whisper then gpt-oss-120b, never Gemini", async () => {
    const { calls, p } = hear([{ text: "bread is Rahul's" }, chatOk]);
    expect(await p).toEqual({ reading: { transcript: "bread is Rahul's", changes: [{ item: 2, who: ["Rahul"] }], dropped: [] }, model: "groq:whisper-large-v3+openai/gpt-oss-120b" });
    expect(calls.map((c) => c.url)).toEqual(["https://api.groq.com/openai/v1/audio/transcriptions", "https://api.groq.com/openai/v1/chat/completions"]);
    const form = calls[0].body as FormData;
    expect(form.get("model")).toBe("whisper-large-v3");
    expect((form.get("file") as Blob).size).toBe(AUDIO.length);
    for (const w of [...NAMES, ...ITEMS]) expect(String(form.get("prompt"))).toContain(w);
    const chat = JSON.parse(String(calls[1].body));
    expect(chat.model).toBe("openai/gpt-oss-120b");
    expect(chat.temperature).toBe(0);
    expect(chat.response_format.json_schema.strict).toBe(true);
    expect(chat.messages[0].content).toContain('{"1":"MILK","2":"BREAD"}');
    expect(chat.messages[0].content).toContain('["Kaushik","Rahul"]');
    expect(chat.messages[1]).toEqual({ role: "user", content: "bread is Rahul's" });
    expect(calls.some(isGemini)).toBe(false);
  });

  it("2. the Gemini fallback request holds no person's name", async () => {
    const { calls, p } = hear([{ text: "x" }, 429, 429, geminiOk]);
    await p;
    const g = calls.filter(isGemini);
    expect(g).toHaveLength(1);
    for (const n of NAMES) expect(String(g[0].body)).not.toContain(n); // mutation: pass names into readVoice -> red
    expect(String(g[0].body)).toContain("MILK");
  });

  it("3. a 120b 429 goes to 20b and uses its answer", async () => {
    const { calls, p } = hear([{ text: "x" }, 429, chatOk]);
    expect((await p).model).toBe("groq:whisper-large-v3+openai/gpt-oss-20b");
    expect(JSON.parse(String(calls[2].body)).model).toBe("openai/gpt-oss-20b");
  });

  it("4. 120b and 20b both 429 go to Gemini", async () => {
    const { calls, p } = hear([{ text: "x" }, 429, 429, geminiOk]);
    const r = await p;
    expect(r.model).toMatch(/^groq:whisper-large-v3\+gemini/);
    expect(r.reading.changes).toEqual([{ item: 1, who: ["me"] }]);
    expect(calls.filter(isGemini)).toHaveLength(1);
  });

  it("5. a Whisper 429 goes straight to Gemini; gpt-oss is never called", async () => {
    const { calls, p } = hear([429, geminiOk]);
    await p;
    expect(calls.map(isGemini)).toEqual([false, true]);
  });

  it("6. no Groq key goes to Gemini and never touches Groq", async () => {
    const { calls, p } = hear([geminiOk], { groqKey: "" });
    await p;
    expect(calls).toHaveLength(1);
    expect(isGemini(calls[0])).toBe(true);
  });

  it("7. a Groq 500, 400 or timeout is a GeminiError with no Gemini call", async () => {
    const cases: [Reply[], string, boolean][] = [
      [[500], "unavailable", true],
      [["timeout"], "timeout", true],
      [[{ text: "x" }, 500], "unavailable", true],
      [[{ text: "x" }, "timeout"], "timeout", true],
      [[400], "unavailable", false],
    ];
    for (const [script, code, transient] of cases) {
      const { calls, p } = hear(script);
      const e = await p.catch((x) => x);
      expect(e).toBeInstanceOf(GeminiError);
      expect(e.code).toBe(code);
      expect(e.transient).toBe(transient);
      expect(calls.some(isGemini)).toBe(false);
    }
  });

  it("8. bad model output is rejected or dropped as parseVoice does", async () => {
    await expect(hear([{ text: "x" }, { chat: { changes: [], transcript: "sneaky" } }]).p).rejects.toBeInstanceOf(VoiceError);
    await expect(hear([{ text: "x" }, { chat: "not json" }]).p).rejects.toBeInstanceOf(VoiceError);
    const r = await hear([{ text: "x" }, { chat: { changes: [{ item: 9, who: ["me"] }, { item: 1, who: ["me"] }] } }]).p;
    expect(r.reading).toMatchObject({ changes: [{ item: 1, who: ["me"] }], dropped: [9] });
  });

  it("9. a long bill keeps every first name in the Whisper prompt and caps it", async () => {
    const items = Array.from({ length: 60 }, (_, i) => `ITEM NUMBER ${i} WITH A LONG NAME`);
    const names = ["Kaushik", "Rahul", "Priya", "Ana", "Zed"];
    const { calls, p } = hear([{ text: "x" }, chatOk], { items, names });
    await p;
    const prompt = String((calls[0].body as FormData).get("prompt"));
    expect(prompt.length).toBeLessThanOrEqual(400);
    expect(prompt.endsWith("Kaushik, Rahul, Priya, Ana, Zed")).toBe(true); // Whisper keeps the end of a long prompt
    expect(prompt).not.toContain("ITEM NUMBER 0 WITH"); // the cut takes the start
  });

  it("an empty transcript returns no changes without calling gpt-oss", async () => {
    const { calls, p } = hear([{ text: "  \n " }]);
    expect((await p).reading).toEqual({ transcript: "", changes: [], dropped: [] });
    expect(calls).toHaveLength(1);
  });

  it("a word Whisper made up for silence (no_speech_prob 0.97, as measured) is nothing heard; real speech goes on", async () => {
    const silent = hear([{ text: " you", noSpeech: 0.97 }]);
    expect((await silent.p).reading).toEqual({ transcript: "", changes: [], dropped: [] });
    expect(silent.calls).toHaveLength(1);
    const real = hear([{ text: "Bread, Kaushik", noSpeech: 0.33 }, chatOk]); // positive control: a short real sentence (measured 0.33)
    expect((await real.p).reading.changes).toEqual([{ item: 2, who: ["Rahul"] }]);
    expect(String((real.calls[0].body as FormData).get("response_format"))).toBe("verbose_json");
  });

  it("a JSON null answer is an unreadable reply, never a 429", async () => {
    const { calls, p } = hear(["null"]);
    const e = await p.catch((x) => x);
    expect(e).toBeInstanceOf(GeminiError);
    expect(e.transient).toBe(true);
    expect(calls.some(isGemini)).toBe(false);
  });

  it("a transcription without text is an unreadable reply, not silence", async () => {
    const e = await hear([{ text: 5 as unknown as string }]).p.catch((x) => x);
    expect(e).toBeInstanceOf(GeminiError);
    expect(e.transient).toBe(true);
  });

  it("the log names a Whisper 429 in the chain", async () => {
    expect((await hear([429, geminiOk]).p).model).toMatch(/^groq:whisper-large-v3:429\+gemini/);
  });
});
