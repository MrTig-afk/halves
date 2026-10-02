import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { currentPerson, query, names, notifyLater, hasPush } = vi.hoisted(() => ({
  currentPerson: vi.fn(),
  query: vi.fn(),
  names: vi.fn(), // the bill's people in name order (the route's first query); not counted in `query`
  notifyLater: vi.fn(),
  hasPush: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ currentPerson }));
vi.mock("@/lib/db", () => ({ query: (sql: string, ...rest: unknown[]) => (sql.includes("order by lower(name)") ? names(...rest) : query(sql, ...rest)) }));
vi.mock("@/lib/push", () => ({ notifyLater, hasPush }));
const { POST } = await import("./route");

// Kaushik (1, signed in, pays) and Priya (2): milk shared, bread Priya's.
const bill = {
  scan_id: "8f14e45f-ceea-467a-9a36-2b1c2f6c1a01",
  people: [1, 2],
  payer_id: 1,
  description: "Coles",
  date: "2026-09-29",
  total_cents: 1000,
  lines: [
    { name: "Milk", price_cents: 600, kind: "item", people: [1, 2] },
    { name: "Bread", price_cents: 400, kind: "item", people: [2] },
  ],
  ai: null,
};
// The Artifact's Coles receipt, three people (K=1 pays, P=2, R=3): protein bar and shampoo K's, coffee R's, the rest Everyone.
const everyone = [1, 2, 3];
const coles = {
  ...bill,
  people: everyone,
  total_cents: 4994,
  lines: [
    [310, "item", everyone], [450, "item", everyone], [419, "item", everyone], [350, "item", [1]], [1200, "item", everyone],
    [-200, "discount", null], [900, "item", [1]], [680, "item", everyone], [850, "item", [3]], [35, "surcharge", null],
  ].map(([price_cents, kind, people], i) => ({ name: `Line ${i}`, price_cents, kind, people })),
};
const post = (b: unknown) => {
  const form = new FormData();
  form.append("bill", JSON.stringify(b));
  return POST(new Request("http://x/api/bill", { method: "POST", body: form }));
};
const json = async (res: Response) => ({ status: res.status, ...(await res.json()) });
const saved = (id = 5, tabs: { person_id: number; was: number }[] = []) => ({ id, photo_state: "none", tabs });
const dup = () => Object.assign(new Error("duplicate key"), { code: "23505", constraint: "scan_request_pkey" });

beforeEach(() => {
  query.mockReset();
  names.mockReset();
  names.mockImplementation(async ([ids]: number[][]) => [...ids].sort((a, b) => a - b).map((id) => ({ id }))); // name order = id order unless a test says otherwise
  notifyLater.mockReset();
  hasPush.mockReset();
  hasPush.mockResolvedValue(true);
  currentPerson.mockResolvedValue({ id: 1, name: "Kaushik", role: "admin" });
});

describe("POST /api/bill", () => {
  it("refuses a signed-out device before touching the database", async () => {
    currentPerson.mockResolvedValueOnce(null);
    expect(await json(await post(bill))).toMatchObject({ status: 401, error: "signed_out" });
    expect(query).not.toHaveBeenCalled();
  });

  it("works out every share itself and saves as the signed-in person", async () => {
    query.mockResolvedValueOnce([saved(5, [{ person_id: 2, was: 500 }])]);
    // the client's own idea of what is owed, who added it and when it was edited is not read
    const r = await json(await post({ ...bill, owes: { 2: 1 }, partner_owes_cents: 1, added_by: 2, date_edited_at: "2020-01-01T00:00:00Z", total_edited_at: "2020-01-01T00:00:00Z" }));
    // milk 600 -> 300 each, bread 400 -> Priya's; no fees; the tab before it comes from the same statement
    expect(r).toMatchObject({ status: 200, duplicate: false, same: true, photo: "none", payer_id: 1, description: "Coles", total_cents: 1000, date: "2026-09-29", shares: [{ person_id: 2, owes: 700 }], tabs: [{ person_id: 2, was: 500 }] });
    expect(query).toHaveBeenCalledOnce();
    const [, params, personId] = query.mock.calls[0];
    expect(params.slice(0, 7)).toEqual([bill.scan_id, 1, 1, "Coles", "2026-09-29", 1000, 1000]); // adder = me, payer, ...
    expect(JSON.parse(params[7])).toEqual([{ person_id: 1, owes: 0 }, { person_id: 2, owes: 700 }]);
    expect(params[12]).toBe(false); // a scanned bill
    expect([params[13], params[14]]).toEqual([false, false]); // no edit times
    expect(JSON.stringify(params)).not.toContain("2020-01-01");
    expect(personId).toBe(1); // the database is told who is acting
    expect(JSON.parse(params[11])).toEqual([
      { position: 1, name: "Milk", price_cents: 600, kind: "item", people: [1, 2] },
      { position: 2, name: "Bread", price_cents: 400, kind: "item", people: [2] },
    ]);
  });

  it("splits three people the way the Artifact does (Coles: Priya $9.60, Rahul $18.16)", async () => {
    query.mockResolvedValueOnce([saved(5, [{ person_id: 2, was: 0 }, { person_id: 3, was: 0 }])]);
    const r = await json(await post({ ...coles, owes: { 2: 1, 3: 1 } }));
    expect(r.shares).toEqual([{ person_id: 2, owes: 960 }, { person_id: 3, owes: 1816 }]);
    expect(JSON.parse(query.mock.calls[0][1][7])).toEqual([{ person_id: 1, owes: 0 }, { person_id: 2, owes: 960 }, { person_id: 3, owes: 1816 }]);
  });

  it("breaks a one-cent tie in name order, whatever order the phone sent the people in", async () => {
    query.mockResolvedValueOnce([saved()]);
    names.mockResolvedValueOnce([{ id: 1 }, { id: 3 }, { id: 2 }]); // by name: Kaushik, then 3, then 2 (the phone sent 2 before 3)
    const r = await json(await post({ ...bill, people: [1, 2, 3], total_cents: null, lines: [{ name: "Gift", price_cents: 1001, kind: "item", people: [2, 3] }] }));
    expect(r.shares).toEqual([{ person_id: 2, owes: 500 }, { person_id: 3, owes: 501 }]); // later in name order owes the cent less
  });

  it("stores when the date and the receipt total were edited, decided against the reading", async () => {
    query.mockResolvedValueOnce([saved()]);
    const ai = { store_name: "COLES", date: "2026-09-29", total_cents: 1000, lines: [{ name: "MILK", price_cents: 600, kind: "item" }] };
    await post({ ...bill, date: "2026-09-28", ai, date_edited: false, total_edited: true }); // date changed (signal ignored), total not (signal ignored)
    expect([query.mock.calls[0][1][13], query.mock.calls[0][1][14]]).toEqual([true, false]);
  });

  it("stores that a bill was added without a receipt, never edited", async () => {
    query.mockResolvedValueOnce([saved()]);
    const typed = { ...bill, typed: true, total_cents: 2401, lines: [{ name: "Coles", price_cents: 2401, kind: "item", people: [1, 2] }], date_edited: true, total_edited: true };
    expect(await json(await post(typed))).toMatchObject({ status: 200, shares: [{ person_id: 2, owes: 1201 }] });
    const params = query.mock.calls[0][1];
    expect([params[12], params[13], params[14]]).toEqual([true, false, false]);
  });

  it("a bill someone else paid: payer P, added by K, K owes $19.00", async () => {
    query.mockResolvedValueOnce([saved(5, [{ person_id: 2, was: 0 }])]);
    const typed = { ...bill, payer_id: 2, typed: true, total_cents: 3800, lines: [{ name: "Nando's", price_cents: 3800, kind: "item", people: [1, 2] }] };
    const r = await json(await post(typed));
    expect(r).toMatchObject({ status: 200, payer_id: 2, shares: [{ person_id: 1, owes: 1900 }] });
    expect(query.mock.calls[0][1].slice(1, 3)).toEqual([1, 2]); // added_by K, payer P
    expect(JSON.parse(query.mock.calls[0][1][7])).toEqual([{ person_id: 1, owes: 1900 }, { person_id: 2, owes: 0 }]);
  });

  it("keeps no photo on a bill added without a receipt, even when one is sent", async () => {
    const jpeg = await sharp({ create: { width: 300, height: 400, channels: 3, background: "#fff" } }).jpeg().toBuffer();
    const withPhoto = (b: unknown) => {
      const form = new FormData();
      form.append("bill", JSON.stringify(b));
      form.append("photo", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }));
      return POST(new Request("http://x/api/bill", { method: "POST", body: form }));
    };
    query.mockResolvedValueOnce([{ ...saved(), photo_state: "kept" }]).mockResolvedValueOnce([saved(6)]);
    await withPhoto(bill);
    expect(query.mock.calls[0][1][9]).toMatch(/^\/9j\//); // positive control: a scanned bill keeps it (base64 JPEG)
    const typed = { ...bill, scan_id: "8f14e45f-ceea-467a-9a36-2b1c2f6c1a02", typed: true, total_cents: 2401, lines: [{ name: "Coles", price_cents: 2401, kind: "item", people: [1, 2] }] };
    await withPhoto(typed);
    expect(query.mock.calls[1][1][9]).toBeNull();
  });

  it("tells everyone but the adder, the payer in its own words, with no amount or item in the message", async () => {
    query.mockResolvedValueOnce([saved(5)]);
    await post({ ...coles, payer_id: 2 });
    expect(notifyLater).toHaveBeenCalledTimes(2);
    expect(notifyLater).toHaveBeenCalledWith(2, { title: "Kaushik added a bill you paid", url: "/bill/5" });
    expect(notifyLater).toHaveBeenCalledWith(3, { title: "Kaushik added a bill", url: "/bill/5" });
    expect(notifyLater).not.toHaveBeenCalledWith(1, expect.anything()); // the adder is not told
  });

  it("says who has a phone for it: only those", async () => {
    hasPush.mockImplementation(async (id: number) => id !== 3);
    query.mockResolvedValueOnce([saved(5)]);
    expect(await json(await post(coles))).toMatchObject({ notified: [2] });
    expect(hasPush.mock.calls.map((c) => c[0]).sort()).toEqual([2, 3]);
  });

  it("says a retried save is the same bill when nothing differs", async () => {
    const stored = { payer_id: 1, description: "Coles", total_cents: 1000, date: "2026-09-29", photo: "none", people: [{ person_id: 1, owes: 0 }, { person_id: 2, owes: 700 }] };
    query.mockRejectedValueOnce(dup()).mockResolvedValueOnce([stored]).mockResolvedValueOnce([{ partner_id: 2, partner: "P", balance: 700, open: 1 }]);
    expect(await json(await post(bill))).toMatchObject({ status: 200, duplicate: true, same: true, tabs: [{ person_id: 2, was: 0 }], shares: [{ person_id: 2, owes: 700 }], notified: [2] });
    for (const other of [{ date: "2026-09-22" }, { payer_id: 2 }, { people: [{ person_id: 1, owes: 0 }, { person_id: 2, owes: 650 }] }]) {
      query.mockReset();
      query.mockRejectedValueOnce(dup()).mockResolvedValueOnce([{ ...stored, ...other }]).mockResolvedValueOnce([{ partner_id: 2, partner: "P", balance: 700, open: 1 }]);
      expect(await json(await post(bill)), JSON.stringify(other)).toMatchObject({ duplicate: true, same: false }); // another bill
    }
  });

  it("answers a retried save with the bill stored the first time, not the retry's edits, and pushes nothing", async () => {
    const stored = { payer_id: 1, description: "First try", total_cents: 900, date: "2026-09-28", photo: "not_kept_full", people: [{ person_id: 1, owes: 0 }, { person_id: 3, owes: 450 }] };
    query.mockRejectedValueOnce(dup()).mockResolvedValueOnce([stored]).mockResolvedValueOnce([{ partner_id: 2, partner: "P", balance: 100, open: 1 }, { partner_id: 3, partner: "R", balance: 900, open: 2 }]);
    const r = await json(await post(bill)); // this retry says Priya owes 700
    expect(r).toMatchObject({ status: 200, duplicate: true, same: false, payer_id: 1, description: "First try", total_cents: 900, date: "2026-09-28", photo: "not_kept_full", shares: [{ person_id: 3, owes: 450 }], tabs: [{ person_id: 3, was: 450 }] });
    expect(query.mock.calls[1][2]).toBe(1); // the stored bill and the tabs are read as me
    expect(query.mock.calls[2][1]).toEqual([1]);
    expect(notifyLater).not.toHaveBeenCalled(); // told once, by the first save
    expect(hasPush).toHaveBeenCalledWith(3);
  });

  it("answers a retry of a bill someone else paid with my side of the tab", async () => {
    const stored = { payer_id: 2, description: "Nando's", total_cents: 3800, date: "2026-09-29", photo: "none", people: [{ person_id: 1, owes: 1900 }, { person_id: 2, owes: 0 }] };
    query.mockRejectedValueOnce(dup()).mockResolvedValueOnce([stored]).mockResolvedValueOnce([{ partner_id: 2, partner: "P", balance: -280, open: 1 }]);
    expect(await json(await post({ ...bill, payer_id: 2 }))).toMatchObject({ duplicate: true, shares: [{ person_id: 1, owes: 1900 }], tabs: [{ person_id: 2, was: 1620 }] });
  });

  it("refuses a scan id another person already used", async () => {
    query.mockRejectedValueOnce(dup()).mockResolvedValueOnce([]);
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

  it("refuses a bill without the adder before any query or image work", async () => {
    expect(await json(await post({ ...bill, people: [2, 3], payer_id: 2, lines: [{ name: "Milk", price_cents: 1000, kind: "item", people: [3] }] }))).toMatchObject({ status: 400, error: "bad_bill", message: "Pick who this bill is with." });
    expect(query).not.toHaveBeenCalled();
    expect(hasPush).not.toHaveBeenCalled();
  });

  it("refuses 1 person and 6 people with their own words, before the database", async () => {
    const one = { ...bill, people: [1], lines: [{ name: "Milk", price_cents: 1000, kind: "item", people: [1] }] };
    expect(await json(await post(one))).toMatchObject({ status: 400, message: "Add at least one other person." });
    const six = { ...bill, people: [1, 2, 3, 4, 5, 6] };
    expect(await json(await post(six))).toMatchObject({ status: 400, message: "A bill can have up to 5 people." });
    expect(query).not.toHaveBeenCalled();
  });

  it("refuses a person who does not exist (the statement makes no bill)", async () => {
    names.mockResolvedValueOnce([{ id: 1 }]); // only one of the two is a person
    expect(await json(await post({ ...bill, people: [1, 99], lines: [{ name: "Milk", price_cents: 1000, kind: "item", people: [99] }] }))).toMatchObject({ status: 400, message: "Pick who this bill is with." });
    expect(query).not.toHaveBeenCalled();
    query.mockResolvedValueOnce([{ id: null, photo_state: null, tabs: [] }]); // the statement itself also refuses
    expect(await json(await post(bill))).toMatchObject({ status: 400 });
    expect(notifyLater).not.toHaveBeenCalled();
  });

  it("saves the largest bill a receipt can read: 200 lines of 200-character names, five-person sets, each sent twice (lines + ai)", async () => {
    query.mockResolvedValueOnce([saved()]);
    const lines = Array.from({ length: 200 }, (_, i) => ({ name: `${i}`.padEnd(200, "x"), price_cents: 9_999, kind: "item", people: [1, 2, 3, 4, 5] }));
    const ai = { store_name: "x".repeat(60), date: "2026-09-29", total_cents: 1_999_800, lines: lines.map((l) => ({ name: l.name, price_cents: l.price_cents, kind: l.kind })) };
    expect((await post({ ...bill, people: [1, 2, 3, 4, 5], description: "x".repeat(60), total_cents: 1_999_800, lines, ai })).status).toBe(200);
  });

  it("refuses malformed bills without touching the database", async () => {
    expect(await json(await post({ ...bill, lines: [] }))).toMatchObject({ status: 400, error: "bad_bill" });
    expect(await json(await post({ ...bill, lines: [{ name: "Milk", price_cents: 600, kind: "item", people: [] }] }))).toMatchObject({ status: 400, error: "bad_bill" });
    expect(query).not.toHaveBeenCalled();
  });
});
