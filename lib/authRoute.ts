// Shared request parsing and response mapping for the two sign-in routes.
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { AuthResult } from "./auth";
import { mac, readSessionId, SESSION_COOKIE_OPTIONS, signSession, startSession } from "./session";

export const DEVICE_COOKIE = "halves_device";
const DEVICE = "device:";

export async function readTileRequest(req: Request): Promise<{ personId: number; pin: string } | null> {
  const body = (await req.json().catch(() => null)) as { personId?: unknown; pin?: unknown } | null;
  if (!body || !Number.isSafeInteger(body.personId) || (body.personId as number) < 1 || typeof body.pin !== "string") return null;
  return { personId: body.personId as number, pin: body.pin };
}

const deviceId = async () => readSessionId((await cookies()).get(DEVICE_COOKIE)?.value, DEVICE);

// Which phone is this? A genuine signed device cookie, else the network address (keyed hash, never
// stored raw). On Vercel the address headers cannot be set by the client; x-vercel-forwarded-for is
// preferred. No header at all (local dev) is ONE shared bucket, never "no limit".
export async function phoneKey(req: Request): Promise<string> {
  const id = await deviceId();
  if (id) return `d:${id}`;
  const addr = (req.headers.get("x-vercel-forwarded-for") ?? req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  return `ip:${mac(network(addr) || "local")}`;
}

// An IPv6 connection owns a whole /64 and can pick a new address in it per request, so it counts
// by that prefix; IPv4 (also written ::ffff:a.b.c.d) counts by the address.
export function network(addr: string): string {
  if (!addr.includes(":") || addr.includes(".")) return addr.slice(addr.lastIndexOf(":") + 1);
  const [head, tail = ""] = addr.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const full = [...left, ...Array(Math.max(8 - left.length - right.length, 0)).fill("0"), ...right];
  return full.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

const STATUS: Record<string, number> = { invalid_pin: 400, not_found: 404, unclaimed: 409, claimed: 409, wrong_pin: 401, locked: 423, slow_down: 429 };

export async function authResponse(personId: number, r: AuthResult): Promise<Response> {
  if (!r.ok) return Response.json(r, { status: STATUS[r.error] });
  // The PIN changed between the check and here (a reset, a new claim, Change PIN): no session.
  if (!(await startSession(personId, r.stamp))) return Response.json({ ok: false, error: "changed" }, { status: 409 });
  // A device id only with a successful sign-in (PIN or claim): wrong guesses never earn a fresh
  // allowance of tries, so dropping the cookie cannot multiply the limit.
  if (!(await deviceId())) (await cookies()).set(DEVICE_COOKIE, signSession(randomUUID(), DEVICE), SESSION_COOKIE_OPTIONS);
  return Response.json({ ok: true });
}
