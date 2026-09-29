// POST /api/people {name} - the admin adds an unclaimed tile.
import { fail } from "@/lib/http";
import { addPerson, PeopleError, tileName } from "@/lib/people";
import { currentPerson } from "@/lib/session";

export async function POST(req: Request) {
  const me = await currentPerson();
  if (!me) return fail(401, "signed_out", "Sign in again.");
  if (me.role !== "admin") return fail(403, "admin_only", "Only the admin can add people.");
  let name: string;
  try {
    name = tileName((await req.json().catch(() => null))?.name);
  } catch (e) {
    if (e instanceof PeopleError) return fail(400, "bad_name", "Use 1 to 40 characters, with at least one letter.");
    throw e;
  }
  const id = await addPerson(name);
  if (id === null) return fail(409, "taken", `There is already a tile called ${name}.`);
  return Response.json({ id, name });
}
