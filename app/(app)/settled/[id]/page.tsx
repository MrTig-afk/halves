import Link from "next/link";
import { notFound } from "next/navigation";
import { BillItem } from "@/components/BillItem";
import { formatCents } from "@/lib/money";
import { firstName, localDate, shortDate } from "@/lib/names";
import { requirePerson } from "@/lib/session";
import { idParam, round as loadRound } from "@/lib/tab";

export const metadata = { title: "Settled - Halves" };

// One settled round and the bills it cleared.
export default async function SettledPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePerson(); // checked here too: on an in-app navigation only the page renders
  const id = idParam((await params).id);
  const found = id === null ? null : await loadRound(id, me.id);
  if (!found) notFound();
  const { round: r, bills } = found;

  return (
    <main className="screen">
      <div className="bar">
        <Link href="/" className="back">
          ‹ Home
        </Link>
        <span className="ttl">Settled up {formatCents(r.amount_cents)}</span>
      </div>
      <div className="body">
        <div className="xs dim">
          {shortDate(localDate(r.created_at))}, by {r.settled_by === me.id ? "you" : firstName(r.settled_by_name)} · {r.bills}{" "}
          {r.bills === 1 ? "bill" : "bills"} with {firstName(r.other)}
        </div>
        <div className="list">
          {bills.map((b) => (
            <BillItem key={b.id} b={b} me={me.id} href={`/bill/${b.id}?from=${r.id}`} settled />
          ))}
        </div>
      </div>
    </main>
  );
}
