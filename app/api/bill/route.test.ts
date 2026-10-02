import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { currentPerson, query, notifyLater, hasPush } = vi.hoisted(() => ({
  currentPerson: vi.fn(),
  query: vi.fn(),
  notifyLater: vi.fn(),
  hasPush: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ currentPerson }));
vi.mock("@/lib/db", () => ({ query }));
vi.mock("@/lib/push", () => ({ notifyLater, hasPush }));
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
  notifyLater.mockReset();
  hasPush.mockResolvedValue(true);
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
    expect(r).toMatchObject({ status: 200, duplicate: false, owes: 700, was: 500, photo: "none", partner_id: 2, description: "Coles", total_cents: 1000, date: "2026-09-29" });
    expect(query).toHaveBeenCalledOnce();
    const params = query.mock.calls[0][1];
    expect(params.slice(0, 8)).toEqual([bill.scan_id, 1, 2, "Coles", "2026-09-29", 1000, 1000, 700]);
    expect(params[12]).toBe(false); // a scanned bill
  });

  it("stores that a bill was added without a receipt", async () => {
    query.mockResolvedValueOnce([{ id: 5, photo_state: "none", was: 0 }]);
    const typed = { ...bill, typed: true, total_cents: 2401, lines: [{ name: "Coles", price_cents: 2401, kind: "item", share: "split" }] };
    expect(await json(await post(typed))).toMatchObject({ status: 200, owes: 1201 });
    expect(query.mock.calls[0][1][12]).toBe(true);
  });

  it("keeps no photo on a bill added without a receipt, even when one is sent", async () => {
    const jpeg = await sharp({ create: { width: 300, height: 400, channels: 3, background: "#fff" } }).jpeg().toBuffer();
    const withPhoto = (b: unknown) => {
      const form = new FormData();
      form.append("bill", JSON.stringify(b));
      form.append("photo", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }));
      return POST(new Request("http://x/api/bill", { method: "POST", body: form }));
    };
    query.mockResolvedValueOnce([{ id: 5, photo_state: "kept", was: 0 }]).mockResolvedValueOnce([{ id: 6, photo_state: "none", was: 0 }]);
    await withPhoto(bill);
    expect(query.mock.calls[0][1][9]).toMatch(/^\/9j\//); // positive control: a scanned bill keeps it (base64 JPEG)
    const typed = { ...bill, scan_id: "8f14e45f-ceea-467a-9a36-2b1c2f6c1a02", typed: true, total_cents: 2401, lines: [{ name: "Coles", price_cents: 2401, kind: "item", share: "split" }] };
    await withPhoto(typed);
    expect(query.mock.calls[1][1][9]).toBeNull();
  });

  it("tells the partner, with no amount or item in the message, and says so when they get notifications", async () => {
    query.mockResolvedValueOnce([{ id: 5, photo_state: "none", was: 500 }]);
    expect(await json(await post(bill))).toMatchObject({ notified: true });
    expect(notifyLater).toHaveBeenCalledExactlyOnceWith(2, { title: "Kaushik added a bill", url: "/bill/5" });
    hasPush.mockResolvedValueOnce(false);
    query.mockResolvedValueOnce([{ id: 6, photo_state: "none", was: 500 }]);
    expect(await json(await post(bill))).toMatchObject({ notified: false });
  });

  it("says a retried save is the same bill when nothing differs", async () => {
    query
      .mockRejectedValueOnce(Object.assign(new Error("duplicate key"), { code: "23505", constraint: "scan_request_pkey" }))
      .mockResolvedValueOnce([{ partner_id: 2, owes: 700, description: "Coles", total_cents: 1000, date: "2026-09-29", photo: "none" }])
      .mockResolvedValueOnce([{ partner_id: 2, partner: "P", balance: 700, open: 1 }]);
    expect(await json(await post(bill))).toMatchObject({ status: 200, duplicate: true, same: true });
    query.mockReset();
    query
      .mockRejectedValueOnce(Object.assign(new Error("duplicate key"), { code: "23505", constraint: "scan_request_pkey" }))
      .mockResolvedValueOnce([{ partner_id: 2, owes: 700, description: "Coles", total_cents: 1000, date: "2026-09-22", photo: "none" }])
      .mockResolvedValueOnce([{ partner_id: 2, partner: "P", balance: 700, open: 1 }]);
    expect(await json(await post(bill))).toMatchObject({ duplicate: true, same: false }); // last week's: another bill
  });

  it("answers a retried save with the bill stored the first time, not the retry's edits", async () => {
    query
      .mockRejectedValueOnce(Object.assign(new Error("duplicate key"), { code: "23505", constraint: "scan_request_pkey" }))
      .mockResolvedValueOnce([{ partner_id: 3, owes: 450, description: "First try", total_cents: 900, date: "2026-09-28", photo: "not_kept_full" }])
      .mockResolvedValueOnce([{ partner_id: 3, partner: "P", balance: 900, open: 2 }]);
    const r = await json(await post(bill)); // this retry says partner 2 / owes 700
    expect(r).toMatchObject({ status: 200, duplicate: true, same: false, partner_id: 3, owes: 450, description: "First try", total_cents: 900, date: "2026-09-28", was: 450, photo: "not_kept_full" });
    expect(query.mock.calls[2][1]).toEqual([1]); // the signed-in person's tabs; the stored partner's is picked
    expect(notifyLater).not.toHaveBeenCalled(); // told once, by the first save
    expect(hasPush).toHaveBeenCalledWith(3);
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

  it("saves the largest bill a receipt can read: 200 lines of 200-character names, each sent twice (lines + ai)", async () => {
    query.mockResolvedValueOnce([{ id: 5, photo_state: "none", was: 0 }]);
    const lines = Array.from({ length: 200 }, (_, i) => ({ name: `${i}`.padEnd(200, "x"), price_cents: 9_999, kind: "item", share: "partner" }));
    const ai = { store_name: "x".repeat(60), date: "2026-09-29", total_cents: 1_999_800, lines: lines.map((l) => ({ name: l.name, price_cents: l.price_cents, kind: l.kind })) };
    expect((await post({ ...bill, description: "x".repeat(60), total_cents: 1_999_800, lines, ai })).status).toBe(200);
  });

  it("refuses malformed bills without touching the database", async () => {
    expect(await json(await post({ ...bill, lines: [] }))).toMatchObject({ status: 400, error: "bad_bill" });
    expect(query).not.toHaveBeenCalled();
  });
});
