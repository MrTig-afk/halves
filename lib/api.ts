// Client calls. The ONLY automatic retry is a request that never reached the server (a
// network error): the server already retries Gemini itself, so retrying anything else would
// multiply free-tier calls. Every other failure is shown, and `retryable` tells the UI to
// offer Try again.
import type { BillBody, Saved } from "./bill";
import type { ReceiptReading } from "./receipt";
import type { VoiceReply } from "./voice";

export type ApiFailure = { error: string; message: string; retryable: boolean; until?: string };
export type ReadResult = { ok: true; reading: ReceiptReading } | ({ ok: false } & ApiFailure);
export type VoiceResult = ({ ok: true } & VoiceReply) | ({ ok: false } & ApiFailure);
export type SaveResult = ({ ok: true } & Saved) | ({ ok: false } & ApiFailure);

// "paused until <time>", in the device's local time.
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

export async function postVoice(audio: Blob, items: string[], people: number[]): Promise<VoiceResult> {
  const r = await send("/api/voice", () => {
    const form = new FormData();
    form.append("file", audio, "voice");
    form.append("items", JSON.stringify(items));
    form.append("people", JSON.stringify(people));
    return form;
  });
  return r.ok ? { ok: true, ...(r.body as VoiceReply) } : r;
}

// Sending the same bill twice is safe: the scan id makes the server save it once.
export async function postBill(bill: BillBody, photo: Blob | null): Promise<SaveResult> {
  const r = await send("/api/bill", () => {
    const form = new FormData();
    form.append("bill", JSON.stringify(bill));
    if (photo) form.append("photo", photo, "receipt.jpg");
    return form;
  });
  return r.ok ? { ok: true, ...(r.body as Saved) } : r;
}

export const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
// crypto.randomUUID only exists on https and localhost; a phone testing over the LAN is neither.
export const uuid = () =>
  crypto.randomUUID?.() ??
  "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16));

// What a refused or failed save shows, for Review and the no-receipt form alike: the approved Retry
// message when it is worth sending again, else the server's own. The server's general "Check the
// lines" has nothing to point at on a screen with no lines.
export function saveFailure(r: ApiFailure, lines = true): { text: string; retry: boolean } {
  if (r.retryable) return { text: "Couldn't save. Check your connection and try again. Nothing you entered is lost.", retry: true };
  return { text: !lines && r.error === "bad_bill" && r.message.includes("Check the lines") ? "Something went wrong. Try again." : r.message, retry: false };
}
