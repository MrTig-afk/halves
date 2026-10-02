import { redirect } from "next/navigation";
import { ScanFlow } from "@/components/ScanFlow";
import { billPeople } from "@/lib/people";
import { currentPerson } from "@/lib/session";

export const metadata = { title: "Scan a bill - Halves" };

export default async function ScanPage() {
  // Checked here too: a layout and its page render at the same time, so the page cannot rely
  // on the layout's redirect having happened first.
  const me = await currentPerson();
  if (!me) redirect("/signin");
  const { all, start } = await billPeople(me.id);
  return <ScanFlow meId={me.id} people={all} start={start} />;
}
