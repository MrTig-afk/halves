// People admin: the admin adds a tile or resets someone's PIN. Nobody is ever removed.
import { query } from "./db";

export type PersonRow = { id: number; name: string; role: "admin" | "member"; claimed_at: string | null };

export const people = () =>
  query<PersonRow>("select id::int, name, role, claimed_at::text from person order by role = 'admin' desc, id");

export class PeopleError extends Error {}

// A tile name: what the sign-in screen shows. Trimmed, 1-40 characters, at least one letter, and
// no control or invisible format characters (zero-width spaces, direction overrides).
export function tileName(raw: unknown): string {
  if (typeof raw !== "string") throw new PeopleError("name");
  // NFC first: "José" typed and "José" pasted (e + combining accent) must be the same name.
  const name = raw.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!name || name.length > 40 || /[\p{Cc}\p{Cf}]/u.test(name) || !/\p{L}/u.test(name)) throw new PeopleError("name");
  return name;
}

// A new, unclaimed tile: whoever taps it first sets its PIN. null when the name is taken, in any
// letter case (a unique index on lower(name)), so "rahul" never sits beside "Rahul".
export async function addPerson(me: number, name: string): Promise<number | null> {
  const [r] = await query<{ id: number | null }>("select admin_add_person($1)::int as id", [name], me);
  return r?.id ?? null;
}

// Back to an unclaimed tile, signed out on every phone - and so with no phone left receiving its
// notifications (a subscription goes with its session) - in one statement. An admin tile is never reset this way (the admin changes their
// own PIN), or the admin tile could be claimed by whoever tapped it first.
export async function resetPin(me: number, id: number): Promise<boolean> {
  const [r] = await query<{ reset: boolean }>("select admin_reset_pin($1) as reset", [id], me);
  return r.reset;
}
