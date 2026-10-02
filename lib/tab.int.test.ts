// Against a real database (the Neon dev branch), because isolation and settling are properties
// of the SQL, not of any one function. Skipped when no DATABASE_URL is loaded (CI has none):
//   node --env-file=.env --env-file-if-exists=.env.local node_modules/vitest/vitest.mjs run lib/tab.int.test.ts
// Uses four fixed test people (Test Iso A..D, created once, reused), so repeated runs do not add
// people. It refuses any database without the dev-only `dev_branch_marker` table: test people and
// bills can never be deleted, so they must never reach the real database.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Person } from "./session";

const who = vi.hoisted(() => ({ current: null as Person | null }));
vi.mock("@/lib/session", () => ({
  currentPerson: async () => who.current,
  requirePerson: async () => {
    if (!who.current) throw new Error("signed out"); // every test here signs someone in first
    return who.current;
  },
}));
// Saving tells the other people's phones once the response has gone; here there is no response, so now.
vi.mock("next/server", async (actual) => ({ ...(await actual<object>()), after: (fn: () => unknown) => void fn() }));

// lib/schema.int.test.ts runs the migration (DDL locks) while this file runs, in the same vitest run;
// Postgres may pick one of our statements as the deadlock victim (40P01), which rolled back whole, so
// it is simply run again. Nothing else is retried.
vi.mock("./db", async (actual) => {
  const real = await actual<typeof import("./db")>();
  const query: typeof real.query = async (...args) => {
    for (let i = 0; ; i++) {
      try {
        return await real.query(...args);
      } catch (e) {
        if (i >= 5 || (e as { code?: string }).code !== "40P01") throw e;
        await new Promise((r) => setTimeout(r, 300 * (i + 1)));
      }
    }
  };
  return { ...real, query };
});

const live = !!process.env.DATABASE_URL;

describe.skipIf(!live)("the tab on a real database", async () => {
  const { query } = await import("./db");
  const { bill, openBills, round, rounds, settleAll, tabs } = await import("./tab");
  const { POST: saveBill } = await import("@/app/api/bill/route");
  const { GET: photo } = await import("@/app/api/bill/[id]/photo/route");
  const { default: BillPage } = await import("@/app/(app)/bill/[id]/page");
  const { default: SettledPage } = await import("@/app/(app)/settled/[id]/page");
  // The screens themselves, not just the queries: a page that answers 404 throws Next's
  // not-found signal; one that renders resolves.
  const is404 = async (render: () => Promise<unknown>) => {
    try {
      await render();
      return false;
    } catch (e) {
      return String((e as { digest?: string }).digest).includes("404");
    }
  };
  const billPageAs = (p: Person, id: number) => {
    who.current = p;
    return () => BillPage({ params: Promise.resolve({ id: String(id) }), searchParams: Promise.resolve({}) });
  };
  const roundPageAs = (p: Person, id: number) => {
    who.current = p;
    return () => SettledPage({ params: Promise.resolve({ id: String(id) }) });
  };
  const photoAs = async (p: Person, id: number) => {
    who.current = p;
    return (await photo(new Request("http://x"), { params: Promise.resolve({ id: String(id) }) })).status;
  };
  let A: Person, B: Person, C: Person, D: Person;

  const person = async (name: string): Promise<Person> => {
    await query("insert into person (name, role) values ($1, 'member') on conflict (name) do nothing", [name]);
    const [p] = await query<Person>("select id::int as id, name, role from person where name = $1", [name]);
    return p;
  };
  // Saves through the real route as `adder`: one item per entry of `lines` (cents, who had it), the
  // bill shared by `people`, paid by `payer`. The receipt total is not read, so the lines are the total.
  const receipt = readFileSync("fixtures/public/coles.jpg");
  type Opts = { photo?: boolean; date?: string; ai?: unknown; typed?: boolean; date_edited?: boolean; total_edited?: boolean };
  const save = async (adder: Person, people: Person[], payer: Person, lines: [number, Person[]][], o: Opts = {}) => {
    who.current = adder;
    const form = new FormData();
    if (o.photo) form.append("photo", new Blob([new Uint8Array(receipt)], { type: "image/jpeg" }), "r.jpg");
    form.append(
      "bill",
      JSON.stringify({
        scan_id: crypto.randomUUID(),
        people: people.map((p) => p.id),
        payer_id: payer.id,
        description: "Isolation test",
        date: o.date ?? "2026-09-29",
        total_cents: o.typed ? lines[0][0] : null,
        lines: lines.map(([price_cents, had], i) => ({ name: `Thing ${i + 1}`, price_cents, kind: "item", people: had.map((p) => p.id) })),
        ai: o.ai ?? null,
        typed: o.typed ?? false,
        date_edited: o.date_edited ?? false,
        total_edited: o.total_edited ?? false,
      }),
    );
    const res = await saveBill(new Request("http://x/api/bill", { method: "POST", body: form }));
    expect(res.status).toBe(200);
    const [row] = await query<{ id: number }>("select id::int from bill where added_by = $1 order by id desc limit 1", [adder.id], adder.id);
    return row.id;
  };
  const balance = async (me: Person, other: Person) => (await tabs(me.id)).find((t) => t.partner_id === other.id)!.balance;
  const settle = async (x: Person, y: Person) => settleAll(x.id, y.id, await balance(x, y));
  const clean = async () => {
    for (const [x, y] of [[A, B], [A, C], [A, D], [B, C], [B, D], [C, D]]) await settle(x, y);
  };
  const shares = (id: number, as: Person) =>
    query<{ person_id: number; owes_cents: number; settlement_id: number | null }>("select person_id::int, owes_cents, settlement_id::int from bill_person where bill_id = $1 order by person_id", [id], as.id);
  const listed = async (p: Person, id: number) => (await openBills(p.id)).some((b) => b.id === id);

  beforeAll(async () => {
    const [marker] = await query<{ dev: boolean; role: string }>(
      "select to_regclass('public.dev_branch_marker') is not null as dev, current_user as role",
    );
    if (!marker.dev) throw new Error("Refusing to run: this is not the dev branch (no dev_branch_marker table).");
    // The immutability checks really try an UPDATE and a DELETE; only the app role is refused them.
    if (marker.role !== "halves_app") throw new Error(`Refusing to run as ${marker.role}: connect as halves_app.`);
    [A, B, C, D] = [await person("Test Iso A"), await person("Test Iso B"), await person("Test Iso C"), await person("Test Iso D")];
    await clean(); // start from a clean tab
  }, 120_000);

  it("adds bills from both sides into one balance, mirrored for the other person", async () => {
    await clean();
    await save(A, [A, B], A, [[2000, [A, B]]]); // B owes A 10.00
    await save(B, [A, B], B, [[400, [A]]]); // A owes B 4.00
    expect(await balance(A, B)).toBe(600);
    expect(await balance(B, A)).toBe(-600);
  }, 120_000);

  it("a 3-person bill A paid: B and C owe A only, and B and C owe each other nothing", async () => {
    await clean();
    const id = await save(A, [A, B, C], A, [[3000, [A, B, C]]]);
    expect(await shares(id, A)).toEqual([
      { person_id: A.id, owes_cents: 0, settlement_id: null },
      { person_id: B.id, owes_cents: 1000, settlement_id: null },
      { person_id: C.id, owes_cents: 1000, settlement_id: null },
    ]);
    expect([await balance(A, B), await balance(A, C), await balance(B, C), await balance(C, B)]).toEqual([1000, 1000, 0, 0]);
    expect([await balance(B, A), await balance(C, A)]).toEqual([-1000, -1000]);
    const row = (await openBills(B.id)).find((b) => b.id === id)!;
    expect(row).toMatchObject({ payer_id: A.id, size: 3, amount: 1000 });
    expect(row.others.map((o) => o.id)).toEqual([A.id, C.id]);
    expect((await openBills(A.id)).find((b) => b.id === id)).toMatchObject({ amount: 2000 });
  }, 120_000);

  it("never shows a bill, its round or its photo to someone who is not on it", async () => {
    await clean();
    const ab = await save(A, [A, B], A, [[1000, [A, B]]], { photo: true });
    expect(await listed(C, ab)).toBe(false);
    expect(await bill(ab, C.id)).toBeNull();
    expect(await bill(ab, A.id)).not.toBeNull();
    expect(await bill(ab, B.id)).not.toBeNull();
    expect(await balance(C, A)).toBe(0);
    expect([await photoAs(A, ab), await photoAs(B, ab), await photoAs(C, ab)]).toEqual([200, 200, 404]);
    expect([await is404(billPageAs(A, ab)), await is404(billPageAs(B, ab)), await is404(billPageAs(C, ab))]).toEqual([false, false, true]);

    const abc = await save(A, [A, B, C], A, [[1500, [A, B, C]]], { photo: true });
    expect([await listed(C, abc), await listed(D, abc), await listed(D, ab)]).toEqual([true, false, false]);
    expect(await bill(abc, C.id)).not.toBeNull();
    expect(await bill(abc, D.id)).toBeNull();
    expect([await photoAs(C, abc), await photoAs(D, abc)]).toEqual([200, 404]);
    expect([await is404(billPageAs(C, abc)), await is404(billPageAs(D, abc))]).toEqual([false, true]);
    expect((await openBills(D.id)).length).toBe(0);
    expect(await balance(D, A)).toBe(0);
  }, 120_000);

  it("settles exactly the open balance once, even when both press at the same moment", async () => {
    await clean();
    await save(A, [A, B], A, [[2000, [A, B]]]); // B owes A 10.00
    await save(B, [A, B], B, [[400, [A]]]); // A owes B 4.00
    const before = await balance(A, B); // 600
    const [one, two] = await Promise.all([settleAll(A.id, B.id, before), settleAll(B.id, A.id, -before)]);
    const won = [one, two].filter((r) => r.id !== null);
    expect(won).toHaveLength(1);
    expect(won[0].amount_cents).toBe(Math.abs(before));
    expect(won[0].bills).toBe(2);
    expect(await balance(A, B)).toBe(0);
    expect((await openBills(A.id)).some((b) => b.others.some((o) => o.id === B.id) && b.size === 2)).toBe(false);
    const [s] = await query<{ from: number; to: number; amount: number }>(
      "select from_person_id::int as from, to_person_id::int as to, amount_cents as amount from settlement where id = $1",
      [won[0].id],
      A.id,
    );
    expect(s).toEqual({ from: B.id, to: A.id, amount: before });
    // The round is A and B's alone.
    expect(await round(won[0].id!, A.id)).not.toBeNull();
    expect(await round(won[0].id!, C.id)).toBeNull();
    expect((await round(won[0].id!, B.id))!.bills.map((b) => b.amount).sort((x, y) => x - y)).toEqual([400, 1000]);
    expect([await is404(roundPageAs(A, won[0].id!)), await is404(roundPageAs(C, won[0].id!))]).toEqual([false, true]);
    expect((await rounds(C.id)).some((r) => r.id === won[0].id)).toBe(false);
  }, 120_000);

  it("settles one pair at a time: A-B stamps only B's share, A-C stays open, the bill is Settled when the last is", async () => {
    await clean();
    const id = await save(A, [A, B, C], A, [[3000, [A, B, C]]]);
    const r = await settleAll(A.id, B.id, 1000);
    expect(r).toMatchObject({ amount_cents: 1000, balance: 1000, bills: 1 });
    const rows = await shares(id, A);
    expect(rows.map((x) => [x.person_id, x.settlement_id !== null])).toEqual([[A.id, false], [B.id, true], [C.id, false]]);
    expect(await balance(A, B)).toBe(0);
    expect(await balance(A, C)).toBe(1000); // untouched
    expect((await bill(id, A.id))!.settled_at).toBeNull(); // C still owes
    expect((await bill(id, C.id))!.people.find((p) => p.person_id === B.id)!.settled_at).not.toBeNull();
    expect(await listed(A, id)).toBe(true);
    expect(await listed(B, id)).toBe(false); // B has nothing open on it
    expect(await listed(C, id)).toBe(true);
    // C is on the bill but the A-B round is not C's.
    expect(await bill(id, C.id)).not.toBeNull();
    expect(await round(r.id!, C.id)).toBeNull();
    expect(await is404(roundPageAs(C, r.id!))).toBe(true);
    expect(await is404(roundPageAs(A, r.id!))).toBe(false);
    await settleAll(A.id, C.id, 1000);
    const done = await bill(id, A.id);
    expect(done!.settled_at).not.toBeNull();
    expect(done!.people.every((p) => p.person_id === A.id || p.settled_at !== null)).toBe(true);
    expect(await listed(A, id)).toBe(false);
  }, 120_000);

  it("settles nothing when the balance is not the one confirmed", async () => {
    await clean();
    await save(A, [A, B], A, [[800, [A, B]]]); // B owes A 4.00
    const r = await settleAll(A.id, B.id, 300);
    expect(r).toMatchObject({ id: null, balance: 400 });
    expect(await balance(A, B)).toBe(400);
  }, 120_000);

  it("never loses a bill saved at the same moment as a settle: it is either in the round or still open", async () => {
    await clean();
    await save(A, [A, B], A, [[800, [A, B]]]); // B owes A 4.00
    const confirmed = await balance(A, B);
    const [, r] = await Promise.all([save(B, [A, B], B, [[600, [A]]]), settleAll(A.id, B.id, confirmed)]);
    const open = await balance(A, B);
    if (r.id) {
      // The settle went first: it took exactly what was confirmed, and the new bill is open.
      expect(r.amount_cents).toBe(Math.abs(confirmed));
      expect(open).toBe(-600);
    } else {
      // The save went first: the balance changed, so nothing was settled and everything is open.
      expect(open).toBe(confirmed - 600);
    }
    await settle(A, B);
    expect(await balance(A, B)).toBe(0);
  }, 120_000);

  it("ends a phone's notifications with its session (sign out, PIN change, PIN reset)", async () => {
    const [s] = await query<{ id: string }>("insert into device_session (person_id, pin_stamp) select id, pin_stamp from person where id = $1 returning id", [A.id]);
    const endpoint = `https://fcm.googleapis.com/fcm/send/int-test-${s.id}`;
    await query("insert into push_subscription (person_id, session_id, endpoint, p256dh, auth) values ($1, $2, $3, 'p', 'a')", [A.id, s.id, endpoint], A.id);
    await query("delete from device_session where id = $1", [s.id]);
    expect(await query("select 1 from push_subscription where endpoint = $1", [endpoint], A.id)).toEqual([]);
  }, 120_000);

  it("leaves saved bills unchangeable by the app's role: no amount, description or edit time, no un-settling, no delete", async () => {
    await clean();
    const id = await save(A, [A, B], A, [[1000, [A, B]]]);
    await settle(A, B); // a settled share to try to undo
    const denied = (sql: string, message: RegExp) => expect(query(sql, [id], A.id)).rejects.toThrow(message);
    await denied("update bill_person set owes_cents = 0 where bill_id = $1", /permission denied/);
    await denied("update bill set description = 'changed' where id = $1", /permission denied/);
    await denied("update bill set total_cents = 1 where id = $1", /permission denied/);
    await denied("update bill set date_edited_at = now() where id = $1", /permission denied/);
    await denied("update bill set total_edited_at = now() where id = $1", /permission denied/);
    await denied("update bill_person set settlement_id = null where bill_id = $1 and settlement_id is not null", /already settled/);
    await denied("delete from bill where id = $1", /permission denied/);
    await denied("delete from bill_person where bill_id = $1", /permission denied/);
    await denied("delete from line_item_person where line_item_id in (select id from line_item where bill_id = $1)", /permission denied/);
    expect((await shares(id, A)).find((x) => x.person_id === B.id)).toMatchObject({ owes_cents: 500 });
  }, 120_000);

  it("A adds a bill B paid: payer B, adder A, A owes, balances mirrored", async () => {
    await clean();
    const id = await save(A, [A, B], B, [[3800, [A, B]]]);
    const [row] = await query<{ payer_id: number; added_by: number }>("select payer_id::int, added_by::int from bill where id = $1", [id], A.id);
    expect(row).toEqual({ payer_id: B.id, added_by: A.id });
    expect(await shares(id, A)).toEqual([
      { person_id: A.id, owes_cents: 1900, settlement_id: null },
      { person_id: B.id, owes_cents: 0, settlement_id: null },
    ]);
    expect([await balance(A, B), await balance(B, A)]).toEqual([-1900, 1900]);
    expect((await bill(id, B.id))).toMatchObject({ payer_id: B.id, added_by: A.id, adder: A.name });
    expect((await openBills(A.id)).find((b) => b.id === id)).toMatchObject({ amount: 1900, payer_id: B.id });
    expect((await openBills(B.id)).find((b) => b.id === id)).toMatchObject({ amount: 1900 });
  }, 120_000);

  it("a $0.00 share is never open: C, who had nothing, owes nothing and does not hold the bill open; an all-$0 bill is Settled at save", async () => {
    await clean();
    const id = await save(A, [A, B, C], A, [[3000, [A, B]]]); // C had nothing
    expect((await shares(id, A)).map((x) => [x.person_id, x.owes_cents])).toEqual([[A.id, 0], [B.id, 1500], [C.id, 0]]);
    expect(await balance(A, C)).toBe(0);
    expect((await tabs(A.id)).find((t) => t.partner_id === C.id)!.open).toBe(0);
    expect(await listed(C, id)).toBe(false);
    expect(await listed(A, id)).toBe(true);
    expect((await bill(id, C.id))!.people.find((p) => p.person_id === C.id)!.settled_at).not.toBeNull(); // shown settled
    await settleAll(A.id, B.id, 1500);
    expect((await bill(id, A.id))!.settled_at).not.toBeNull(); // Settled once A-B is
    expect(await listed(A, id)).toBe(false);

    const zero = await save(A, [A, B], A, [[800, [A]]]); // only the payer had it: B owes $0.00
    const z = (await bill(zero, B.id))!;
    expect(z.settled_at).not.toBeNull();
    expect([await listed(A, zero), await listed(B, zero)]).toEqual([false, false]);
    expect(await balance(A, B)).toBe(0);
  }, 120_000);

  it("stores when the date was edited (not the total), within seconds of the database's clock, and never on a bill without a receipt", async () => {
    const ai = { store_name: "COLES", date: "2026-09-29", total_cents: 1000, lines: [{ name: "MILK", price_cents: 1000, kind: "item" }] };
    // date changed against the reading; the total is the one the lines make, so send it through the reading's value
    who.current = A;
    const form = new FormData();
    form.append(
      "bill",
      JSON.stringify({
        scan_id: crypto.randomUUID(),
        people: [A.id, B.id],
        payer_id: A.id,
        description: "Edit test",
        date: "2026-09-28",
        total_cents: 1000,
        lines: [{ name: "Milk", price_cents: 1000, kind: "item", people: [A.id, B.id] }],
        ai,
        typed: false,
      }),
    );
    expect((await saveBill(new Request("http://x/api/bill", { method: "POST", body: form }))).status).toBe(200);
    const [{ id }] = await query<{ id: number }>("select id::int from bill where added_by = $1 order by id desc limit 1", [A.id], A.id);
    const [t] = await query<{ date_near: boolean; total_null: boolean }>(
      "select abs(extract(epoch from now() - date_edited_at)) < 5 as date_near, total_edited_at is null as total_null from bill where id = $1",
      [id],
      A.id,
    );
    expect(t).toEqual({ date_near: true, total_null: true });
    const read = (await bill(id, A.id))!;
    expect(read.date_edited_at).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
    expect(read.total_edited_at).toBeNull();

    const typed = await save(A, [A, B], A, [[2401, [A, B]]], { typed: true, date_edited: true, total_edited: true });
    const [n] = await query<{ none: boolean }>("select date_edited_at is null and total_edited_at is null as none from bill where id = $1", [typed], A.id);
    expect(n.none).toBe(true);
    await clean();
  }, 120_000);
});
