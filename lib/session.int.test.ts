// Against the Neon dev branch, like lib/tab.int.test.ts (skipped without a DATABASE_URL; refuses a
// database without the dev_branch_marker table). The sign-in race: a PIN is checked, the PIN
// changes, and only then is the session written. Through the real checkPin -> startSession path,
// that session must never sign anyone in - after an admin reset, a reset and a new claim, or a
// Change PIN on another phone.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ value: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (jar.value ? { value: jar.value } : undefined), set: (_: string, v: string) => (jar.value = v) }),
}));

describe.skipIf(!process.env.DATABASE_URL)("sessions and PIN changes on a real database", async () => {
  const { query } = await import("./db");
  const { checkPin, claimTile } = await import("./auth");
  const { resetPin } = await import("./people");
  const { currentPerson, startSession } = await import("./session");
  const { POST: changePin } = await import("@/app/api/auth/change-pin/route");
  let tile: number;
  let admin: number; // the PIN reset is the admin's, through a database function

  // One phone's sign-in with a PIN that has been checked already (the stamp read with it).
  const signIn = async (stamp: string) => {
    jar.value = "";
    await startSession(tile, stamp);
    return jar.value;
  };
  // The late sign-in: no session row is written for it, and the device stays signed out.
  const refused = async (stamp: string) => {
    const [{ n }] = await query<{ n: number }>("select count(*)::int as n from device_session where person_id = $1", [tile]);
    jar.value = "";
    expect(await startSession(tile, stamp)).toBe(false);
    expect(jar.value).toBe("");
    expect((await query<{ n: number }>("select count(*)::int as n from device_session where person_id = $1", [tile]))[0].n).toBe(n);
  };
  const who = async (phone: string) => {
    jar.value = phone;
    return (await currentPerson())?.id ?? null;
  };
  const checked = async (pin: string) => {
    const r = await checkPin(tile, pin);
    if (!r.ok) throw new Error(`PIN check failed: ${r.error}`);
    return r.stamp;
  };
  const claimed = async (pin: string) => {
    const r = await claimTile(tile, pin);
    if (!r.ok) throw new Error(`claim failed: ${r.error}`);
    return r.stamp;
  };

  beforeAll(async () => {
    const [marker] = await query<{ dev: boolean }>("select to_regclass('public.dev_branch_marker') is not null as dev");
    if (!marker.dev) throw new Error("Refusing to run: this is not the dev branch (no dev_branch_marker table).");
    [{ id: admin }] = await query<{ id: number }>("select id::int from person where role = 'admin' limit 1");
    await query("select admin_add_person('Test Race')", [], admin); // the app role may not insert a tile itself
    [{ id: tile }] = await query<{ id: number }>("select id::int from person where name = 'Test Race'");
  }, 60_000);
  beforeEach(async () => {
    await resetPin(admin, tile); // unclaimed, no sessions
  }, 60_000);

  it("an admin reset between the PIN check and the session", async () => {
    await claimed("4321");
    const stale = await checked("4321");
    await resetPin(admin, tile);
    await refused(stale);
  }, 60_000);

  it("a reset and a new claim between the PIN check and the session", async () => {
    await claimed("4321");
    const stale = await checked("4321");
    await resetPin(admin, tile);
    const fresh = await claimed("8765"); // someone else takes the tile
    await refused(stale);
    expect(await who(await signIn(fresh))).toBe(tile); // the new owner's own sign-in works
  }, 60_000);

  it("a Change PIN on another phone between the PIN check and the session", async () => {
    const phone1 = await signIn(await claimed("4321"));
    const stale = await checked("4321"); // phone 2 checks the old PIN
    jar.value = phone1;
    const res = await changePin(new Request("http://x/api/auth/change-pin", { method: "POST", body: JSON.stringify({ current: "4321", next: "2468" }) }));
    expect(res.status).toBe(200);
    await refused(stale); // phone 2's late sign-in
    expect(await who(phone1)).toBe(tile); // the phone that changed it stays signed in
    expect(await who(await signIn(await checked("2468")))).toBe(tile); // the new PIN signs in
  }, 60_000);

  it("refuses a session whose PIN changed after it was written (the read-side check)", async () => {
    const phone = await signIn(await claimed("4321"));
    expect(await who(phone)).toBe(tile);
    await query("update person set pin_stamp = gen_random_uuid() where id = $1", [tile]); // any PIN change
    expect(await who(phone)).toBeNull();
  }, 60_000);

  describe("PIN limit per phone", () => {
    const PIN = "1357";
    const WRONG = "0000";
    let tiles: number[]; // five test tiles; tests 1-4 and 6-7 use the first four
    const key = () => `d:test-${crypto.randomUUID()}`;
    const reset = (id: number) => query("update person set failed_pin_count = 0, locked_until = null where id = $1", [id]);
    const count = async (k: string) => (await query<{ n: number }>("select cardinality(wrong)::int as n from pin_throttle where client = $1", [k]))[0]?.n;
    const tries = async (id: number) => (await query<{ n: number }>("select failed_pin_count::int as n from person where id = $1", [id]))[0].n;
    // A wrong PIN on a tile whose own counter was just reset, so only the phone limit can stop it.
    const wrong = async (k: string, i: number) => {
      await reset(tiles[i]);
      return checkPin(tiles[i], WRONG, k);
    };

    beforeAll(async () => {
      tiles = [];
      for (let i = 1; i <= 5; i++) {
        const name = `Test Phone ${i}`;
        let [t] = await query<{ id: number }>("select id::int from person where name = $1", [name]);
        if (!t) {
          await query("select admin_add_person($1)", [name], admin);
          [t] = await query<{ id: number }>("select id::int from person where name = $1", [name]);
        }
        await resetPin(admin, t.id);
        await claimTile(t.id, PIN);
        tiles.push(t.id);
      }
    }, 120_000);
    beforeEach(async () => {
      for (const t of tiles) await reset(t);
    }, 60_000);

    it("the 10th wrong PIN pauses the phone, even for the right PIN", async () => {
      const k = key();
      for (let i = 0; i < 9; i++) {
        const r = await wrong(k, i % 4);
        expect(!r.ok && ["wrong_pin", "locked"].includes(r.error)).toBe(true);
      }
      const [{ first }] = await query<{ first: string }>("select min(x)::text as first from pin_throttle, unnest(wrong) x where client = $1", [k]);
      const tenth = await wrong(k, 0);
      expect(tenth.ok === false && tenth.error === "slow_down").toBe(true);
      const until = Date.parse((tenth as { until: string }).until);
      expect(Math.abs(until - (Date.parse(first) + 15 * 60_000))).toBeLessThan(5000);
      await reset(tiles[3]);
      const right = await checkPin(tiles[3], PIN, k);
      expect(right.ok === false && right.error === "slow_down").toBe(true);
      expect(await tries(tiles[3])).toBe(0);
    }, 120_000);

    it("another phone is not affected", async () => {
      const k = key();
      for (let i = 0; i < 10; i++) await wrong(k, i % 4);
      expect((await checkPin(tiles[0], PIN, key())).ok).toBe(true);
    }, 120_000);

    it("a right PIN gives its try back", async () => {
      const k = key();
      for (let i = 0; i < 9; i++) await wrong(k, i % 4);
      await reset(tiles[0]);
      expect((await checkPin(tiles[0], PIN, k)).ok).toBe(true);
      expect(await count(k)).toBe(9);
      const r = await wrong(k, 1);
      expect(r.ok === false && r.error === "slow_down").toBe(true);
    }, 120_000);

    it("an invalid PIN, an unknown tile, an unclaimed tile and an already-locked tile use no try", async () => {
      const k = key();
      expect((await checkPin(tiles[0], "12", k)).ok).toBe(false);
      expect(await count(k)).toBe(0);
      expect(await checkPin(999_999_999, PIN, k)).toEqual({ ok: false, error: "not_found" });
      expect(await count(k)).toBe(0);
      await resetPin(admin, tiles[3]);
      expect(await checkPin(tiles[3], PIN, k)).toEqual({ ok: false, error: "unclaimed" });
      expect(await count(k)).toBe(0);
      await claimTile(tiles[3], PIN);
      await query("update person set failed_pin_count = 3, locked_until = now() + interval '5 minutes' where id = $1", [tiles[1]]);
      const r = await checkPin(tiles[1], PIN, k);
      expect(r.ok === false && r.error === "locked").toBe(true);
      expect(await count(k)).toBe(0);
    }, 120_000);

    it("15 wrong tries in parallel leave exactly 10 moments", async () => {
      const k = key();
      const rs = await Promise.all(Array.from({ length: 15 }, (_, i) => checkPin(tiles[i % 5], WRONG, k))); // 3 per tile: none locks before its check
      expect(await count(k)).toBe(10);
      expect(rs.filter((r) => !r.ok && r.error === "slow_down").length).toBeGreaterThanOrEqual(5);
    }, 120_000);

    it("the window slides: a try older than 15 minutes frees one", async () => {
      const k = key();
      for (let i = 0; i < 10; i++) await wrong(k, i % 4);
      await query("update pin_throttle set wrong[1] = now() - interval '16 minutes' where client = $1", [k]);
      await reset(tiles[0]);
      expect((await checkPin(tiles[0], PIN, k)).ok).toBe(true); // reached the PIN check
      const next = await wrong(k, 1); // the 10th inside the window
      expect(next.ok === false && next.error === "slow_down").toBe(true);
      await reset(tiles[2]);
      expect(await tries(tiles[2])).toBe(0);
      const refused = await checkPin(tiles[2], PIN, k); // paused again: no PIN check
      expect(refused.ok === false && refused.error === "slow_down").toBe(true);
      expect(await tries(tiles[2])).toBe(0);
    }, 120_000);

    it("an ip: key keeps its try on a right PIN and an invalid PIN", async () => {
      const k = `ip:test-${crypto.randomUUID()}`;
      expect((await checkPin(tiles[0], PIN, k)).ok).toBe(true);
      expect(await count(k)).toBe(1);
      expect((await checkPin(tiles[0], "12", k)).ok).toBe(false);
      expect(await count(k)).toBe(2);
    }, 60_000);
  });
});
