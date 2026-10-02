// POST /api/people/<id>/reset - the admin turns someone's tile back into an unclaimed one and signs
// them out everywhere.
import { fail } from "@/lib/http";
import { resetPin } from "@/lib/people";
import { currentPerson } from "@/lib/session";
import { idParam } from "@/lib/tab";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await currentPerson();
  if (!me) return fail(401, "signed_out", "Sign in again.");
  if (me.role !== "admin") return fail(403, "admin_only", "Only the admin can reset a PIN.");
  const id = idParam((await ctx.params).id);
  if (id === null || !(await resetPin(me.id, id))) return fail(404, "not_found", "That tile can't be reset.");
  return Response.json({ ok: true });
}
