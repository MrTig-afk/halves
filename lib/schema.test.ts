// db/schema.sql has two parts: what may run while the live v2.3 code is still serving (phase A, the
// "expand"), and what only the new code survives (phase C: row-level security, narrow grants), below
// one marker. scripts/migrate.mjs --expand-only stops at the marker. These checks need no database.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MARKER = "-- ==== PHASE C: runs only after the new code is live ====";
const sql = readFileSync("db/schema.sql", "utf8");
const [expand, lock, ...extra] = sql.split(MARKER);

describe("db/schema.sql phases", () => {
  it("has the phase C marker exactly once", () => {
    expect(extra).toEqual([]);
    expect(lock).toBeTruthy();
  });

  it("keeps row-level security and policies out of the expand part", () => {
    expect(expand).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(expand).not.toMatch(/CREATE POLICY/i);
  });

  it("keeps every grant the v2.3 code needs in the expand part", () => {
    // v2.3: addPerson inserts role, resetPin and sign-in update person, sessions are written and
    // deleted, a subscription is upserted, settle and archive update bill and receipt_photo.
    expect(expand).toMatch(/GRANT SELECT, INSERT, UPDATE\s+ON person\s+TO halves_app/);
    expect(expand).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE\s+ON device_session\s+TO halves_app/);
    expect(expand).toMatch(/GRANT SELECT, INSERT, DELETE\s+ON push_subscription\s+TO halves_app/);
    expect(expand).toMatch(/GRANT UPDATE \(person_id, session_id, p256dh, auth\) ON push_subscription/);
    expect(expand).toMatch(/GRANT UPDATE \(settlement_id, photo_state\) ON bill\s+TO halves_app/);
    expect(expand).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE\s+ON receipt_photo\s+TO halves_app/);
  });

  it("creates what the new code needs in the expand part", () => {
    expect(expand).toMatch(/ALTER TABLE bill_person ADD COLUMN IF NOT EXISTS settled_at timestamptz/);
    expect(expand).toMatch(/CREATE TABLE IF NOT EXISTS bill_person/);
    expect(expand).toMatch(/CREATE OR REPLACE FUNCTION save_push/);
    expect(expand).toMatch(/GRANT UPDATE \(settlement_id, settled_at\) ON bill_person/);
  });

  it("enables row-level security on all eight tables, with narrow grants, after the marker", () => {
    for (const t of ["bill", "bill_person", "line_item", "line_item_person", "receipt_photo", "settlement", "scan_request", "push_subscription"]) {
      expect(lock, t).toMatch(new RegExp(`ALTER TABLE ${t}\\s+ENABLE ROW LEVEL SECURITY`));
    }
    expect(lock).not.toMatch(/GRANT[^;]*INSERT[^;]*ON person/); // tiles are added through admin_add_person
    expect(lock).toMatch(/GRANT UPDATE \(photo_state\)\s+ON bill\s/); // no settlement_id on a bill any more
    expect(lock).not.toMatch(/GRANT UPDATE \(settlement_id, photo_state\)/);
    expect(lock).not.toMatch(/GRANT[^;]*(INSERT|UPDATE)[^;]*ON push_subscription/); // subscriptions are written by save_push only
    expect(lock).not.toMatch(/CREATE POLICY push_subscription_(insert|update)/);
    expect(lock).toMatch(/GRANT SELECT, DELETE\s+ON push_subscription/);
  });
});
