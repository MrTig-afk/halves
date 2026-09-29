// POST /api/auth/change-pin {current, next} - change the signed-in person's PIN. The current PIN
// is checked exactly like a sign-in, so wrong guesses count towards the same lockout. The person's
// other phones are signed out: whoever knew the old PIN loses access with it - including a sign-in
// with the old PIN that lands a moment later, since it carries the old pin_stamp.
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
  // Only while the PIN is still the one just checked (its pin_stamp): an admin reset, or a Change
  // PIN from another phone, landing between the check and here wins - even at the same instant,
  // since the stamp is re-read from the row this statement waits for.
  const [done] = await query<{ changed: boolean }>(
    `with p as (
       update person set pin_hash = $2, pin_stamp = gen_random_uuid()
       where id = $1 and pin_stamp = $4::uuid and exists (select 1 from device_session where id = $3::uuid)
       returning id, pin_stamp
     ),
     s as (delete from device_session d using p where d.person_id = p.id and d.id is distinct from $3::uuid returning 1),
     k as (update device_session d set pin_stamp = p.pin_stamp from p where d.id = $3::uuid returning 1)
     select exists (select 1 from p) as changed`,
    [me.id, await hashPin(next), await currentSessionId(), r.stamp],
  );
  if (!done.changed) return fail(409, "reset", "Your PIN was just reset by the admin. Sign in again to set a new one.");
  return Response.json({ ok: true });
}
