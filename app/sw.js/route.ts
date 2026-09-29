// The service worker, served with the deploy version inside its bytes so the
// browser's update check sees a new worker on every deploy (a query-string
// version alone never changes the registered script).
// Caches the app shell only, never user data (PRD 6.10).
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "dev";

const script = `
const CACHE = "halves-shell-${APP_VERSION}";
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  // Cache the offline page AND its stylesheets: the first visit is not
  // controlled, so nothing else would have cached the CSS yet.
  event.waitUntil(
    caches.open(CACHE).then(async (c) => {
      const res = await fetch(OFFLINE_URL);
      const html = await res.clone().text();
      await c.put(OFFLINE_URL, res);
      // No regex here: this script lives inside a template literal, which eats backslashes.
      const css = html.split('"').filter((v) => v.startsWith("/_next/static/") && v.endsWith(".css"));
      await c.addAll(css);
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return; // never cache data

  if (req.mode === "navigate") {
    // Pages always come from the network; offline shows the offline page, never a stale page.
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    // Content-hashed / immutable assets: cache first.
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone(); // clone before the body is handed to the page
            event.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
          }
          return res;
        });
      }),
    );
  }
});
`;

export function GET() {
  return new Response(script, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
