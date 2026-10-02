import { redirect } from "next/navigation";
import { QuickBill } from "@/components/QuickBill";
import { billPeople } from "@/lib/people";
import { currentPerson } from "@/lib/session";

export const metadata = { title: "Add a bill - Halves" };

export default async function AddPage() {
  // Checked here too: a layout and its page render at the same time.
  const me = await currentPerson();
  if (!me) redirect("/signin");
  const { all, start } = await billPeople(me.id);
  return <QuickBill meId={me.id} people={all} start={start} />;
}
