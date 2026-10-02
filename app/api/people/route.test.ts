import { beforeEach, describe, expect, it, vi } from "vitest";

const { currentPerson, query } = vi.hoisted(() => ({ currentPerson: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/session", () => ({ currentPerson }));
vi.mock("@/lib/db", () => ({ query }));
const { POST: add } = await import("./route");
const { POST: reset } = await import("./[id]/reset/route");

const post = (body: unknown) => add(new Request("http://x/api/people", { method: "POST", body: JSON.stringify(body) }));
const resetId = (id: string) => reset(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id }) });
const admin = { id: 1, name: "Kaushik", role: "admin" };
const member = { id: 4, name: "Soham", role: "member" };

beforeEach(() => {
  vi.clearAllMocks();
  currentPerson.mockResolvedValue(admin);
});

describe("POST /api/people", () => {
  it("is for the admin only", async () => {
    currentPerson.mockResolvedValueOnce(member);
    expect((await post({ name: "Rahul" })).status).toBe(403);
    currentPerson.mockResolvedValueOnce(null);
    expect((await post({ name: "Rahul" })).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it("refuses an empty, too long or non-text name", async () => {
    for (const name of ["", "   ", "x".repeat(41), 7, "a\u0000b", "\u200b", "Ana\u202eluap", "123"]) expect((await post({ name })).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("adds a tidied name as an unclaimed member, and says so when it is taken", async () => {
    query.mockResolvedValueOnce([{ id: 9 }]);
    expect(await (await post({ name: "  Rahul   Mehta " })).json()).toEqual({ id: 9, name: "Rahul Mehta" });
    expect(query.mock.calls[0]).toEqual(["select admin_add_person($1)::int as id", ["Rahul Mehta"], 1]); // the admin's id
    query.mockResolvedValueOnce([{ id: null }]);
    expect((await post({ name: "Rahul Mehta" })).status).toBe(409);
    query.mockResolvedValueOnce([{ id: 10 }]);
    await post({ name: "Jose\u0301" }); // e + combining accent
    expect(query.mock.calls.at(-1)![1]).toEqual(["Jos\u00e9"]); // stored precomposed
  });
});

describe("POST /api/people/<id>/reset", () => {
  it("is for the admin only", async () => {
    currentPerson.mockResolvedValueOnce(member);
    expect((await resetId("4")).status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it("resets a member through the database function, as the admin (it refuses an admin tile and signs the member out)", async () => {
    query.mockResolvedValueOnce([{ reset: true }]);
    expect((await resetId("4")).status).toBe(200);
    expect(query.mock.calls[0]).toEqual(["select admin_reset_pin($1) as reset", [4], 1]);
  });

  it("answers 404 for an admin, an unknown id or a bad id", async () => {
    query.mockResolvedValueOnce([{ reset: false }]);
    expect((await resetId("1")).status).toBe(404);
    expect((await resetId("abc")).status).toBe(404);
  });
});
