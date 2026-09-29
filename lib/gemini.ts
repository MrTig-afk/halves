// Gemini over plain fetch (no SDK). Free tier only (PRD 10.1): a 429 is the cost cap and is
// never retried. Primary model chosen in M0 by timing real reads (3.5 s vs 6.0 s on the sample).
import { parseReceipt, RECEIPT_PROMPT, RECEIPT_SCHEMA, type ReceiptReading } from "./receipt";

export const PRIMARY_MODEL = "gemini-3.5-flash-lite";
export const FALLBACK_MODEL = "gemini-2.5-flash";
const TIMEOUT_MS = 15_000;

export class GeminiError extends Error {
  constructor(
    readonly code: "quota" | "unavailable" | "timeout",
    message: string,
    readonly transient = false, // worth asking the same model again (5xx, timeout, network)
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
    if (res.status === 429) throw new GeminiError("quota", "free AI limit reached");
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

// Primary twice only for transient failures (5xx, timeout, network), then the fallback once;
// a 4xx other than 429 skips straight to the fallback. Quota stops everything at once.
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
      if (!(e instanceof GeminiError) || e.code === "quota") throw e;
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
