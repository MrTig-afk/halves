// PIN sign-in and tile claiming. Server-only.
import { query } from "./db";
import { hashPin, isValidPin, verifyPin } from "./pin";

export const MAX_TRIES = 3;
export const LOCK_MINUTES = 5;
export const PHONE_TRIES = 10;
export const PHONE_MINUTES = 15;

export type AuthResult =
  | { ok: false; error: "slow_down"; until: string } // this phone has used its wrong PINs (PRD 10.4)
  | { ok: true; stamp: string } // the person's pin_stamp for the PIN just checked or set
  | { ok: false; error: "invalid_pin" | "not_found" | "unclaimed" | "claimed" }
  | { ok: false; error: "wrong_pin"; triesLeft: number }
  | { ok: false; error: "locked"; lockedUntil: string };

const iso = (v: unknown) => new Date((v as string | null) ?? Date.now()).toISOString();

// `phone` (sign-in only): this phone's key. A try is reserved against it FIRST, before anything
// else, so a request without a device cookie cannot get one without paying a try, and a paused phone
// is refused even with the right PIN. The try is given back unless a wrong PIN was checked (or the
// key is an address key, whose tries are never given back).
export async function checkPin(personId: number, pin: string, phone?: string): Promise<AuthResult> {
  if (!phone) return checkTile(personId, pin);
  const [mine] = await query<{ n: number; at: string; until: string }>(
    `insert into pin_throttle as t (client, wrong) values ($1, array[clock_timestamp()])
     on conflict (client) do update
       set wrong = array(select x from unnest(t.wrong) x where x > now() - make_interval(mins => $3)) || clock_timestamp()
       where (select count(*) from unnest(t.wrong) x where x > now() - make_interval(mins => $3)) < $2
     returning cardinality(wrong)::int as n, wrong[cardinality(wrong)]::text as at,
               ((select min(x) from unnest(wrong) x) + make_interval(mins => $3))::text as until`,
    [phone, PHONE_TRIES, PHONE_MINUTES],
  );
  if (!mine) {
    const [p] = await query<{ until: string }>(
      `select (min(x) + make_interval(mins => $2))::text as until from pin_throttle, unnest(wrong) x
       where client = $1 and x > now() - make_interval(mins => $2)`,
      [phone, PHONE_MINUTES],
    );
    return { ok: false, error: "slow_down", until: iso(p?.until) };
  }
  const checked = { wrongPin: false };
  try {
    const r = await checkTile(personId, pin, checked);
    if (checked.wrongPin && mine.n === PHONE_TRIES) return { ok: false, error: "slow_down", until: iso(mine.until) };
    return r;
  } finally {
    // Given back unless a wrong PIN was checked - also when the check failed (a database error is no guess).
    // A failed give-back only leaves the try spent; it never turns the answer into an error.
    if (!checked.wrongPin && !phone.startsWith("ip:")) {
      await query("update pin_throttle set wrong = array_remove(wrong, $2::timestamptz) where client = $1", [phone, mine.at]).catch(() => {});
    }
  }
}

async function checkTile(personId: number, pin: string, checked?: { wrongPin: boolean }): Promise<AuthResult> {
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
  const right = await verifyPin(pin, r.pin_hash);
  if (checked) checked.wrongPin = !right;
  if (right) {
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
