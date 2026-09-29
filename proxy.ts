// Records the path of a deep link (a bill, a settled round) for the sign-in check, so a
// signed-out person goes to the tiles and then on to that screen (lib/guard.ts). It decides
// nothing itself; the value is re-checked by safeNext() before use.
import { NextResponse, type NextRequest } from "next/server";
import { PATH_HEADER } from "@/lib/paths";

export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(PATH_HEADER, request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/bill/:path*", "/settled/:path*"] };
