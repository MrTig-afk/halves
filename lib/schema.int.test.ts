// The shape of the database after the expand step, against the Neon dev branch (skipped without a
// DATABASE_URL; refuses any database without the dev_branch_marker table and any role but halves_app):
//   node --env-file=.env --env-file-if-exists=.env.local node_modules/vitest/vitest.mjs run lib/schema.int.test.ts
// Row-level security (S1) means the app role sees a bill only as someone on it, so the checks that look
// at "every bill" run as each person in turn (`everyone`) and add up what each of them can see.
// Bills saved by the two-person code after the migration ran have no bill_person rows until the
// migration runs again, so the shape checks look only at bills already in the new shape
// (added_by set), and the legacy checks only at bills whose settlement the copy still agrees with.
import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

describe.skipIf(!process.env.DATABASE_URL)("the database schema", async () => {
  const { query } = await import("./db");
  type P = { id: number; name: string };
  let A: P, B: P, admin: number;
  let everyoneIds: number[] = [];
  // The same read-only question asked as every person: the rows each can see, together.
  const everyone = async <T,>(sql: string, params: unknown[] = []) => (await Promise.all(everyoneIds.map((id) => query<T>(sql, params, id)))).flat();
  const total = (rows: Record<string, number>[]) =>
    rows.reduce((t, r) => Object.fromEntries(Object.keys(r).map((k) => [k, (t[k] ?? 0) + Number(r[k])])), {} as Record<string, number>);

  const person = async (name: string): Promise<P> => {
    const [a] = await query<{ id: number }>("select id::int as id from person where role = 'admin' limit 1");
    await query("select admin_add_person($1)", [name], a.id); // the app role may not insert a tile itself; null when it exists
    return (await query<P>("select id::int as id, name from person where name = $1", [name]))[0];
  };
  const session = async (p: P) =>
    (await query<{ id: string }>("insert into device_session (person_id, pin_stamp) select id, pin_stamp from person where id = $1 returning id", [p.id]))[0].id;
  // The owner role, for what only a migration-time actor may do (simulating the pre-lock v2.3 code).
  const asOwner = async (sql: string, params: unknown[]) => {
    const { neon } = await import("@neondatabase/serverless");
    const [m] = await query<{ dev: boolean }>("select to_regclass('public.dev_branch_marker') is not null as dev");
    if (!m.dev || !process.env.MIGRATION_DATABASE_URL) throw new Error("Refusing: not the dev branch, or no owner URL.");
    await neon(process.env.MIGRATION_DATABASE_URL).query(sql, params);
  };
  const denied = async (sql: string, params: unknown[], message: RegExp, as?: number) => {
    const err = await query(sql, params, as).then(() => null, (e: Error) => e);
    expect(err?.message).toMatch(message);
  };
  const FUNCTIONS = ["app_person", "is_member", "is_adder", "round_fits", "line_bill", "admin_add_person", "admin_reset_pin", "push_targets", "drop_push", "save_push"];

  beforeAll(async () => {
    const [marker] = await query<{ dev: boolean; role: string }>(
      "select to_regclass('public.dev_branch_marker') is not null as dev, current_user as role",
    );
    if (!marker.dev) throw new Error("Refusing to run: this is not the dev branch (no dev_branch_marker table).");
    if (marker.role !== "halves_app") throw new Error(`Refusing to run as ${marker.role}: connect as halves_app.`);
    [A, B] = [await person("Test Schema A"), await person("Test Schema B")];
    const [a] = await query<{ id: number }>("select id::int as id from person where role = 'admin' limit 1");
    if (!a) throw new Error("No admin tile on the dev branch.");
    admin = a.id;
    everyoneIds = (await query<{ id: number }>("select id::int as id from person")).map((r) => r.id);
  }, 60_000);

  it("keeps every bill's payer on it, owing nothing and never settled", async () => {
    const r = total(await everyone<{ missing: number; wrong: number }>(
      `select count(*) filter (where bp.bill_id is null)::int as missing,
              count(*) filter (where bp.bill_id is not null and (bp.owes_cents <> 0 or bp.settlement_id is not null))::int as wrong
       from bill b left join bill_person bp on bp.bill_id = b.id and bp.person_id = b.payer_id
       where b.added_by is not null`,
    ));
    expect(r).toEqual({ missing: 0, wrong: 0 });
  });

  it("keeps every bill at 2 to 5 people, its adder among them", async () => {
    const r = total(await everyone<{ bad: number; no_adder: number }>(
      `select count(*) filter (where n < 2 or n > 5)::int as bad,
              count(*) filter (where not adder_in)::int as no_adder
       from (select b.id, (select count(*) from bill_person bp where bp.bill_id = b.id) as n,
                    exists (select 1 from bill_person bp where bp.bill_id = b.id and bp.person_id = b.added_by) as adder_in
             from bill b where b.added_by is not null) x`,
    ));
    expect(r).toEqual({ bad: 0, no_adder: 0 });
  });

  it("gives every item someone who had it, on its bill, and discounts and surcharges nobody", async () => {
    const r = total(await everyone<{ items_without: number; foreign_person: number; others_with: number }>(
      `select count(*) filter (where li.kind = 'item' and lp.n = 0)::int as items_without,
              count(*) filter (where lp.foreign_n > 0)::int as foreign_person,
              count(*) filter (where li.kind <> 'item' and lp.n > 0)::int as others_with
       from line_item li join bill b on b.id = li.bill_id
       cross join lateral (
         select count(*) as n,
                count(*) filter (where not exists (select 1 from bill_person bp where bp.bill_id = li.bill_id and bp.person_id = lip.person_id)) as foreign_n
         from line_item_person lip where lip.line_item_id = li.id) lp
       where b.added_by is not null`,
    ));
    expect(r).toEqual({ items_without: 0, foreign_person: 0, others_with: 0 });
  });

  // TEMPORARY (deleted with the old columns): the copy of pre-multi-person bills.
  const legacy = `b.partner_id is not null and exists (select 1 from bill_person x where x.bill_id = b.id)
    and (select settlement_id from bill_person x where x.bill_id = b.id and x.person_id = b.partner_id) is not distinct from b.settlement_id`;

  it("carries a legacy bill's partner amount and shares over", async () => {
    expect(total(await everyone<{ n: number }>(`select count(*)::int as n from bill b where ${legacy}`)).n).toBeGreaterThan(0);
    const all = await everyone<{ amount: number; shares: number }>(
      `select count(*) filter (where bp.owes_cents is distinct from b.partner_owes_cents)::int as amount,
              (select count(*) from line_item li join line_item_person z on z.line_item_id = li.id
               where li.bill_id = b.id and li.kind = 'item' and (
                 (li.share = 'payer' and z.person_id <> b.payer_id) or (li.share = 'partner' and z.person_id <> b.partner_id)))::int as shares
       from bill b join bill_person bp on bp.bill_id = b.id and bp.person_id = b.partner_id
       where ${legacy}
       group by b.id`,
    );
    expect(all.filter((x) => x.amount || x.shares)).toEqual([]);
    const split = total(
      await everyone<{ bad: number }>(
        `select count(*) filter (where (select count(*) from line_item_person z where z.line_item_id = li.id) <> 2)::int as bad
         from line_item li join bill b on b.id = li.bill_id where li.kind = 'item' and li.share = 'split' and ${legacy}`,
      ),
    );
    expect(split.bad).toBe(0);
  });

  // TEMPORARY (deleted with the old columns): a settle the old code makes after the copy reaches the
  // share on the next migration, run again before the new code goes live. Runs the migration twice, on dev only.
  it("carries a settle the old code made after the copy over on the next migration", async () => {
    const migrate = () => expect(execFileSync(process.execPath, ["scripts/migrate.mjs"], { encoding: "utf8" })).toMatch(/target: dev/);
    const [b] = await query<{ id: number }>(
      `insert into bill (payer_id, partner_id, added_by, description, bill_date, total_cents, partner_owes_cents)
       values ($1, $2, $1, 'Test Schema carry-over', current_date, 1000, 500) returning id::int as id`,
      [A.id, B.id],
      A.id,
    );
    const share = async () =>
      (await query<{ s: number | null }>("select settlement_id::int as s from bill_person where bill_id = $1 and person_id = $2", [b.id, B.id], A.id))[0]?.s;
    migrate();
    expect(await share()).toBeNull();
    const [lo, hi] = [A.id, B.id].sort((x, y) => x - y);
    const [s] = await query<{ id: number }>(
      `insert into settlement (person_low_id, person_high_id, amount_cents, from_person_id, to_person_id, settled_by)
       values ($1, $2, 500, $3, $4, $4) returning id::int as id`,
      [lo, hi, B.id, A.id],
      A.id,
    );
    // What the v2.3 code did (it settles through bill.settlement_id, which the narrow grants no longer
    // allow the app role): done as the owner role, the one that runs migrations.
    await asOwner("update bill set settlement_id = $1 where id = $2", [s.id, b.id]);
    migrate();
    expect(await share()).toBe(s.id);
    expect((await query<{ at: string | null }>("select settled_at::text as at from bill_person where bill_id = $1 and person_id = $2", [b.id, B.id], A.id))[0].at).not.toBeNull();
  }, 120_000);

  // TEMPORARY (deleted with the old columns): a legacy $0.00 share gets its settle time with no round
  // (the trigger lets it); a legacy share that owes something does not.
  it("backfills a legacy $0.00 share's settle time without a round, and an open share's never", async () => {
    const legacyBill = async (owes: number) =>
      (await query<{ id: number }>(
        `insert into bill (payer_id, partner_id, added_by, description, bill_date, total_cents, partner_owes_cents)
         values ($1, $2, $1, 'Test Schema zero share', current_date, 1000, $3) returning id::int as id`,
        [A.id, B.id, owes],
        A.id,
      ))[0].id;
    const [zero, owing] = [await legacyBill(0), await legacyBill(500)];
    const out = () => execFileSync(process.execPath, ["scripts/migrate.mjs"], { encoding: "utf8" });
    expect(out()).toMatch(/schema applied/);
    expect(out()).toMatch(/schema applied/); // a second run changes nothing and does not fail
    const at = async (b: number) =>
      (await query<{ at: string | null; s: number | null }>("select settled_at::text as at, settlement_id::int as s from bill_person where bill_id = $1 and person_id = $2", [b, B.id], A.id))[0];
    expect((await at(zero)).at).not.toBeNull();
    expect((await at(zero)).s).toBeNull();
    expect(await at(owing)).toEqual({ at: null, s: null });
  }, 120_000);

  // TEMPORARY (deleted with the old columns): the balance, either way round, is unchanged.
  it("gives every pair the same open balance from bill_person as from the old columns", async () => {
    const { diff } = total(await everyone<{ diff: number }>(
      `with old as (
         select b.payer_id as x, b.partner_id as y, sum(b.partner_owes_cents) as c from bill b
         where ${legacy} and b.settlement_id is null group by 1, 2),
       new as (
         select b.payer_id as x, bp.person_id as y, sum(bp.owes_cents) as c from bill b
         join bill_person bp on bp.bill_id = b.id and bp.person_id <> b.payer_id
         where ${legacy} and bp.settlement_id is null and bp.owes_cents > 0 group by 1, 2)
       select count(*)::int as diff from old full join new on old.x = new.x and old.y = new.y
       where coalesce(old.c, 0) <> coalesce(new.c, 0)`,
    ));
    expect(diff).toBe(0);
  });

  it("refuses the app role what a share may never do", async () => {
    // A settled share, seen by the person whose share it is (the one who could try to undo it).
    const [s] = await everyone<{ bill_id: number; person_id: number }>(
      "select bill_id::int, person_id::int from bill_person where settlement_id is not null and person_id = app_person() limit 1",
    );
    expect(s, "dev needs a settled share").toBeDefined();
    const as = s.person_id;
    await denied("update bill_person set owes_cents = owes_cents + 1 where bill_id = $1 and person_id = $2", [s.bill_id, s.person_id], /permission denied/, as);
    await denied("update bill_person set settlement_id = null where bill_id = $1 and person_id = $2", [s.bill_id, s.person_id], /already settled/, as);
    await denied("update bill_person set settled_at = now() where bill_id = $1 and person_id = $2 and settled_at is not null", [s.bill_id, s.person_id], /already settled/, as);
    await denied("delete from bill_person where bill_id = $1 and person_id = $2", [s.bill_id, s.person_id], /permission denied/, as);
    await denied("delete from line_item_person where person_id = $1", [s.person_id], /permission denied/, as);
  });

  it("tells the database who the app is acting for, and keeps the error codes", async () => {
    expect((await query<{ p: number }>("select app_person()::int as p", [], A.id))[0].p).toBe(A.id);
    expect((await query<{ p: number | null }>("select app_person()::int as p"))[0].p).toBeNull();
    const id = crypto.randomUUID();
    await query("insert into scan_request (scan_id, person_id) values ($1, $2)", [id, A.id], A.id);
    const err = await query("insert into scan_request (scan_id, person_id) values ($1, $2)", [id, A.id], A.id).then(() => null, (e) => e as { code?: string; constraint?: string });
    expect(err).toMatchObject({ code: "23505", constraint: "scan_request_pkey" });
  });

  it("defines every person function as SECURITY DEFINER with a pinned search_path, owned by someone else", async () => {
    const rows = await query<{ proname: string; prosecdef: boolean; owner: string; pinned: boolean; public_runs: boolean }>(
      `select p.proname, p.prosecdef, r.rolname as owner, coalesce(p.proconfig @> array['search_path=public, pg_temp'], false) as pinned,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_runs
       from pg_proc p join pg_roles r on r.oid = p.proowner
       where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`,
      [FUNCTIONS],
    );
    expect(rows.map((r) => r.proname).sort()).toEqual([...FUNCTIONS].sort());
    for (const r of rows) expect(r, r.proname).toMatchObject({ prosecdef: true, pinned: true, public_runs: false });
    expect(rows.filter((r) => r.owner === "halves_app")).toEqual([]);
    expect((await query<{ c: boolean }>("select has_schema_privilege('halves_app', 'public', 'CREATE') as c"))[0].c).toBe(false);
  });

  it("lets only the admin add a tile", async () => {
    const name = "Test Schema Added";
    const asMember = (await query<{ id: number | null }>("select admin_add_person('Test Schema Nobody')::int as id", [], A.id))[0].id;
    expect(asMember).toBeNull();
    expect(await query("select 1 from person where name = 'Test Schema Nobody'")).toHaveLength(0);
    const first = (await query<{ id: number | null }>("select admin_add_person($1)::int as id", [name], admin))[0].id;
    const [row] = await query<{ id: number; role: string }>("select id::int as id, role from person where name = $1", [name]);
    expect(row.role).toBe("member");
    if (first !== null) expect(first).toBe(row.id);
    expect((await query<{ id: number | null }>("select admin_add_person($1)::int as id", [name], admin))[0].id).toBeNull();
  });

  it("lets only the admin reset a member's PIN, never the admin's", async () => {
    await query("update person set pin_hash = 'x', claimed_at = now() where id = $1", [B.id]);
    const stamp = (await query<{ s: string }>("select pin_stamp::text as s from person where id = $1", [B.id]))[0].s;
    await session(B);
    const reset = async (as: number, who: number) => (await query<{ r: boolean }>("select admin_reset_pin($1) as r", [who], as))[0].r;
    expect(await reset(A.id, B.id)).toBe(false);
    const [kept] = await query<{ pin_hash: string | null; s: string; n: number }>(
      "select pin_hash, pin_stamp::text as s, (select count(*)::int from device_session where person_id = $1) as n from person where id = $1",
      [B.id],
    );
    expect(kept).toMatchObject({ pin_hash: "x", s: stamp });
    expect(kept.n).toBeGreaterThan(0);
    expect(await reset(admin, B.id)).toBe(true);
    const [after] = await query<{ pin_hash: string | null; n: number }>(
      "select pin_hash, (select count(*)::int from device_session where person_id = $1) as n from person where id = $1",
      [B.id],
    );
    expect(after).toEqual({ pin_hash: null, n: 0 });
    expect(await reset(admin, admin)).toBe(false);
  });

  it("lists a phone that still signs someone in, and forgets a dead one", async () => {
    const s = await session(B);
    const endpoint = `https://push.invalid/${crypto.randomUUID()}`;
    await query("select save_push($1::uuid, $2, 'k', 'a')", [s, endpoint], B.id); // the app role writes subscriptions only through the function
    const [{ id }] = await query<{ id: number }>("select id::int as id from push_subscription where endpoint = $1", [endpoint], B.id);
    const listed = async () => (await query<{ id: number }>("select id::int as id from push_targets($1)", [B.id])).map((r) => r.id);
    expect(await listed()).toContain(id);
    await query("update person set pin_stamp = gen_random_uuid() where id = $1", [B.id]);
    expect(await listed()).not.toContain(id);
    await query("select drop_push($1)", [id]);
    expect(await query("select 1 from push_subscription where id = $1", [id], B.id)).toHaveLength(0);
  });

  it("saves a phone's subscription for its own session only, taking over a held endpoint", async () => {
    const [sa, sb] = [await session(A), await session(B)];
    const endpoint = `https://push.invalid/${crypto.randomUUID()}`;
    const save = async (as: number, sess: string) =>
      (await query<{ ok: boolean }>("select save_push($1, $2, 'k', 'a') as ok", [sess, endpoint], as))[0].ok;
    // Whose row it is, asked as every person: only the holder's own view returns it.
    const owner = async () =>
      (await everyone<{ p: number; s: string }>("select person_id::int as p, session_id::text as s from push_subscription where endpoint = $1", [endpoint]))[0];
    expect(await save(A.id, sa)).toBe(true);
    expect(await owner()).toEqual({ p: A.id, s: sa });
    expect(await save(B.id, sb)).toBe(true);
    expect(await owner()).toEqual({ p: B.id, s: sb });
    expect(await save(B.id, sa)).toBe(false);
    expect(await owner()).toEqual({ p: B.id, s: sb });
    await query("delete from device_session where person_id = any($1)", [[A.id, B.id]]); // cascades the subscriptions
  });

  it("stores the edit times as nullable timestamps with no default, never on a typed bill", async () => {
    const cols = await query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      "select column_name, data_type, is_nullable, column_default from information_schema.columns where table_name = 'bill' and column_name in ('date_edited_at', 'total_edited_at') order by 1",
    );
    expect(cols).toEqual([
      { column_name: "date_edited_at", data_type: "timestamp with time zone", is_nullable: "YES", column_default: null },
      { column_name: "total_edited_at", data_type: "timestamp with time zone", is_nullable: "YES", column_default: null },
    ]);
    expect(total(await everyone<{ n: number }>("select count(*)::int as n from bill where typed and (date_edited_at is not null or total_edited_at is not null)")).n).toBe(0);
  });

  it("keeps the PIN throttle writable but never deletable by the app role, and without row security", async () => {
    expect((await query<{ rls: boolean }>("select relrowsecurity as rls from pg_class where oid = 'public.pin_throttle'::regclass"))[0].rls).toBe(false);
    const key = `d:test-${crypto.randomUUID()}`;
    await query("insert into pin_throttle (client, wrong) values ($1, array[now()])", [key]);
    await query("update pin_throttle set wrong = wrong || now() where client = $1", [key]);
    expect((await query<{ n: number }>("select cardinality(wrong)::int as n from pin_throttle where client = $1", [key]))[0].n).toBe(2);
    await denied("delete from pin_throttle where client = $1", [key], /permission denied/);
  });
});
