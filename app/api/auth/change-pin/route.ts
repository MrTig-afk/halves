// POST /api/auth/change-pin {current, next} - change the signed-in person's PIN. The current PIN
// is checked exactly like a sign-in, so wrong guesses count towards the same lockout. The person's
// other phones are signed out: whoever knew the old PIN loses access with it.
import { checkPin } from "@/lib/auth";
import { query } from "@/lib/db";
import { fail } from "@/lib/http";
import { hashPin, isValidPin } from "@/lib/pin";
import { currentPerson, currentSessionId } from "@/lib/session";

export async function POST(req: Request) {
  const me = await currentPerson();
  if (!me) return fail(401, "signed_out", "Sign in again to change your PIN.");
  const body = await req.json().catch(() => null);
  const { current, next } = body ?? {};
  if (typeof current !== "string" || typeof next !== "string" || !isValidPin(next)) {
    return fail(400, "bad_request", "A PIN is exactly 4 digits.");
  }
  const r = await checkPin(me.id, current);
  if (!r.ok) return Response.json(r, { status: r.error === "locked" ? 423 : 400 });
  // Only while this device is still signed in: an admin reset (which deletes the sessions) landing
  // between the check and here wins, even if the tile was already claimed again.
  const [done] = await query<{ changed: boolean }>(
    `with p as (
       update person set pin_hash = $2
       where id = $1 and exists (select 1 from device_session where person_id = $1 and id::text = $3)
       returning id
     ),
     s as (delete from device_session where person_id in (select id from p) and id::text <> coalesce($3, '') returning 1)
     select exists (select 1 from p) as changed`,
    [me.id, await hashPin(next), await currentSessionId()],
  );
  if (!done.changed) return fail(409, "reset", "Your PIN was just reset by the admin. Sign in again to set a new one.");
  return Response.json({ ok: true });
}
