// Deep links, end to end: the proxy records the path, and requirePerson() (lib/session.ts) sends a
// signed-out or stale-cookie request to the tiles with that link.
import { NextRequest } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("runs on every page and route except build files, the favicon and the service worker", () => {
    expect(config.matcher).toEqual(["/((?!_next/static/|_next/image|favicon\\.ico$|sw\\.js$).*)"]);
  });

  it("sets no path header outside bills and settled rounds, and drops one the client sent", () => {
    for (const p of ["/", "/signin", "/billing", "/settings"]) {
      const res = proxy(new NextRequest(`http://localhost:3100${p}`, { headers: { "x-halves-path": "/bill/1" } }));
      expect(res.headers.get("x-middleware-request-x-halves-path")).toBeNull();
      expect(res.headers.get("x-middleware-override-headers")).not.toContain("x-halves-path");
    }
  });

  const policy = (nonce: string, extra = "") =>
    `default-src 'self'; script-src 'self' 'nonce-${nonce}'${extra}; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`;
  const nonceOf = (res: Response) => res.headers.get("x-middleware-request-x-nonce")!;

  it("sets the nonce policy on the response and on the request Next renders from", () => {
    const res = proxy(new NextRequest("http://localhost:3100/signin"));
    const nonce = nonceOf(res);
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(res.headers.get("content-security-policy")).toBe(policy(nonce));
    expect(res.headers.get("x-middleware-request-content-security-policy")).toBe(policy(nonce));
  });

  it("gives every request a fresh nonce and ignores a client-sent one", () => {
    const a = nonceOf(proxy(new NextRequest("http://localhost:3100/")));
    const forged = proxy(new NextRequest("http://localhost:3100/", { headers: { "x-nonce": "evil", "content-security-policy": "evil" } }));
    const b = nonceOf(forged);
    expect(a).not.toBe(b);
    expect(b).not.toBe("evil");
    expect(forged.headers.get("x-middleware-request-content-security-policy")).toBe(policy(b)); // the client's policy never reaches Next
  });

  afterEach(() => vi.unstubAllEnvs()); // a failed expectation below must not leave NODE_ENV stubbed

  it("allows unsafe-eval in development only", () => {
    vi.stubEnv("NODE_ENV", "development");
    const dev = proxy(new NextRequest("http://localhost:3100/"));
    expect(dev.headers.get("content-security-policy")).toBe(policy(nonceOf(dev), " 'unsafe-eval'"));
    vi.stubEnv("NODE_ENV", "production");
    expect(proxy(new NextRequest("http://localhost:3100/")).headers.get("content-security-policy")).not.toContain("unsafe-eval");
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
