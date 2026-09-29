import Link from "next/link";
import { notFound } from "next/navigation";
import { ResetPinButton } from "@/components/ResetPinButton";
import { initial, localDate, shortDate } from "@/lib/names";
import { people } from "@/lib/people";
import { requirePerson } from "@/lib/session";

export const metadata = { title: "People - Halves" };

// People (F2), admin only: who has set up their tile, and resetting a PIN.
export default async function People() {
  const me = await requirePerson();
  if (me.role !== "admin") notFound();
  const list = await people();
  return (
    <main className="screen">
      <div className="bar">
        <Link href="/settings" className="back">
          ‹ Settings
        </Link>
        <span className="ttl">People</span>
      </div>
      <div className="body">
        <div className="list">
          {list.map((p) => (
            <div className="li" key={p.id}>
              <span className="av" data-admin={p.role === "admin" ? "" : undefined} data-new={p.claimed_at || p.role === "admin" ? undefined : ""}>
                {initial(p.name)}
              </span>
              <div className="grow">
                <b>{p.name}</b>
                {p.role === "admin" ? (
                  <div className="xs dim">Admin</div>
                ) : p.claimed_at ? (
                  <div className="xs dim">Set up {shortDate(localDate(p.claimed_at))}</div>
                ) : (
                  <div className="xs owed">Waiting to set up</div>
                )}
              </div>
              {p.role !== "admin" && <ResetPinButton id={p.id} name={p.name} />}
            </div>
          ))}
        </div>
      </div>
      <div className="foot">
        <Link href="/settings/people/new" className="btn">
          + Add a person
        </Link>
      </div>
    </main>
  );
}
