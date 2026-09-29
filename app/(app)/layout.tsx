import { requirePerson } from "@/lib/session";

// Every screen in this group needs a signed-in device; anyone else lands on the tiles, and a
// deep link (a bill, a settled round) carries on after signing in.
export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  await requirePerson();
  return children;
}
