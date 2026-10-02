// Two jobs on every page and route: a nonce Content-Security-Policy (Next reads the nonce from the
// request's CSP header and stamps its own scripts), and the path of a deep link (a bill, a settled
// round) for the sign-in check, so a signed-out person goes to the tiles and then on to that screen
// (requirePerson in lib/session.ts). The path decides nothing itself; safeNext() re-checks it before use.
import { NextResponse, type NextRequest } from "next/server";
import { PATH_HEADER } from "@/lib/paths";

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development"; // React's dev tooling needs eval; production never
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:", // the crop preview is a blob: URL
    "frame-ancestors 'none'",
    // these three do not fall back to default-src
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const { pathname, search } = request.nextUrl;
  headers.delete(PATH_HEADER); // only this proxy may say where a deep link was going
  if (/^\/(bill|settled)(\/|$)/.test(pathname)) headers.set(PATH_HEADER, pathname + search);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

// Every page and route but build files, the favicon and the service worker script - exactly those
// names, so a made-up path like /sw.jsx still gets the policy on its 404 page.
export const config = { matcher: ["/((?!_next/static/|_next/image|favicon\\.ico$|sw\\.js$).*)"] };
