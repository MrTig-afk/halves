import Link from "next/link";
import { notFound } from "next/navigation";
import { AddPerson } from "@/components/AddPerson";
import { requirePerson } from "@/lib/session";

export const metadata = { title: "Add a person - Halves" };

export default async function AddPersonPage() {
  const me = await requirePerson();
  if (me.role !== "admin") notFound();
  return (
    <main className="screen">
      <div className="bar">
        <Link href="/settings/people" className="back">
          ‹ People
        </Link>
        <span className="ttl">Add a person</span>
      </div>
      <AddPerson />
    </main>
  );
}
