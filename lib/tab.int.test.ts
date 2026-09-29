// Against a real database (the Neon dev branch), because isolation and settling are properties
// of the SQL, not of any one function. Skipped when no DATABASE_URL is loaded (CI has none):
//   node --env-file=.env --env-file-if-exists=.env.local node_modules/vitest/vitest.mjs run lib/tab.int.test.ts
// Uses three fixed test people (created once, reused), so repeated runs do not add people.
// It refuses any database without the dev-only `dev_branch_marker` table: test people and bills
// can never be deleted, so they must never reach the real database.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Person } from "./session";

const who = vi.hoisted(() => ({ current: null as Person | null }));
vi.mock("@/lib/session", () => ({ currentPerson: async () => who.current }));

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
  let A: Person, B: Person, C: Person;

  const person = async (name: string): Promise<Person> => {
    await query("insert into person (name, role) values ($1, 'member') on conflict (name) do nothing", [name]);
    const [p] = await query<Person>("select id::int as id, name, role from person where name = $1", [name]);
    return p;
  };
  // Saves through the real route as `payer`: one item of `cents`, `share` for the partner.
  const receipt = readFileSync("fixtures/public/coles.jpg");
  const save = async (payer: Person, partner: Person, cents: number, share: "split" | "partner", photo = false) => {
    who.current = payer;
    const form = new FormData();
    if (photo) form.append("photo", new Blob([new Uint8Array(receipt)], { type: "image/jpeg" }), "r.jpg");
    form.append(
      "bill",
      JSON.stringify({
        scan_id: crypto.randomUUID(),
        partner_id: partner.id,
        description: "Isolation test",
        date: "2026-09-29",
        total_cents: null,
        lines: [{ name: "Thing", price_cents: cents, kind: "item", share }],
        ai: null,
      }),
    );
    const res = await saveBill(new Request("http://x/api/bill", { method: "POST", body: form }));
    expect(res.status).toBe(200);
    const [row] = await query<{ id: number }>("select id::int from bill where payer_id = $1 order by id desc limit 1", [payer.id]);
    return row.id;
  };
  const balance = async (me: Person, other: Person) => (await tabs(me.id)).find((t) => t.partner_id === other.id)!.balance;

  const settle = async (x: Person, y: Person) => settleAll(x.id, y.id, await balance(x, y));

  beforeAll(async () => {
    const [marker] = await query<{ dev: boolean; role: string }>(
      "select to_regclass('public.dev_branch_marker') is not null as dev, current_user as role",
    );
    if (!marker.dev) throw new Error("Refusing to run: this is not the dev branch (no dev_branch_marker table).");
    // The immutability checks really try an UPDATE and a DELETE; only the app role is refused them.
    if (marker.role !== "halves_app") throw new Error(`Refusing to run as ${marker.role}: connect as halves_app.`);
    [A, B, C] = [await person("Test Iso A"), await person("Test Iso B"), await person("Test Iso C")];
    for (const [x, y] of [[A, B], [A, C], [B, C]]) await settle(x, y); // start from a clean tab
  }, 60_000);

  it("adds bills from both sides into one balance, mirrored for the other person", async () => {
    await save(A, B, 2000, "split"); // B owes A 10.00
    await save(B, A, 400, "partner"); // A owes B 4.00
    expect(await balance(A, B)).toBe(600);
    expect(await balance(B, A)).toBe(-600);
  }, 60_000);

  it("never shows A and B's bills, rounds or photos to C", async () => {
    const id = await save(A, B, 1000, "split", true);
    expect((await openBills(C.id)).some((b) => b.payer_id === A.id && b.partner_id === B.id)).toBe(false);
    expect(await bill(id, C.id)).toBeNull();
    expect(await bill(id, A.id)).not.toBeNull();
    expect(await bill(id, B.id)).not.toBeNull();
    expect(await balance(C, A)).toBe(0);
    const photoAs = async (p: Person) => {
      who.current = p;
      return (await photo(new Request("http://x"), { params: Promise.resolve({ id: String(id) }) })).status;
    };
    expect([await photoAs(A), await photoAs(B), await photoAs(C)]).toEqual([200, 200, 404]);
    expect([await is404(billPageAs(A, id)), await is404(billPageAs(B, id)), await is404(billPageAs(C, id))]).toEqual([false, false, true]);
  }, 60_000);

  it("settles exactly the open balance once, even when both press at the same moment", async () => {
    const before = await balance(A, B); // 600 + 500 from the tests above
    const [one, two] = await Promise.all([settleAll(A.id, B.id, before), settleAll(B.id, A.id, -before)]);
    const won = [one, two].filter((r) => r.id !== null);
    expect(won).toHaveLength(1);
    expect(won[0].amount_cents).toBe(Math.abs(before));
    expect(await balance(A, B)).toBe(0);
    expect((await openBills(A.id)).some((b) => b.partner_id === B.id || b.payer_id === B.id)).toBe(false);
    const [s] = await query<{ from: number; to: number; amount: number }>(
      "select from_person_id::int as from, to_person_id::int as to, amount_cents as amount from settlement where id = $1",
      [won[0].id],
    );
    expect(s).toEqual({ from: B.id, to: A.id, amount: before });
    // The round is A and B's alone.
    expect(await round(won[0].id!, A.id)).not.toBeNull();
    expect(await round(won[0].id!, C.id)).toBeNull();
    expect([await is404(roundPageAs(A, won[0].id!)), await is404(roundPageAs(C, won[0].id!))]).toEqual([false, true]);
    expect((await rounds(C.id)).some((r) => r.id === won[0].id)).toBe(false);
  }, 60_000);

  it("settles nothing when the balance is not the one confirmed", async () => {
    await save(A, B, 800, "split"); // B owes A 4.00
    const r = await settleAll(A.id, B.id, 300);
    expect(r).toMatchObject({ id: null, balance: 400 });
    expect(await balance(A, B)).toBe(400);
  }, 60_000);

  it("never loses a bill saved at the same moment as a settle: it is either in the round or still open", async () => {
    const confirmed = await balance(A, B);
    const [, r] = await Promise.all([save(B, A, 600, "partner"), settleAll(A.id, B.id, confirmed)]);
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
  }, 60_000);

  it("leaves settled bills unchangeable by the app's role, including un-settling them", async () => {
    await expect(query("update bill set partner_owes_cents = 0 where payer_id = $1", [A.id])).rejects.toThrow(/permission denied/);
    await expect(query("update bill set settlement_id = null where payer_id = $1 and settlement_id is not null", [A.id])).rejects.toThrow(/already settled/);
    await expect(query("delete from bill where payer_id = $1", [A.id])).rejects.toThrow(/permission denied/);
  }, 60_000);
});
