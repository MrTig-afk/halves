// Client calls. The ONLY automatic retry is a request that never reached the server (a
// network error): the server already retries Gemini itself, so retrying anything else would
// multiply free-tier calls. Every other failure is shown, and `retryable` tells the UI to
// offer Try again (PRD 7.1).
import type { ReceiptReading } from "./receipt";

export type ApiFailure = { error: string; message: string; retryable: boolean };
export type ReadResult = { ok: true; reading: ReceiptReading } | ({ ok: false } & ApiFailure);

const SLOW: ApiFailure = { error: "timeout", message: "Reading took too long. Try again.", retryable: true };
const OFFLINE: ApiFailure = {
  error: "network",
  message: "Couldn't reach Halves. Check your connection and try again.",
  retryable: true,
};

export async function postReceipt(jpeg: Blob, attempts = 2): Promise<ReadResult> {
  let last: ApiFailure = OFFLINE;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 800));
    const form = new FormData();
    form.append("file", jpeg, "receipt.jpg");
    let res: Response;
    try {
      // Longer than the route's 60 s maxDuration, so the server's own answer arrives first.
      res = await fetch("/api/receipt", { method: "POST", body: form, signal: AbortSignal.timeout(70_000) });
    } catch (e) {
      // A timeout means the server may still be working on it: show it, never send it again.
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return { ok: false, ...SLOW };
      last = OFFLINE;
      continue;
    }
    const body = await res.json().catch(() => null);
    if (res.ok && body) return { ok: true, reading: body as ReceiptReading };
    last = body?.error
      ? (body as ApiFailure)
      : { error: "internal", message: "Something went wrong. Try again.", retryable: res.status >= 500 };
    break;
  }
  return { ok: false, ...last };
}
