import { redirect } from "next/navigation";
import { QuickBill } from "@/components/QuickBill";
import { query } from "@/lib/db";
import { currentPerson } from "@/lib/session";

export const metadata = { title: "Add a bill - Halves" };

export default async function AddPage() {
  // Checked here too: a layout and its page render at the same time.
  const me = await currentPerson();
  if (!me) redirect("/signin");
  const partners = await query<{ id: number; name: string }>("select id::int as id, name from person where id <> $1 order by id", [me.id]);
  return <QuickBill meId={me.id} partners={partners} />;
}
