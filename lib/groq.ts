// Voice on Groq over plain fetch (no SDK): Whisper hears the clip, gpt-oss turns the words into who-had-what.
// A 429 moves down the chain (120b -> 20b -> Gemini); any other failure is a GeminiError with no fallback.
// Groq gets the clip, item names and first names (PRD 10.2); Gemini, the last step, never gets a name.
import { GeminiError, readVoice } from "./gemini";
import { parseVoice, VoiceError, voiceTextPrompt, type VoiceReading } from "./voice";

const BASE = "https://api.groq.com/openai/v1";
const TIMEOUT_MS = 15_000;
const WHISPER = "whisper-large-v3";
const CHAT_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
// Whisper reads only the LAST 224 tokens of its prompt, so the hint keeps its end, and the names go
// last to survive the cut (Groq accepts a longer prompt - measured 2026-10-02 with 764 characters).
const MAX_HINT = 400;
// Whisper makes up a word for a silent clip (measured: "you") but marks it: every segment's
// no_speech_prob above this means nothing was said (measured 0.97 silent, 0.33 for "Bread, Kaushik").
const NO_SPEECH = 0.8;

const CHANGES_SCHEMA = {
  type: "object",
  properties: {
    changes: {
      type: "array",
      items: {
        type: "object",
        properties: { item: { type: "integer" }, who: { type: "array", items: { type: "string" } } },
        required: ["item", "who"],
        additionalProperties: false,
      },
    },
  },
  required: ["changes"],
  additionalProperties: false,
};

type Deps = { fetch?: typeof fetch; groqKey?: string; geminiKey?: string };

// The parsed JSON answer, or null on a 429 (the caller moves down the chain).
async function groq(path: string, init: { body: BodyInit; json?: boolean }, key: string, f: typeof fetch): Promise<Record<string, unknown> | null> {
  try {
    const res = await f(`${BASE}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, ...(init.json ? { "content-type": "application/json" } : {}) },
      body: init.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 429) return null;
    if (!res.ok) throw new GeminiError("unavailable", `groq ${path} returned ${res.status}`, res.status >= 500);
    const body: unknown = await res.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new GeminiError("unavailable", `groq ${path} answered no object`, true); // never read as a 429
    return body as Record<string, unknown>;
  } catch (e) {
    if (e instanceof GeminiError) throw e;
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) throw new GeminiError("timeout", `groq ${path} timed out`, true);
    throw new GeminiError("unavailable", `groq ${path} unreachable or unreadable`, true);
  }
}

export async function hearVoice(audio: Buffer, mime: string, items: string[], names: string[], deps: Deps = {}): Promise<{ reading: VoiceReading; model: string }> {
  const f = deps.fetch ?? fetch;
  const key = deps.groqKey ?? process.env.GROQ_API_KEY ?? "";
  // Gemini gets the audio and item names only - never `names`.
  const gemini = async (prefix: string) => {
    const { reading, model } = await readVoice(audio, mime, items, { fetch: f, apiKey: deps.geminiKey });
    return { reading, model: prefix + model };
  };
  if (!key) return gemini("");

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `voice.${mime.slice(6)}`);
  form.append("model", WHISPER);
  const hint = [...items, ...names].join(", ").slice(-MAX_HINT);
  form.append("prompt", hint);
  form.append("language", "en");
  form.append("response_format", "verbose_json"); // adds segments with no_speech_prob
  form.append("temperature", "0");
  const heard = await groq("/audio/transcriptions", { body: form }, key, f);
  if (!heard) return gemini(`groq:${WHISPER}:429+`);
  if (typeof heard.text !== "string") throw new GeminiError("unavailable", "groq transcription has no text", true);
  const transcript = heard.text;
  // Silence is never turned into changes, whatever word Whisper made up for it.
  const segments = Array.isArray(heard.segments) ? (heard.segments as { no_speech_prob?: unknown }[]) : [];
  const silent = segments.length > 0 && segments.every((s) => typeof s.no_speech_prob === "number" && s.no_speech_prob > NO_SPEECH);
  if (!transcript.trim() || silent) return { reading: { transcript: "", changes: [], dropped: [] }, model: `groq:${WHISPER}` };

  for (const model of CHAT_MODELS) {
    const out = await groq(
      "/chat/completions",
      {
        json: true,
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            { role: "system", content: voiceTextPrompt(items, names) },
            { role: "user", content: transcript },
          ],
          response_format: { type: "json_schema", json_schema: { name: "voice_changes", strict: true, schema: CHANGES_SCHEMA } },
        }),
      },
      key,
      f,
    );
    if (!out) continue;
    const content = (out as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(String(content));
    } catch {
      throw new VoiceError("not JSON");
    }
    if (!o || typeof o !== "object" || Array.isArray(o) || Object.keys(o).some((k) => k !== "changes")) throw new VoiceError("not just changes");
    return { reading: parseVoice(JSON.stringify({ transcript, changes: o.changes }), items.length), model: `groq:${WHISPER}+${model}` };
  }
  return gemini(`groq:${WHISPER}+`);
}
