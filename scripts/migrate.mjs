// Applies db/schema.sql (idempotent) using the owner role. Run: npm run db:migrate
// A checkout without .env.local points at the real database, so the target is probed first and
// the real one is refused unless --main is passed: npm run db:migrate -- --main
// --expand-only applies only the text above the PHASE C marker: what the live v2.3 code can run
// beside (new tables, columns, functions, broad grants), never row-level security or narrow grants.
import { readFileSync } from "node:fs";
import { Pool } from "@neondatabase/serverless";

const MARKER = "-- ==== PHASE C: runs only after the new code is live ====";
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error("MIGRATION_DATABASE_URL is not set");
  process.exit(1);
}
let sql = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
if (process.argv.includes("--expand-only")) {
  const parts = sql.split(MARKER);
  if (parts.length !== 2) {
    console.error("db/schema.sql must contain the PHASE C marker exactly once.");
    process.exit(1);
  }
  sql = parts[0];
}
const pool = new Pool({ connectionString: url });
try {
  const { rows } = await pool.query("select to_regclass('public.dev_branch_marker') is not null as dev");
  console.log(`target: ${rows[0].dev ? "dev" : "MAIN"}`);
  if (!rows[0].dev && !process.argv.includes("--main")) {
    console.error("Refusing to migrate MAIN without --main (needs the owner's go).");
    process.exitCode = 1;
  } else if (process.argv.includes("--expand-only") && (await pool.query("select coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.bill')), false) as locked")).rows[0].locked) {
    // Phase C is already applied: the expand grants are broad and would re-widen it.
    console.error("Refusing --expand-only: row-level security is already on (phase C is applied). Run the full migration instead.");
    process.exitCode = 1;
  } else {
    await pool.query(sql);
    console.log(process.argv.includes("--expand-only") ? "schema applied (expand only)" : "schema applied");
  }
} finally {
  await pool.end();
}
