// POST /api/auth/signout - forget this device (its session row and cookie).
import { endSession } from "@/lib/session";

export async function POST() {
  await endSession();
  return Response.json({ ok: true });
}
