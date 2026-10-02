import { neon } from "@neondatabase/serverless";

// Server-only (never imported by a "use client" file). One-shot parameterised queries over
// HTTP: always placeholders ($1, $2...) with params, never string-built SQL.
let client: ReturnType<typeof neon> | undefined;

// With a personId the query runs in one two-statement transaction that first tells the database
// who the app is acting for (app.person_id, which lasts only for that transaction), still in one
// round trip. Without it, one plain query.
export async function query<T = Record<string, unknown>>(text: string, params: unknown[] = [], personId?: number): Promise<T[]> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  client ??= neon(process.env.DATABASE_URL);
  if (personId === undefined) return (await client.query(text, params)) as T[];
  const [, rows] = await client.transaction([
    client.query("select set_config('app.person_id', $1, true)", [String(personId)]),
    client.query(text, params),
  ]);
  return rows as T[];
}
