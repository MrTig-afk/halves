// Applies db/schema.sql (idempotent) using the owner role. Run: npm run db:migrate
import { readFileSync } from "node:fs";
import { Pool } from "@neondatabase/serverless";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error("MIGRATION_DATABASE_URL is not set");
  process.exit(1);
}
const pool = new Pool({ connectionString: url });
try {
  await pool.query(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
  console.log("schema applied");
} finally {
  await pool.end();
}
