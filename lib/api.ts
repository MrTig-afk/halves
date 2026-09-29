// Client calls. The ONLY automatic retry is a request that never reached the server (a
// network error): the server already retries Gemini itself, so retrying anything else would
// multiply free-tier calls. Every other failure is shown, and `retryable` tells the UI to
// offer Try again.
import type { ReceiptReading } from "./receipt";
import type { VoiceReply } from "./voice";

export type ApiFailure = { error: string; message: string; retryable: boolean; until?: string };
export type ReadResult = { ok: true; reading: ReceiptReading } | ({ ok: false } & ApiFailure);
export type VoiceResult = ({ ok: true } & VoiceReply) | ({ ok: false } & ApiFailure);

// "paused until <time>" (userflow E4), in the device's local time.
export const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const SLOW: ApiFailure = { error: "timeout", message: "That took too long. Try again.", retryable: true };
const OFFLINE: ApiFailure = {
  error: "network",
  message: "Couldn't reach Halves. Check your connection and try again.",
  retryable: true,
};

async function send(url: string, form: () => FormData, attempts = 2): Promise<{ ok: true; body: unknown } | ({ ok: false } & ApiFailure)> {
  let last: ApiFailure = OFFLINE;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 800));
    let res: Response;
    try {
      // Longer than the routes' 60 s maxDuration, so the server's own answer arrives first.
      res = await fetch(url, { method: "POST", body: form(), signal: AbortSignal.timeout(70_000) });
    } catch (e) {
      // A timeout means the server may still be working on it: show it, never send it again.
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return { ok: false, ...SLOW };
      last = OFFLINE;
      continue;
    }
    const body = await res.json().catch(() => null);
    if (res.ok && body) return { ok: true, body };
    last = body?.error
      ? (body as ApiFailure)
      : { error: "internal", message: "Something went wrong. Try again.", retryable: res.status >= 500 };
    break;
  }
  return { ok: false, ...last };
}

export async function postReceipt(jpeg: Blob, attempts = 2): Promise<ReadResult> {
  const r = await send(
    "/api/receipt",
    () => {
      const form = new FormData();
      form.append("file", jpeg, "receipt.jpg");
      return form;
    },
    attempts,
  );
  return r.ok ? { ok: true, reading: r.body as ReceiptReading } : r;
}

export async function postVoice(audio: Blob, items: string[]): Promise<VoiceResult> {
  const r = await send("/api/voice", () => {
    const form = new FormData();
    form.append("file", audio, "voice");
    form.append("items", JSON.stringify(items));
    return form;
  });
  return r.ok ? { ok: true, ...(r.body as VoiceReply) } : r;
}
