// First-deploy seed: the admin tile (PIN from ADMIN_INITIAL_PIN, never claimable) and the
// partner's unclaimed tile. Idempotent - existing people are left alone.
// Run: npm run db:seed
import { neon } from "@neondatabase/serverless";
import { hashPin, isValidPin } from "../lib/pin.ts";

const { DATABASE_URL, ADMIN_NAME, ADMIN_EMAIL, ADMIN_INITIAL_PIN, PARTNER_NAME } = process.env;
const missing = Object.entries({ DATABASE_URL, ADMIN_NAME, ADMIN_INITIAL_PIN, PARTNER_NAME })
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) throw new Error(`missing: ${missing.join(", ")}`);
if (!isValidPin(ADMIN_INITIAL_PIN)) throw new Error("ADMIN_INITIAL_PIN must be exactly 4 digits");

const sql = neon(DATABASE_URL!);
const admin = await sql.query(
  `insert into person (name, role, email, pin_hash, claimed_at)
   select $1, 'admin', $2, $3, now() where not exists (select 1 from person where role = 'admin')
   returning id`,
  [ADMIN_NAME, ADMIN_EMAIL || null, await hashPin(ADMIN_INITIAL_PIN)],
);
const partner = await sql.query(
  "insert into person (name, role) values ($1, 'member') on conflict (name) do nothing returning id",
  [PARTNER_NAME],
);
console.log(`admin: ${admin.length ? "created" : "already present"}; partner tile: ${partner.length ? "created (unclaimed)" : "already present"}`);
