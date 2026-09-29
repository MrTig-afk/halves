import Link from "next/link";
import { ChangePin } from "@/components/ChangePin";
import { requirePerson } from "@/lib/session";

export const metadata = { title: "Change PIN - Halves" };

export default async function ChangePinPage() {
  await requirePerson();
  return (
    <main className="screen">
      <div className="bar">
        <Link href="/settings" className="back">
          ‹ Settings
        </Link>
        <span className="ttl">Change PIN</span>
      </div>
      <ChangePin />
    </main>
  );
}
