import Link from "next/link";
import { redirect } from "next/navigation";
import { BillItem } from "@/components/BillItem";
import { Icon } from "@/components/Icon";
import { InstallCard } from "@/components/InstallCard";
import { NotifyPrompt } from "@/components/Notifications";
import { SettleButton } from "@/components/SettleButton";
import { formatCents } from "@/lib/money";
import { firstName, initial, isToday, localDate, shortDate } from "@/lib/names";
import { vapidPublicKey } from "@/lib/push";
import { currentPerson } from "@/lib/session";
import { openBills, rounds, tabs } from "@/lib/tab";

// Home: the tab with each other person, every open bill from both sides, and the settled rounds.
export default async function Home() {
  const me = await currentPerson();
  if (!me) redirect("/signin");
  const [everyone, bills, done] = await Promise.all([tabs(me.id), openBills(me.id), rounds(me.id)]);
  const partner = everyone[0] ? firstName(everyone[0].partner) : "your partner";
  // A tab is shown with someone once there is something between you: an open bill or a round.
  const tabList = everyone.filter((t) => t.open > 0 || done.some((r) => r.other_id === t.partner_id));

  return (
    <main className="screen">
      <NotifyPrompt publicKey={vapidPublicKey()} partner={partner} />
      <div className="bar">
        <Link href="/" className="logo">
          <span className="mark" />
          Halves
        </Link>
        <Link href="/settings" className="gear" aria-label="Settings">
          <Icon name="gear" />
        </Link>
      </div>
      {bills.length === 0 && done.length === 0 ? (
        <div className="body">
          <InstallCard />
          <div className="center">
            <div className="icon-art">
              <span className="mark" style={{ width: 44, height: 44 }} />
            </div>
            <b>No bills yet</b>
            <span className="dim small">
              Scan a receipt, or add a bill without one. It adds to your tab with {partner} until you settle up.
            </span>
          </div>
        </div>
      ) : (
        <div className="body">
          <InstallCard />
          {tabList.map((t) => {
            const name = firstName(t.partner);
            return (
              <div className="card" key={t.partner_id}>
                <div className="row center-y">
                  <span className="av">{initial(t.partner)}</span>
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
                {t.balance !== 0 && <SettleButton partnerId={t.partner_id} partner={name} balance={t.balance} open={t.open} />}
              </div>
            );
          })}
          {bills.length > 0 && (
            <>
              <div className="lbl">Open bills</div>
              <div className="list">
                {bills.map((b) => (
                  <BillItem key={b.id} b={b} me={me.id} href={`/bill/${b.id}`} />
                ))}
              </div>
            </>
          )}
          {done.length > 0 && (
            <>
              <div className="lbl">Settled</div>
              <div className="list">
                {done.map((r) => {
                  const today = isToday(r.created_at);
                  return (
                    <Link href={`/settled/${r.id}`} className="li" key={r.id}>
                      <span className="grow small">
                        Settled up <b className="num">{formatCents(r.amount_cents)}</b>
                        {today && (
                          <div className="xs dim">
                            Today, by {r.settled_by === me.id ? "you" : firstName(r.settled_by_name)} · {r.bills} {r.bills === 1 ? "bill" : "bills"}
                          </div>
                        )}
                      </span>
                      <span className="xs dim">{today ? "›" : `${shortDate(localDate(r.created_at))} ›`}</span>
                    </Link>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
      <div className="foot">
        <Link href="/scan" className="btn o">
          <Icon name="camera" /> Scan a bill
        </Link>
        <Link href="/add" className="btn ghost sm">
          <Icon name="pencil" size={14} /> Add without a receipt
        </Link>
        <div className="me">Signed in as {me.name}</div>
      </div>
    </main>
  );
}
