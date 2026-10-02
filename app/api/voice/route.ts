// POST /api/voice - multipart "file" (a short recording) + "items" (JSON list of the bill's item
// names, in order) + "people" (JSON ids of everyone on the bill) -> what was heard and who had which
// items. The recording, item names and first names go to Groq; Gemini (last fallback) never gets a name. Nothing is stored.
// Signed-in devices only: every call spends the shared free AI allowance.
import { GeminiError, pausedUntil } from "@/lib/gemini";
import { hearVoice } from "@/lib/groq";
import { people as everyone } from "@/lib/people";
import { MAX_NAME } from "@/lib/receipt";
import { fail } from "@/lib/http";
import { currentPerson } from "@/lib/session";
import { matchPerson, VoiceError, type VoiceReply } from "@/lib/voice";

export const maxDuration = 60;

const MAX_AUDIO_BYTES = 1024 * 1024; // ~60 s of browser Opus; the recorder stops at 30 s
const MAX_ITEMS = 200;
const BUTTONS = "Voice can't take this bill's item list - use the buttons.";

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
  if (typeof v !== "string" || v.length > MAX_ITEMS * (MAX_NAME + 10)) return null;
  try {
    const a: unknown = JSON.parse(v);
    if (!Array.isArray(a) || a.length === 0 || a.length > MAX_ITEMS) return null;
    return a.every((s) => typeof s === "string" && s.length <= MAX_NAME) ? (a as string[]) : null;
  } catch {
    return null;
  }
}

// The bill's people: 2 to 5 distinct ids, the signed-in person among them.
function billIds(v: FormDataEntryValue | null, me: number): number[] | null {
  if (typeof v !== "string" || v.length > 200) return null;
  try {
    const a: unknown = JSON.parse(v);
    if (!Array.isArray(a) || a.length < 2 || a.length > 5 || new Set(a).size !== a.length) return null;
    return a.every((n) => Number.isSafeInteger(n) && n > 0) && a.includes(me) ? (a as number[]) : null;
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
  const ids = billIds(form.get("people"), me.id);
  if (!(file instanceof Blob)) return fail(400, "bad_request", "Nothing was recorded.");
  if (!items || !ids) return fail(400, "bad_items", BUTTONS);
  if (file.size > MAX_AUDIO_BYTES) return fail(413, "too_long", "That was too long. Keep it to one sentence.");
  const audio = Buffer.from(await file.arrayBuffer());
  const mime = audioType(audio);
  if (!mime) return fail(415, "unsupported_audio", "That recording couldn't be used. Try again.");

  const started = Date.now();
  try {
    // First names go to Groq (Whisper's spelling hint and the gpt-oss prompt); the Gemini fallback never gets them. Names are matched here.
    const on = (await everyone()).filter((p) => ids.includes(p.id));
    const { reading, model } = await hearVoice(audio, mime, items, on.map((p) => p.name.split(" ")[0]));
    console.info(JSON.stringify({ event: "voice_read", ms: Date.now() - started, model, changes: reading.changes.length, dropped: reading.dropped.length }));
    const onIds = on.map((p) => p.id);
    // "me" and "everyone" (in the forms the prompt allows) are the speaker and the bill's people; a
    // pronoun for another person ("them") is that person only on a bill of two; a name not on the
    // bill is left out.
    const resolve = (w: string): (number | undefined)[] => {
      const word = w.toLowerCase().replace(/[^\p{L}\s]/gu, "").trim();
      if (["me", "i", "mine", "my"].includes(word)) return [me.id];
      if (["everyone", "everybody", "all", "split", "shared", "half"].includes(word)) return onIds;
      if (["them", "his", "hers", "theirs", "him", "her"].includes(word)) return onIds.length === 2 ? onIds.filter((id) => id !== me.id) : [];
      return [matchPerson(w, on)?.id];
    };
    const changes = reading.changes.flatMap(({ item, who }) => {
      const set = new Set(who.flatMap(resolve));
      const people = onIds.filter((id) => set.has(id));
      return people.length ? [{ item, people }] : [];
    });
    return Response.json({ transcript: reading.transcript, changes, dropped: reading.dropped } satisfies VoiceReply);
  } catch (e) {
    console.info(JSON.stringify({ event: "voice_read_failed", ms: Date.now() - started, error: (e as { code?: string }).code ?? "internal" }));
    if (e instanceof VoiceError) return fail(502, "bad_output", "That couldn't be worked out. Try again.", true);
    if (e instanceof GeminiError) {
      if (e.code === "quota") return fail(429, "ai_paused", "Voice is paused - the free AI limit is used up. Use the buttons.", !e.daily, pausedUntil(e));
      if (!e.transient) return fail(502, "unavailable", "Voice isn't working right now. Use the buttons.");
      return fail(e.code === "timeout" ? 504 : 503, e.code, "Voice is unavailable right now. Try again.", true);
    }
    return fail(500, "internal", "Something went wrong. Try again.", true);
  }
}
