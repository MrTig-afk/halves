// Applies db/schema.sql (idempotent) using the owner role. Run: npm run db:migrate
// A checkout without .env.local points at the real database, so the target is probed first and
// the real one is refused unless --main is passed: npm run db:migrate -- --main
import { readFileSync } from "node:fs";
import { Pool } from "@neondatabase/serverless";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error("MIGRATION_DATABASE_URL is not set");
  process.exit(1);
}
const pool = new Pool({ connectionString: url });
try {
  const { rows } = await pool.query("select to_regclass('public.dev_branch_marker') is not null as dev");
  console.log(`target: ${rows[0].dev ? "dev" : "MAIN"}`);
  if (!rows[0].dev && !process.argv.includes("--main")) {
    console.error("Refusing to migrate MAIN without --main (needs the owner's go).");
    process.exitCode = 1;
  } else {
    await pool.query(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
    console.log("schema applied");
  }
} finally {
  await pool.end();
}
