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
});
