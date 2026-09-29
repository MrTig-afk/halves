import { beforeEach, describe, expect, it, vi } from "vitest";

const { currentPerson, query } = vi.hoisted(() => ({ currentPerson: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/session", () => ({ currentPerson }));
vi.mock("@/lib/db", () => ({ query }));
const { POST } = await import("./route");

const bill = {
  scan_id: "8f14e45f-ceea-467a-9a36-2b1c2f6c1a01",
  partner_id: 2,
  description: "Coles",
  date: "2026-09-29",
  total_cents: 1000,
  lines: [
    { name: "Milk", price_cents: 600, kind: "item", share: "split" },
    { name: "Bread", price_cents: 400, kind: "item", share: "partner" },
  ],
  ai: null,
};
const post = (b: unknown) => {
  const form = new FormData();
  form.append("bill", JSON.stringify(b));
  return POST(new Request("http://x/api/bill", { method: "POST", body: form }));
};
const json = async (res: Response) => ({ status: res.status, ...(await res.json()) });

beforeEach(() => {
  query.mockReset();
  currentPerson.mockResolvedValue({ id: 1, name: "Kaushik", role: "admin" });
});

describe("POST /api/bill", () => {
  it("refuses a signed-out device before touching the database", async () => {
    currentPerson.mockResolvedValueOnce(null);
    expect(await json(await post(bill))).toMatchObject({ status: 401, error: "signed_out" });
    expect(query).not.toHaveBeenCalled();
  });

  it("works out what is owed itself and returns the tab", async () => {
    query.mockResolvedValueOnce([{ id: 5, photo_state: "none", was: 500 }]);
    const r = await json(await post({ ...bill, partner_owes_cents: 1 }));
    // split 600 -> 300, partner's 400 -> 400; no fees; the tab before it comes from the same statement
    expect(r).toMatchObject({ status: 200, duplicate: false, owes: 700, was: 500, photo: "none", partner_id: 2, description: "Coles" });
    expect(query).toHaveBeenCalledOnce();
    const params = query.mock.calls[0][1];
    expect(params.slice(0, 8)).toEqual([bill.scan_id, 1, 2, "Coles", "2026-09-29", 1000, 1000, 700]);
  });

  it("answers a retried save with the bill stored the first time, not the retry's edits", async () => {
    query
      .mockRejectedValueOnce(Object.assign(new Error("duplicate key"), { code: "23505", constraint: "scan_request_pkey" }))
      .mockResolvedValueOnce([{ partner_id: 3, owes: 450, description: "First try", photo: "not_kept_full" }])
      .mockResolvedValueOnce([{ balance: 900 }]);
    const r = await json(await post(bill)); // this retry says partner 2 / owes 700
    expect(r).toMatchObject({ status: 200, duplicate: true, partner_id: 3, owes: 450, description: "First try", was: 450, photo: "not_kept_full" });
    expect(query.mock.calls[2][1]).toEqual([1, 3]); // the tab is the stored partner's
  });

  it("refuses a scan id another person already used", async () => {
    query.mockRejectedValueOnce(Object.assign(new Error("duplicate key"), { code: "23505", constraint: "scan_request_pkey" })).mockResolvedValueOnce([]);
    expect(await json(await post(bill))).toMatchObject({ status: 409, retryable: false });
  });

  it("does not mistake another unique key for a retried save", async () => {
    query.mockRejectedValueOnce(Object.assign(new Error("duplicate key"), { code: "23505", constraint: "line_item_bill_id_position_key" }));
    await expect(post(bill)).rejects.toThrow("duplicate key");
  });

  it("lets any other database error surface as a server failure", async () => {
    query.mockRejectedValueOnce(Object.assign(new Error("connection reset"), { code: "08006" }));
    await expect(post(bill)).rejects.toThrow("connection reset");
  });

  it("refuses a bill with yourself (before any work) or with nobody", async () => {
    expect((await post({ ...bill, partner_id: 1 })).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
    query.mockResolvedValueOnce([{ id: null, photo_state: null }]);
    expect((await post({ ...bill, partner_id: 99 })).status).toBe(400);
  });

  it("refuses malformed bills without touching the database", async () => {
    expect(await json(await post({ ...bill, lines: [] }))).toMatchObject({ status: 400, error: "bad_bill" });
    expect(query).not.toHaveBeenCalled();
  });
});
