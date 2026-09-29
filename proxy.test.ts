// Deep links, end to end: the proxy records the path, and requirePerson() (lib/session.ts) sends a
// signed-out or stale-cookie request to the tiles with that link.
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "./proxy";

const { req, query, redirect } = vi.hoisted(() => ({
  req: { cookie: undefined as string | undefined, path: null as string | null },
  query: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (req.cookie ? { value: req.cookie } : undefined) }),
  headers: async () => new Headers(req.path ? { "x-halves-path": req.path } : {}),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/db", () => ({ query }));
vi.mock("./lib/db", () => ({ query }));
const { requirePerson, signSession } = await import("./lib/session");

describe("proxy", () => {
  it("passes the requested path on to the sign-in check and redirects nothing itself", () => {
    const res = proxy(new NextRequest("http://localhost:3100/bill/5?from=2"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-request-x-halves-path")).toBe("/bill/5?from=2");
  });

  it("overwrites a path header the client sent", () => {
    const res = proxy(new NextRequest("http://localhost:3100/settled/9", { headers: { "x-halves-path": "//evil.example" } }));
    expect(res.headers.get("x-middleware-request-x-halves-path")).toBe("/settled/9");
  });

  it("runs on bills and settled rounds only", () => {
    expect(config.matcher).toEqual(["/bill/:path*", "/settled/:path*"]);
  });
});

describe("requirePerson", () => {
  beforeAll(() => {
    process.env.SESSION_SECRET = "test-secret-that-is-long-enough-000000";
  });
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(req, { cookie: undefined, path: null });
  });
  const target = async () => {
    try {
      await requirePerson();
      return null;
    } catch (e) {
      return (e as { to?: string }).to;
    }
  };
  const valid = () => signSession("3f1c2b8e-5d7a-4e9b-8c1f-0a2b3c4d5e6f");

  it("returns the signed-in person", async () => {
    req.cookie = valid();
    query.mockResolvedValueOnce([{ id: 1, name: "K", role: "admin" }]);
    expect(await requirePerson()).toEqual({ id: 1, name: "K", role: "admin" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sends a stale cookie (session row gone) to the tiles with the deep link", async () => {
    req.cookie = valid();
    req.path = "/bill/5?from=2";
    query.mockResolvedValueOnce([]);
    expect(await target()).toBe("/signin?next=%2Fbill%2F5%3Ffrom%3D2");
  });

  it("sends a signed-out request with the link, and drops a link it would not return to", async () => {
    req.path = "/settled/3";
    expect(await target()).toBe("/signin?next=%2Fsettled%2F3");
    req.path = "//evil.example";
    expect(await target()).toBe("/signin");
    req.path = null;
    expect(await target()).toBe("/signin");
    expect(query).not.toHaveBeenCalled(); // no cookie: the database is never asked
  });
});
