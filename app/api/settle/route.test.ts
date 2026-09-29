import { beforeEach, describe, expect, it, vi } from "vitest";

const { currentPerson, settleAll, notifyLater } = vi.hoisted(() => ({ currentPerson: vi.fn(), settleAll: vi.fn(), notifyLater: vi.fn() }));
vi.mock("@/lib/session", () => ({ currentPerson }));
vi.mock("@/lib/tab", () => ({ settleAll }));
vi.mock("@/lib/push", () => ({ notifyLater }));
const { POST } = await import("./route");

const post = (body: unknown) => POST(new Request("http://x/api/settle", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  currentPerson.mockResolvedValue({ id: 1, name: "Kaushik", role: "admin" });
});

describe("POST /api/settle", () => {
  it("refuses a signed-out device before touching anything", async () => {
    currentPerson.mockResolvedValueOnce(null);
    expect((await post({ partner_id: 2, expected: 100 })).status).toBe(401);
    expect(settleAll).not.toHaveBeenCalled();
  });

  it("refuses yourself or a malformed body", async () => {
    for (const b of [{ partner_id: 1, expected: 5 }, { partner_id: "2", expected: 5 }, { partner_id: 2 }, { partner_id: 2, expected: 1.5 }, { partner_id: 2, expected: 3_000_000_000 }, {}, "not json"]) {
      expect((await post(b)).status).toBe(400);
    }
    expect(settleAll).not.toHaveBeenCalled();
  });

  it("settles the confirmed amount between the signed-in person and the partner", async () => {
    settleAll.mockResolvedValueOnce({ id: 7, amount_cents: 3060, balance: 3060, bills: 4 });
    const res = await post({ partner_id: 2, expected: 3060 });
    expect(await res.json()).toMatchObject({ id: 7, amount_cents: 3060, bills: 4 });
    expect(settleAll).toHaveBeenCalledWith(1, 2, 3060);
    expect(notifyLater).toHaveBeenCalledExactlyOnceWith(2, { title: "Kaushik settled up - $30.60", url: "/" });
  });

  it("settles nothing and returns the new balance when the tab changed since the sheet opened", async () => {
    settleAll.mockResolvedValueOnce({ id: null, amount_cents: 5060, balance: 5060, bills: 0 });
    const res = await post({ partner_id: 2, expected: 3060 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "changed", balance: 5060 });
    expect(notifyLater).not.toHaveBeenCalled();
  });
});
