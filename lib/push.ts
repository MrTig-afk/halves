// Web Push (PRD 6.7): "<Name> added a bill" and "<Name> settled up - $X" to the other person's
// phones, and nothing else - no items, no per-bill amounts (10.2). Sent after the response, so a
// slow push service never holds up a save. A subscription the push service no longer knows
// (404/410) or will not accept our key (400/403) is deleted.
import { after } from "next/server";
import webpush from "web-push";
import { query } from "./db";

export type Note = { title: string; url: string };

// Public by design: the browser needs it to subscribe.
export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY ?? "";

// The browser push services a subscription may point at. The server POSTs to the endpoint, so
// anything else (an internal address) is refused when it is saved.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/];

export function pushEndpoint(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 1000) return null;
  const url = URL.parse(v);
  const ok = url?.protocol === "https:" && !url.username && !url.password && PUSH_HOSTS.some((h) => h.test(url.hostname));
  return ok ? url.href : null;
}

// Only phones whose session still signs someone in (the pin_stamp rule in lib/session.ts).
const LIVE = "join device_session s on s.id = ps.session_id join person p on p.id = s.person_id and p.pin_stamp = s.pin_stamp";

const configured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.ADMIN_EMAIL);

// Refused for good: gone (404/410), or not usable with our key (400/403, e.g. after a key change).
const DEAD = new Set([400, 403, 404, 410]);

export async function notify(personId: number, note: Note): Promise<void> {
  if (!configured()) return console.error(JSON.stringify({ event: "push_unconfigured" }));
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, ADMIN_EMAIL: email } = process.env as Record<string, string>;
  const subs = await query<{ id: number; endpoint: string; p256dh: string; auth: string }>(
    `select ps.id::int, ps.endpoint, ps.p256dh, ps.auth from push_subscription ps ${LIVE} where ps.person_id = $1`,
    [personId],
  );
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(note), {
          vapidDetails: { subject: `mailto:${email}`, publicKey, privateKey },
          TTL: 24 * 60 * 60,
          timeout: 10_000, // a hanging push service must not hold the function open
        });
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status && DEAD.has(status)) await query("delete from push_subscription where id = $1", [s.id]);
        else console.error(JSON.stringify({ event: "push_failed", status: status ?? null }));
      }
    }),
  );
}

// From a route: sent once the response has gone.
export const notifyLater = (personId: number, note: Note) =>
  after(() => notify(personId, note).catch((e) => console.error(JSON.stringify({ event: "push_failed", error: String(e) }))));

// Whether "<Partner> has been notified." is true: push is set up and they have a phone for it. A
// subscription found dead while sending is only known afterwards. Never fails the caller: the
// bill is already saved.
export async function hasPush(personId: number): Promise<boolean> {
  if (!configured()) return false;
  try {
    const [r] = await query<{ yes: boolean }>(`select exists (select 1 from push_subscription ps ${LIVE} where ps.person_id = $1) as yes`, [personId]);
    return r.yes;
  } catch {
    return false;
  }
}
