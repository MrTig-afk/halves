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

// Home: the tab with each other person (with three or more people, the balances and one tab per person), every open bill from both sides, and the settled rounds.
export default async function Home() {
  const me = await currentPerson();
  if (!me) redirect("/signin");
  const [everyone, bills, done] = await Promise.all([tabs(me.id), openBills(me.id), rounds(me.id)]);
  const partner = everyone[0] ? firstName(everyone[0].partner) : "your partner";
  // A tab is shown with someone once there is something between you: an open bill or a round.
  const many = everyone.length > 1; // three or more people on the app (M2)
  const owing = everyone.filter((t) => t.balance !== 0);
  const overall = everyone.reduce((sum, t) => sum + t.balance, 0);
  const tabList = everyone.filter((t) => t.open > 0 || done.some((r) => r.other_id === t.partner_id));
  // Two people: Open bills, then Settled. Three or more (M2): Balances, Settled, then Open bills.
  const openList = bills.length > 0 && (
    <>
      <div className="lbl">Open bills</div>
      <div className="list">
        {bills.map((b) => (
          <BillItem key={b.id} b={b} me={me.id} href={`/bill/${b.id}`} form={many ? "home" : undefined} />
        ))}
      </div>
    </>
  );

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
          {many && (
            <>
              <div className="card">
                {overall === 0 ? (
                  <div className="row center-y">
                    <div className="grow settled-title">All settled up</div>
                    <span className="pill ok num">$0.00</span>
                  </div>
                ) : (
                  <div>
                    <div className="xs dim">{overall > 0 ? "Overall, you're owed" : "Overall, you owe"}</div>
                    <div className={`num tab-amt ${overall > 0 ? "owed" : "owe"}`}>{formatCents(Math.abs(overall))}</div>
                  </div>
                )}
              </div>
              {owing.length > 0 && (
                <>
                  <div className="lbl">Balances</div>
                  <div className="list">
                    {owing.map((t) => (
                      <Link href={`/tab/${t.partner_id}`} className="li" key={t.partner_id}>
                        <div className="grow">
                          <div className="small">
                            <b>{firstName(t.partner)}</b>
                          </div>
                          <div className="xs dim">
                            {t.open} open {t.open === 1 ? "bill" : "bills"}
                          </div>
                        </div>
                        <div className={`xs num right ${t.balance > 0 ? "owed" : "owe"}`}>
                          {t.balance > 0 ? "owes you" : "you owe"}
                          <br />
                          <b>{formatCents(Math.abs(t.balance))}</b>
                        </div>
                        <span className="xs dim">›</span>
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          {!many && tabList.map((t) => {
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
                {t.balance !== 0 && (
                  <SettleButton
                    partnerId={t.partner_id}
                    partner={name}
                    balance={t.balance}
                    label="Settle all"
                    confirm="Settle all"
                    note={`Clears ${t.open} open ${t.open === 1 ? "bill" : "bills"}. The balance goes to $0.00 for both of you. This can't be undone.`}
                  />
                )}
              </div>
            );
          })}
          {!many && openList}
          {done.length > 0 && (
            <>
              <div className="lbl">Settled</div>
              <div className="list">
                {done.map((r) => {
                  const today = isToday(r.created_at);
                  if (many) {
                    return (
                      <Link href={`/settled/${r.id}`} className="li" key={r.id}>
                        <span className="grow small">
                          Settled up with {firstName(r.other)} <b className="num">{formatCents(r.amount_cents)}</b>
                        </span>
                        <span className="xs dim">{shortDate(localDate(r.created_at))} ›</span>
                      </Link>
                    );
                  }
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
          {many && openList}
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
