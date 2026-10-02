// POST /api/auth/pin {personId, pin} - sign this device in with a claimed tile's PIN.
import { checkPin } from "@/lib/auth";
import { authResponse, phoneKey, readTileRequest } from "@/lib/authRoute";

export async function POST(req: Request) {
  const body = await readTileRequest(req);
  if (!body) return Response.json({ error: "bad_request" }, { status: 400 });
  return authResponse(body.personId, await checkPin(body.personId, body.pin, await phoneKey(req)));
}
