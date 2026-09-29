import { redirect } from "next/navigation";
import { currentPerson } from "@/lib/session";

// Every screen in this group needs a signed-in device; anyone else lands on the tiles.
export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  if (!(await currentPerson())) redirect("/signin");
  return children;
}
