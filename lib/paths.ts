// Where to go after signing in. Only the screens a link can point at (a bill, a settled round)
// are kept, rebuilt from their parts: the path, plus `from` when it is a round id. Anything else -
// another site, "//evil", a script URL, another screen - gives null, so this can never become an
// open redirect. Extra parameters a messenger adds (utm_*, fragments) are dropped, not fatal.

const ID = "\\d{1,15}";
export const ID_RE = new RegExp(`^${ID}$`); // a bill or round id in a URL (lib/tab.ts idParam)
const SCREEN = new RegExp(`^/(bill|settled)/${ID}$`);

// `path` is typed unknown on purpose: a repeated ?next= arrives as an array.
export function safeNext(path: unknown): string | null {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return null;
  let url: URL;
  try {
    url = new URL(path, "http://halves.invalid");
  } catch {
    return null;
  }
  if (url.host !== "halves.invalid" || !SCREEN.test(url.pathname)) return null;
  const from = url.searchParams.get("from"); // only a bill uses it: the round it was opened from
  return from && ID_RE.test(from) && url.pathname.startsWith("/bill/") ? `${url.pathname}?from=${from}` : url.pathname;
}

export const signInPath = (path: unknown) => {
  const next = safeNext(path);
  return next ? `/signin?next=${encodeURIComponent(next)}` : "/signin";
};

// The request header the proxy sets with the path of a deep link. The layout reads it only to
// build the sign-in link, and only through safeNext(), so a client sending it gains nothing.
export const PATH_HEADER = "x-halves-path";
