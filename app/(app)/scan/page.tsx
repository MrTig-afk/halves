import { redirect } from "next/navigation";
import { ScanFlow } from "@/components/ScanFlow";
import { query } from "@/lib/db";
import { currentPerson } from "@/lib/session";

export const metadata = { title: "Scan a bill - Halves" };

export default async function ScanPage() {
  // Checked here too: a layout and its page render at the same time, so the page cannot rely
  // on the layout's redirect having happened first.
  const me = await currentPerson();
  if (!me) redirect("/signin");
  const partners = await query<{ id: number; name: string }>("select id::int as id, name from person where id <> $1 order by id", [me.id]);
  return <ScanFlow me={me.name} partners={partners} />;
}
