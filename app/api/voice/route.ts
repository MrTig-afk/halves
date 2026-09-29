// POST /api/voice - multipart "file" (a short recording) + "items" (JSON list of the bill's item
// names, in order) -> what was heard and which item shares change. Nothing is stored.
// Signed-in devices only: every call spends the shared free AI allowance.
import { query } from "@/lib/db";
import { GeminiError, pausedUntil, readVoice } from "@/lib/gemini";
import { currentPerson } from "@/lib/session";
import { matchPerson, VoiceError, type VoiceReply } from "@/lib/voice";

export const maxDuration = 60;

const MAX_AUDIO_BYTES = 1024 * 1024; // ~60 s of browser Opus; the recorder stops at 30 s
const MAX_ITEMS = 200;

const fail = (status: number, error: string, message: string, retryable = false, until?: string) =>
  Response.json({ error, message, retryable, ...(until && { until }) }, { status });

// The recording's type comes from its bytes, never from what the browser claims.
function audioType(b: Buffer): string | null {
  if (b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "audio/webm";
  if (b.subarray(0, 4).toString("latin1") === "OggS") return "audio/ogg";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WAVE") return "audio/wav";
  if (b.subarray(4, 8).toString("latin1") === "ftyp") return "audio/mp4";
  if (b.subarray(0, 3).toString("latin1") === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  return null;
}

function itemNames(v: FormDataEntryValue | null): string[] | null {
  if (typeof v !== "string" || v.length > MAX_ITEMS * 100) return null;
  try {
    const a: unknown = JSON.parse(v);
    if (!Array.isArray(a) || a.length === 0 || a.length > MAX_ITEMS) return null;
    return a.every((s) => typeof s === "string" && s.length <= 80) ? (a as string[]) : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const me = await currentPerson();
  if (!me) return fail(401, "signed_out", "Sign in again to use voice.");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_AUDIO_BYTES + 64 * 1024) return fail(413, "too_long", "That was too long. Keep it to one sentence.");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "bad_request", "Nothing was recorded.");
  }
  const file = form.get("file");
  const items = itemNames(form.get("items"));
  if (!(file instanceof Blob)) return fail(400, "bad_request", "Nothing was recorded.");
  if (!items) return fail(400, "bad_items", "Voice can't take this bill's item list - use the sliders.");
  if (file.size > MAX_AUDIO_BYTES) return fail(413, "too_long", "That was too long. Keep it to one sentence.");
  const audio = Buffer.from(await file.arrayBuffer());
  const mime = audioType(audio);
  if (!mime) return fail(415, "unsupported_audio", "That recording couldn't be used. Try again.");

  const started = Date.now();
  try {
    const { reading, model } = await readVoice(audio, mime, items);
    console.info(JSON.stringify({ event: "voice_read", ms: Date.now() - started, model, changes: reading.changes.length, dropped: reading.dropped.length }));
    const { partner_name, ...rest } = reading;
    const partners = partner_name
      ? await query<{ id: number; name: string }>("select id::int as id, name from person where id <> $1 order by id", [me.id])
      : [];
    return Response.json({ ...rest, partner: matchPerson(partner_name, partners)?.id ?? null } satisfies VoiceReply);
  } catch (e) {
    console.info(JSON.stringify({ event: "voice_read_failed", ms: Date.now() - started, error: (e as { code?: string }).code ?? "internal" }));
    if (e instanceof VoiceError) return fail(502, "bad_output", "That couldn't be worked out. Try again.", true);
    if (e instanceof GeminiError) {
      if (e.code === "quota") return fail(429, "ai_paused", "Voice is paused - the free AI limit is used up. Use the sliders.", !e.daily, pausedUntil(e));
      if (!e.transient) return fail(502, "unavailable", "Voice isn't working right now. Use the sliders.");
      return fail(e.code === "timeout" ? 504 : 503, e.code, "Voice is unavailable right now. Try again.", true);
    }
    return fail(500, "internal", "Something went wrong. Try again.", true);
  }
}
