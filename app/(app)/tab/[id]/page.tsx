import Link from "next/link";
import { notFound } from "next/navigation";
import { BillItem } from "@/components/BillItem";
import { SettleButton } from "@/components/SettleButton";
import { formatCents } from "@/lib/money";
import { firstName } from "@/lib/names";
import { requirePerson } from "@/lib/session";
import { idParam, pairBills, tabs } from "@/lib/tab";

// One person's tab (M3): what is open between the two of us, and Settle up with them (M4).
export default async function TabPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePerson(); // checked here too: on an in-app navigation only the page renders
  const id = idParam((await params).id);
  // tabs() lists everyone but me, so me and an unknown id both fall out here.
  if (id === null) notFound();
  const [all, bills] = await Promise.all([tabs(me.id), pairBills(me.id, id)]);
  const t = all.find((x) => x.partner_id === id);
  if (!t) notFound();
  const name = firstName(t.partner);

  return (
    <main className="screen">
      <div className="bar">
        <Link href="/" className="back">
          ‹ Home
        </Link>
        <span className="ttl">{name}</span>
      </div>
      <div className="body">
        <div className="card">
          <div className="row center-y">
            {t.balance === 0 ? (
              <>
                <div className="grow">
                  <div className="xs dim">{name}</div>
                  <div className="settled-title">All settled up</div>
                </div>
                <span className="pill ok num">$0.00</span>
              </>
            ) : (
              <div className="grow">
                <div className="xs dim">{t.balance > 0 ? `${name} owes you` : `You owe ${name}`}</div>
                <div className={`num tab-amt ${t.balance > 0 ? "owed" : "owe"}`}>{formatCents(Math.abs(t.balance))}</div>
              </div>
            )}
          </div>
          {t.balance !== 0 && (
            <SettleButton
              partnerId={t.partner_id}
              partner={name}
              balance={t.balance}
              label={`Settle up with ${name}`}
              confirm="Settle up"
              note={`Clears what's open between you and ${name} (${t.open} ${t.open === 1 ? "bill" : "bills"}). Your other balances don't change. This can't be undone.`}
              after="/"
            />
          )}
        </div>
        {bills.length > 0 && (
          <>
            <div className="lbl">Open between you two</div>
            <div className="list">
              {bills.map((b) => (
                <BillItem key={b.id} b={b} me={me.id} href={`/bill/${b.id}`} form="pair" name={name} />
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
