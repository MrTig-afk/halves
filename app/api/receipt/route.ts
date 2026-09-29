// POST /api/receipt - multipart field "file": a cropped receipt photo -> the lines the AI read.
// Signed-in devices only: every read spends the shared free AI allowance.
import { GeminiError, pausedUntil, readReceipt } from "@/lib/gemini";
import { ImageError, MAX_UPLOAD_BYTES, normaliseImage } from "@/lib/image";
import { ReceiptError } from "@/lib/receipt";
import { fail } from "@/lib/http";
import { currentPerson } from "@/lib/session";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!(await currentPerson())) return fail(401, "signed_out", "Sign in again to read receipts.");
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) return fail(413, "image_too_large", "That photo is too big. Crop it or use a smaller one.");

  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get("file");
  } catch {
    return fail(400, "bad_request", "No photo was sent.");
  }
  if (!(file instanceof Blob)) return fail(400, "bad_request", "No photo was sent.");

  const started = Date.now();
  try {
    const jpeg = await normaliseImage(Buffer.from(await file.arrayBuffer()));
    const { reading, model } = await readReceipt(jpeg);
    // Read time goes to the server log only - never to the UI (owner 2026-09-29).
    console.info(JSON.stringify({ event: "receipt_read", ms: Date.now() - started, model, lines: reading.lines.length }));
    return Response.json(reading);
  } catch (e) {
    console.info(JSON.stringify({ event: "receipt_read_failed", ms: Date.now() - started, error: (e as { code?: string }).code ?? "internal" }));
    if (e instanceof ImageError) return fail(e.code === "image_too_large" ? 413 : e.code === "unsupported_image" ? 415 : 422, e.code, e.message);
    if (e instanceof ReceiptError) {
      return e.code === "no_items"
        ? fail(422, "no_items", "Couldn't find items in this photo.")
        : fail(502, "bad_output", "The receipt couldn't be read cleanly. Try again.", true);
    }
    if (e instanceof GeminiError) {
      if (e.code === "quota") {
        // The daily limit lasts until midnight Pacific; a per-minute limit clears within the minute, so it
        // offers Try again.
        return e.daily
          ? fail(429, "ai_paused", "The free AI limit for today is used up. You can still enter this bill by hand, and your photo is kept.", false, pausedUntil(e))
          : fail(429, "ai_paused", "The free AI limit is busy for a moment. Try again shortly, or enter this bill by hand.", true, pausedUntil(e));
      }
      // Only a transient failure (5xx, timeout, network) is worth another try; a rejected
      // request or a missing key would fail the same way again.
      if (!e.transient) return fail(502, "unavailable", "Reading receipts isn't working right now.");
      return fail(e.code === "timeout" ? 504 : 503, e.code, "Reading receipts is unavailable right now. Try again.", true);
    }
    return fail(500, "internal", "Something went wrong. Try again.", true);
  }
}
