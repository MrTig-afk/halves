import { redirect } from "next/navigation";
import { SignIn, type Tile } from "@/components/SignIn";
import { query } from "@/lib/db";
import { safeNext } from "@/lib/paths";
import { currentPerson } from "@/lib/session";

export const metadata = { title: "Sign in - Halves" };

// Who's splitting? One tile per person; names only (no balances or bills before sign-in).
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const next = safeNext((await searchParams).next) ?? "/";
  if (await currentPerson()) redirect(next);
  const tiles = (await query<Tile>(
    `select id::int as id, name, role = 'admin' as admin, pin_hash is not null as claimed
     from person order by role = 'admin' desc, id`,
  ));
  return <SignIn tiles={tiles} next={next} />;
}
