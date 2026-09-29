// POST /api/receipt - multipart field "file": a cropped receipt photo -> the lines the AI read.
// M0: no session check yet (sign-in arrives in T1.1, which adds it to every route). Until
// then the Vercel project must have Deployment Protection = Vercel Authentication on ALL
// deployments (free on every plan per vercel.com/docs/deployment-protection, 2026-09-15),
// set explicitly in T0.3 - it is not assumed to be on by default.
import { GeminiError, readReceipt } from "@/lib/gemini";
import { ImageError, MAX_UPLOAD_BYTES, normaliseImage } from "@/lib/image";
import { ReceiptError } from "@/lib/receipt";

export const maxDuration = 60;

const fail = (status: number, error: string, message: string, retryable = false) =>
  Response.json({ error, message, retryable }, { status });

export async function POST(req: Request) {
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
      if (e.code === "quota") return fail(429, "ai_paused", "Receipt reading is paused - the free AI limit is used up. You can still enter this bill by hand.");
      // Only a transient failure (5xx, timeout, network) is worth another try; a rejected
      // request or a missing key would fail the same way again.
      if (!e.transient) return fail(502, "unavailable", "Reading receipts isn't working right now.");
      return fail(e.code === "timeout" ? 504 : 503, e.code, "Reading receipts is unavailable right now. Try again.", true);
    }
    return fail(500, "internal", "Something went wrong. Try again.", true);
  }
}
