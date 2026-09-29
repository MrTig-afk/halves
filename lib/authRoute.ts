// Shared request parsing and response mapping for the two sign-in routes.
import type { AuthResult } from "./auth";
import { startSession } from "./session";

export async function readTileRequest(req: Request): Promise<{ personId: number; pin: string } | null> {
  const body = (await req.json().catch(() => null)) as { personId?: unknown; pin?: unknown } | null;
  if (!body || !Number.isSafeInteger(body.personId) || (body.personId as number) < 1 || typeof body.pin !== "string") return null;
  return { personId: body.personId as number, pin: body.pin };
}

const STATUS: Record<string, number> = { invalid_pin: 400, not_found: 404, unclaimed: 409, claimed: 409, wrong_pin: 401, locked: 423 };

export async function authResponse(personId: number, r: AuthResult): Promise<Response> {
  if (!r.ok) return Response.json(r, { status: STATUS[r.error] });
  // The PIN changed between the check and here (a reset, a new claim, Change PIN): no session.
  if (!(await startSession(personId, r.stamp))) return Response.json({ ok: false, error: "changed" }, { status: 409 });
  return Response.json({ ok: true });
}
