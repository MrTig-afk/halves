// POST /api/photos/archive {upto, token} - admin only, after "Yes, delete them here": the photos of
// that finished export are deleted and their bills show "photo archived". An export that did not
// finish stamped nothing, so nothing is deleted.
import { fail } from "@/lib/http";
import { archiveExport } from "@/lib/photos";
import { currentPerson } from "@/lib/session";

const whole = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;

export async function POST(req: Request) {
  const me = await currentPerson();
  if (!me) return fail(401, "signed_out", "Sign in again.");
  if (me.role !== "admin") return fail(403, "admin_only", "Only the admin can delete photos.");
  const body = await req.json().catch(() => null);
  if (!whole(body?.upto) || !whole(body?.token)) return fail(400, "bad_request", "Reload and try again.");
  return Response.json({ deleted: await archiveExport(me.id, body.upto, body.token) });
}
