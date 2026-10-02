// POST /api/photos/export (form fields upto, t) - admin only: the kept photos of the admin's bills up to
// that id as one zip, streamed (a month of photos is larger than a function's 4.5 MB non-streamed
// response limit). The token names this export; see lib/photos.ts. A POST only (PRD 10.4): a link or a
// page load cannot start it, and a cross-site POST arrives without the SameSite=Lax session (401).
import { fail } from "@/lib/http";
import { localDate } from "@/lib/names";
import { exportPhotos, listPhotos, stampExport } from "@/lib/photos";
import { currentPerson } from "@/lib/session";
import { idParam } from "@/lib/tab";
import { zip } from "@/lib/zip";

export const maxDuration = 300;

export async function POST(req: Request) {
  const me = await currentPerson();
  if (!me) return fail(401, "signed_out", "Sign in again.");
  if (me.role !== "admin") return fail(403, "admin_only", "Only the admin can export photos.");
  const form = await req.formData().catch(() => null);
  const upto = idParam(String(form?.get("upto") ?? ""));
  const token = idParam(String(form?.get("t") ?? ""));
  if (upto === null || !token) return fail(400, "bad_request", "Reload and try again.");

  const list = await listPhotos(me.id, upto);
  const month = localDate(new Date().toISOString()).slice(0, 7);
  const sent: number[] = [];
  const chunks = zip(exportPhotos(me.id, list, sent));
  // Hand-built (ReadableStream.from is not in the installed TS types). The stamp waits until the
  // last chunk, the zip's directory, has been read; a cancelled or failed stream never gets there.
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await chunks.next();
      if (!done) return controller.enqueue(value);
      await stampExport(me.id, sent, token);
      controller.close();
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="halves-photos-${month}.zip"`,
      "cache-control": "private, no-store",
    },
  });
}
