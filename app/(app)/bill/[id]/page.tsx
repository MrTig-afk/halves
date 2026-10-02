import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { PhotoThumb } from "@/components/PhotoThumb";
import { formatCents, plainCents } from "@/lib/money";
import { firstName, localDate, shortDate } from "@/lib/names";
import { requirePerson } from "@/lib/session";
import { bill as loadBill, idParam, type Bill, type BillLine } from "@/lib/tab";

export const metadata = { title: "Bill - Halves" };

// A saved bill, read-only for everyone on it, open or settled: there is no Edit and no Delete.
export default async function BillPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const me = await requirePerson(); // checked here too: on an in-app navigation only the page renders
  const id = idParam((await params).id);
  const b = id === null ? null : await loadBill(id, me.id);
  // The same 404 for a bill that does not exist and one that is not yours, so nothing leaks.
  if (!b) notFound();

  const from = idParam((await searchParams).from ?? "");
  const back = from === null ? { href: "/", label: "‹ Home" } : { href: `/settled/${from}`, label: "‹ Settled" };
  const iPaid = b.payer_id === me.id;
  const shares = b.people.filter((p) => p.person_id !== b.payer_id);
  const payer = firstName(b.payer);
  // Two people: the one other person. More: an owe line from my own share, or the total owed to me.
  const other = firstName(shares.length === 1 ? shares[0].name : payer);
  const mine = b.people.find((p) => p.person_id === me.id);
  // Settled for me: every share when I paid, else my own share (another pair may still be open).
  const settledAt = iPaid ? b.settled_at : (mine?.settled_at ?? null);
  const settled = settledAt ? shortDate(localDate(settledAt)) : null;
  // A $0 share is settled at save with no round, so a round is named only if money was settled.
  const round = settled && (iPaid ? shares.some((p) => p.owes_cents > 0) : (mine?.owes_cents ?? 0) > 0);
  // What I am still owed on an open bill I paid (shares settled with others drop out); otherwise
  // the bill's amount - all of it once settled, or my own share.
  const owes = formatCents(iPaid && !settled ? shares.filter((p) => !p.settled_at).reduce((n, p) => n + p.owes_cents, 0) : b.amount);
  let pos = 0;

  return (
    <main className="screen">
      <div className="bar">
        <Link href={back.href} className="back">
          {back.label}
        </Link>
        <span className="ttl">{b.description}</span>
      </div>
      <div className="body" style={{ gap: 8 }}>
        <div className="row">
          {b.has_photo ? (
            <PhotoThumb src={`/api/bill/${b.id}/photo`} />
          ) : b.photo_state === "archived" ? (
            <span className="thumb none xs dim">photo archived</span>
          ) : b.typed ? (
            <span className="thumb none dim" aria-label="No receipt">
              <Icon name="pencil" size={20} />
            </span>
          ) : null}
          <div className="grow">
            <b className="num">{formatCents(b.total_cents)}</b>
            <div className="xs dim">
              {iPaid ? "You" : payer} paid · {shortDate(b.bill_date)}
            </div>
            {settled ? (
              <div className="small num">{iPaid ? (shares.length > 1 ? `Owed to you ${owes}` : `${other} owed ${owes}`) : `You owed ${payer} ${owes}`}</div>
            ) : (
              <div className={`small num ${iPaid ? "owed" : "owe"}`}>{iPaid ? (shares.length > 1 ? `Owed to you ${owes}` : `${other} owes you ${owes}`) : `You owe ${payer} ${owes}`}</div>
            )}
            <span className={settled ? "pill muted" : "pill ok"}>{settled ? `Settled ${settled}` : "Open"}</span>
          </div>
        </div>
        <div className="list small">
          {b.lines.map((l) => {
            if (l.kind === "item") pos++;
            return (
              <div className={l.kind === "item" ? "li" : "li sub"} key={l.position}>
                <span className="grow">{l.kind === "item" && !b.typed ? `${pos} ${l.name}` : l.name}</span>
                <ShareWord line={l} b={b} me={me.id} />
                <span className="num">{plainCents(l.price_cents)}</span>
              </div>
            );
          })}
        </div>
        {b.typed && <div className="soft xs dim">Added without a receipt.</div>}
        {settled ? (
          round && <div className="soft xs dim">Settled with the round of {settled}.</div>
        ) : (
          b.added_by !== me.id && <div className="soft xs dim">Added by {firstName(b.adder)}. Bills can&apos;t be changed once saved.</div>
        )}
      </div>
    </main>
  );
}

// Who had each item, in the viewer's words. Two people: both -> "split", me -> "yours", the other
// -> "<Other>'s". More (until T5's labels): "yours", "everyone", "<Name>'s", or the names.
function ShareWord({ line, b, me }: { line: BillLine; b: Bill; me: number }) {
  const set = line.people;
  if (line.kind !== "item" || !set?.length) return null;
  const name = (id: number) => firstName(b.people.find((p) => p.person_id === id)?.name ?? "");
  if (set.length === b.people.length) return b.people.length === 2 ? <span className="owed xs">split</span> : <span className="dim xs">everyone</span>;
  if (set.length === 1) return <span className="dim xs">{set[0] === me ? "yours" : `${name(set[0])}'s`}</span>;
  return <span className="dim xs">{set.map(name).join(", ")}</span>;
}
