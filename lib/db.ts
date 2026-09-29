import { neon } from "@neondatabase/serverless";

// Server-only (never imported by a "use client" file). One-shot parameterised queries over
// HTTP: always placeholders ($1, $2...) with params, never string-built SQL.
let client: ReturnType<typeof neon> | undefined;

export async function query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  client ??= neon(process.env.DATABASE_URL);
  return (await client.query(text, params)) as T[];
}
