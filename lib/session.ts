// Signed session cookie -> device_session row -> person. Server-only.
// The cookie holds only "<session uuid>.<HMAC>", so a guessed or edited value is refused before
// the database is asked, and signing out deletes the row, so a copied cookie stops working.
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { query } from "./db";
import { PATH_HEADER, signInPath } from "./paths";

export const SESSION_COOKIE = "halves_session";
// A device stays signed in until Sign out; 400 days is the longest lifetime browsers accept.
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 400 * 24 * 60 * 60,
};

export type Person = { id: number; name: string; role: "admin" | "member" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET is missing or too short");
  return s;
}

export function signSession(id: string): string {
  return `${id}.${createHmac("sha256", secret()).update(id).digest("base64url")}`;
}

export function readSessionId(value: string | undefined): string | null {
  if (!value) return null;
  const id = value.slice(0, value.lastIndexOf("."));
  if (!UUID.test(id)) return null;
  const want = Buffer.from(signSession(id));
  const got = Buffer.from(value);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}

// The signed-in person for this request (Server Components and route handlers). cache() makes a
// layout and its page share one lookup per render.
export const currentPerson = cache(async (): Promise<Person | null> => {
  const id = readSessionId((await cookies()).get(SESSION_COOKIE)?.value);
  if (!id) return null;
  const rows = await query<Person>(
    "select p.id::int as id, p.name, p.role from device_session s join person p on p.id = s.person_id where s.id = $1",
    [id],
  );
  return rows[0] ?? null;
});

// This device's session id, if its cookie is genuine (the row may still be gone).
export async function currentSessionId(): Promise<string | null> {
  return readSessionId((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function startSession(personId: number): Promise<void> {
  const rows = await query("insert into device_session (person_id) values ($1) returning id::text as id", [personId]);
  (await cookies()).set(SESSION_COOKIE, signSession(rows[0].id as string), SESSION_COOKIE_OPTIONS);
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const id = readSessionId(store.get(SESSION_COOKIE)?.value);
  if (id) await query("delete from device_session where id = $1", [id]);
  store.delete(SESSION_COOKIE);
}

// The one sign-in check every signed-in screen uses. A signed-out (or stale-cookie) request goes
// to the tiles, carrying the deep link the proxy recorded, so after the PIN the person lands on
// the bill or round they opened - on a first load and on an in-app navigation alike.
export async function requirePerson(): Promise<Person> {
  const me = await currentPerson();
  if (!me) redirect(signInPath((await headers()).get(PATH_HEADER)));
  return me;
}
