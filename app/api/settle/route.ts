// POST /api/settle - JSON { partner_id, expected } -> every open bill between the two is settled,
// at the amount worked out at this moment, provided it is the amount the person confirmed
// (`expected`, signed from their side). Otherwise nothing is settled and the new balance is
// returned (409) to confirm again.
import { fail } from "@/lib/http";
import { currentPerson } from "@/lib/session";
import { settleAll } from "@/lib/tab";

export async function POST(req: Request) {
  const me = await currentPerson();
  if (!me) return fail(401, "signed_out", "Sign in again to settle up.");
  const body = await req.json().catch(() => null);
  const other = body?.partner_id;
  const expected = body?.expected;
  if (typeof other !== "number" || !Number.isInteger(other) || other === me.id) return fail(400, "bad_request", "Pick who to settle up with.");
  if (typeof expected !== "number" || !Number.isInteger(expected) || Math.abs(expected) > 2_147_483_647) {
    return fail(400, "bad_request", "That amount can't be settled. Reload and try again.");
  }

  // An unknown person simply has no open bills with me, so nothing is settled.
  const r = await settleAll(me.id, other, expected);
  console.info(JSON.stringify({ event: r.id ? "settled" : r.balance !== expected ? "settle_changed" : "nothing_to_settle", bills: r.bills }));
  if (!r.id && r.balance !== expected) return Response.json({ error: "changed", balance: r.balance }, { status: 409 });
  return Response.json(r);
}
