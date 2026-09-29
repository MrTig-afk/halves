// POST /api/auth/claim {personId, pin} - set the PIN of an unclaimed tile and sign in.
import { claimTile } from "@/lib/auth";
import { authResponse, readTileRequest } from "@/lib/authRoute";

export async function POST(req: Request) {
  const body = await readTileRequest(req);
  if (!body) return Response.json({ error: "bad_request" }, { status: 400 });
  return authResponse(body.personId, await claimTile(body.personId, body.pin));
}
