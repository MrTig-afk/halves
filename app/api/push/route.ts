// This phone's notifications (Settings switch, first-open screen). A subscription is saved against
// the signed-in person AND this device's session, so it ends with the session.
//   GET    ?endpoint=  -> { on }: is this phone's subscription saved for this session?
//   POST   { endpoint, keys: { p256dh, auth } } -> saved (one per session)
//   DELETE { endpoint } -> removed
import { fail } from "@/lib/http";
import { query } from "@/lib/db";
import { pushEndpoint } from "@/lib/push";
import { currentPerson, currentSessionId } from "@/lib/session";

const KEY = /^[A-Za-z0-9_-]{16,200}={0,2}$/; // base64url, as PushSubscription.toJSON() gives it
const key = (v: unknown) => typeof v === "string" && KEY.test(v);

async function who() {
  const [me, session] = await Promise.all([currentPerson(), currentSessionId()]);
  return me && session ? { me, session } : null;
}

export async function GET(req: Request) {
  const w = await who();
  if (!w) return fail(401, "signed_out", "Sign in again.");
  const endpoint = pushEndpoint(new URL(req.url).searchParams.get("endpoint"));
  if (!endpoint) return Response.json({ on: false });
  const [r] = await query<{ yes: boolean }>(
    "select exists (select 1 from push_subscription where endpoint = $1 and session_id = $2) as yes",
    [endpoint, w.session],
  );
  return Response.json({ on: r.yes });
}

export async function POST(req: Request) {
  const w = await who();
  if (!w) return fail(401, "signed_out", "Sign in again.");
  const body = await req.json().catch(() => null);
  const endpoint = pushEndpoint(body?.endpoint);
  const { p256dh, auth } = body?.keys ?? {};
  if (!endpoint || !key(p256dh) || !key(auth)) return fail(400, "bad_request", "This browser's notification details weren't accepted.");
  await query(
    `with old as (delete from push_subscription where session_id = $2 and endpoint <> $3)
     insert into push_subscription (person_id, session_id, endpoint, p256dh, auth) values ($1, $2, $3, $4, $5)
     on conflict (endpoint) do update
       set person_id = excluded.person_id, session_id = excluded.session_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    [w.me.id, w.session, endpoint, p256dh, auth],
  );
  return Response.json({ on: true });
}

export async function DELETE(req: Request) {
  const w = await who();
  if (!w) return fail(401, "signed_out", "Sign in again.");
  const endpoint = pushEndpoint((await req.json().catch(() => null))?.endpoint);
  if (endpoint) await query("delete from push_subscription where endpoint = $1 and person_id = $2", [endpoint, w.me.id]);
  return Response.json({ on: false });
}
