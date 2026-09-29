// Gemini over plain fetch (no SDK). Free tier only: a 429 is the cost cap and is
// never retried. Primary model chosen in M0 by timing real reads (3.5 s vs 6.0 s on the sample).
import { parseReceipt, RECEIPT_PROMPT, RECEIPT_SCHEMA, type ReceiptReading } from "./receipt";
import { parseVoice, VOICE_SCHEMA, voicePrompt, type VoiceReading } from "./voice";

export const PRIMARY_MODEL = "gemini-3.5-flash-lite";
export const FALLBACK_MODEL = "gemini-2.5-flash";
const TIMEOUT_MS = 15_000;

export class GeminiError extends Error {
  constructor(
    readonly code: "quota" | "unavailable" | "timeout",
    message: string,
    readonly transient = false, // worth asking the same model again (5xx, timeout, network)
    readonly retryAfterS?: number, // on a 429: how long Google says to wait, when it says
    readonly daily = false, // on a 429: the per-day allowance is used up, not the per-minute one
  ) {
    super(message);
  }
}

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };
type Deps = { fetch?: typeof fetch; apiKey?: string; sleep?: (ms: number) => Promise<void> };

async function call(model: string, parts: Part[], schema: object, deps: Required<Deps>): Promise<string> {
  try {
    const res = await deps.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": deps.apiKey },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0 },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 429) {
      const { seconds, daily } = await quotaWait(res);
      throw new GeminiError("quota", `${model}: free AI limit reached`, false, seconds, daily);
    }
    if (!res.ok) throw new GeminiError("unavailable", `${model} returned ${res.status}`, res.status >= 500);
    const body = await res.json(); // the body read is inside the try: a timeout or bad JSON here is handled too
    return body?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  } catch (e) {
    if (e instanceof GeminiError) throw e;
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
      throw new GeminiError("timeout", `${model} timed out`, true);
    }
    throw new GeminiError("unavailable", `${model} unreachable or unreadable`, true);
  }
}

// How long until the free tier answers again, in seconds, or undefined when the 429 does not say.
// A per-day quota resets at midnight Pacific time; its RetryInfo only covers the next minute.
async function quotaWait(res: Response, now = new Date()): Promise<{ seconds?: number; daily: boolean }> {
  const body = await res.json().catch(() => null);
  const details: Record<string, unknown>[] = Array.isArray(body?.error?.details) ? body.error.details : [];
  const daily = details.some((d) => Array.isArray(d?.violations) && d.violations.some((v: { quotaId?: unknown }) => /PerDay/i.test(String(v?.quotaId))));
  if (daily) return { seconds: untilPacificMidnight(now), daily };
  for (const d of details) {
    const m = /^(\d+(?:\.\d+)?)s$/.exec(String(d?.retryDelay ?? ""));
    if (m) return { seconds: Math.min(Math.ceil(Number(m[1])), 86_400), daily };
  }
  return { daily };
}

// ponytail: reads the Pacific clock once, so a daylight-saving change night can be an hour off.
export function untilPacificMidnight(now: Date): number {
  const [h, m, s] = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .format(now)
    .split(":")
    .map(Number);
  return 86_400 - (h * 3600 + m * 60 + s);
}

// The moment a paused AI feature works again, for "paused until <time>" (userflow E4).
export const pausedUntil = (e: GeminiError) => (e.retryAfterS ? new Date(Date.now() + e.retryAfterS * 1000).toISOString() : undefined);

// Primary twice only for transient failures (5xx, timeout, network), then the fallback once;
// a 4xx other than 429 skips straight to the fallback. A per-minute quota stops everything at
// once; a per-day quota is per model, so the fallback's own free allowance gets one try.
export async function generateJson(parts: Part[], schema: object, deps: Deps = {}): Promise<{ text: string; model: string }> {
  const d: Required<Deps> = {
    fetch: deps.fetch ?? fetch,
    apiKey: deps.apiKey ?? process.env.GEMINI_API_KEY ?? "",
    sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
  };
  if (!d.apiKey) throw new GeminiError("unavailable", "GEMINI_API_KEY is not set");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return { text: await call(PRIMARY_MODEL, parts, schema, d), model: PRIMARY_MODEL };
    } catch (e) {
      if (!(e instanceof GeminiError) || (e.code === "quota" && !e.daily)) throw e;
      if (!e.transient) break;
      if (attempt === 0) await d.sleep(500);
    }
  }
  return { text: await call(FALLBACK_MODEL, parts, schema, d), model: FALLBACK_MODEL };
}

export async function readReceipt(jpeg: Buffer, deps: Deps = {}): Promise<{ reading: ReceiptReading; model: string }> {
  const { text, model } = await generateJson(
    [{ inline_data: { mime_type: "image/jpeg", data: jpeg.toString("base64") } }, { text: RECEIPT_PROMPT }],
    RECEIPT_SCHEMA,
    deps,
  );
  return { reading: parseReceipt(text), model };
}

export async function readVoice(audio: Buffer, mime: string, items: string[], deps: Deps = {}): Promise<{ reading: VoiceReading; model: string }> {
  const { text, model } = await generateJson(
    [{ inline_data: { mime_type: mime, data: audio.toString("base64") } }, { text: voicePrompt(items) }],
    VOICE_SCHEMA,
    deps,
  );
  return { reading: parseVoice(text, items.length), model };
}
