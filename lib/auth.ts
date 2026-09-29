// PIN sign-in and tile claiming. Server-only.
import { query } from "./db";
import { hashPin, isValidPin, verifyPin } from "./pin";

export const MAX_TRIES = 3;
export const LOCK_MINUTES = 5;

export type AuthResult =
  | { ok: true; stamp: string } // the person's pin_stamp for the PIN just checked or set
  | { ok: false; error: "invalid_pin" | "not_found" | "unclaimed" | "claimed" }
  | { ok: false; error: "wrong_pin"; triesLeft: number }
  | { ok: false; error: "locked"; lockedUntil: string };

const iso = (v: unknown) => new Date((v as string | null) ?? Date.now()).toISOString();

export async function checkPin(personId: number, pin: string): Promise<AuthResult> {
  if (!isValidPin(pin)) return { ok: false, error: "invalid_pin" };
  // Reserve one try BEFORE verifying, in one atomic statement, and write the lock in that same
  // statement when the last try is reserved. So a burst of parallel guesses gets at most
  // MAX_TRIES checks per window, and "tries used up but not locked" can never exist.
  // An expired lock starts a fresh count. (SET expressions all see the old row.)
  const reserved = await query<{ pin_hash: string; pin_stamp: string; tries: number; locked_until: string | null }>(
    `update person set
       failed_pin_count = case when locked_until <= now() then 1 else failed_pin_count + 1 end,
       locked_until = case
         when (case when locked_until <= now() then 1 else failed_pin_count + 1 end) >= $2
           then now() + make_interval(mins => $3)
         when locked_until <= now() then null
         else locked_until end
     where id = $1 and pin_hash is not null
       and ((locked_until is null and failed_pin_count < $2) or locked_until <= now())
     returning pin_hash, pin_stamp::text, failed_pin_count as tries, locked_until`,
    [personId, MAX_TRIES, LOCK_MINUTES],
  );
  if (!reserved.length) {
    const rows = await query("select pin_hash, locked_until from person where id = $1", [personId]);
    if (!rows.length) return { ok: false, error: "not_found" };
    if (rows[0].pin_hash === null) return { ok: false, error: "unclaimed" };
    return { ok: false, error: "locked", lockedUntil: iso(rows[0].locked_until) };
  }
  const r = reserved[0];
  if (await verifyPin(pin, r.pin_hash)) {
    // Only for the PIN just checked: a slow check of an old PIN must not lift the new one's lock.
    await query("update person set failed_pin_count = 0, locked_until = null where id = $1 and pin_stamp = $2::uuid", [personId, r.pin_stamp]);
    return { ok: true, stamp: r.pin_stamp }; // read with the hash that was verified
  }
  if (r.locked_until) return { ok: false, error: "locked", lockedUntil: iso(r.locked_until) };
  return { ok: false, error: "wrong_pin", triesLeft: MAX_TRIES - r.tries };
}

// The first person to set a PIN on an unclaimed tile owns it (accepted risk, owner 2026-09-29).
export async function claimTile(personId: number, pin: string): Promise<AuthResult> {
  if (!isValidPin(pin)) return { ok: false, error: "invalid_pin" };
  const rows = await query<{ pin_stamp: string }>(
    `update person set pin_hash = $2, pin_stamp = gen_random_uuid(), claimed_at = now(), failed_pin_count = 0, locked_until = null
     where id = $1 and pin_hash is null returning pin_stamp::text`,
    [personId, await hashPin(pin)],
  );
  if (rows.length) return { ok: true, stamp: rows[0].pin_stamp };
  const exists = await query("select 1 from person where id = $1", [personId]);
  return { ok: false, error: exists.length ? "claimed" : "not_found" };
}
