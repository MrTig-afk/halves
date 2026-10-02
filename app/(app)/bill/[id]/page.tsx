import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { PhotoThumb } from "@/components/PhotoThumb";
import { formatCents, plainCents } from "@/lib/money";
import { firstName, localDate, shortDate } from "@/lib/names";
import { requirePerson } from "@/lib/session";
import { bill as loadBill, idParam, type BillLine } from "@/lib/tab";

export const metadata = { title: "Bill - Halves" };

// A saved bill, read-only for both people, open or settled: there is no Edit and no Delete.
export default async function BillPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const me = await requirePerson(); // checked here too: on an in-app navigation only the page renders
  const id = idParam((await params).id);
  const b = id === null ? null : await loadBill(id, me.id);
  // The same 404 for a bill that does not exist and one that is not yours, so nothing leaks.
  if (!b) notFound();

  const from = idParam((await searchParams).from ?? "");
  const back = from === null ? { href: "/", label: "‹ Home" } : { href: `/settled/${from}`, label: "‹ Settled" };
  const iPaid = b.payer_id === me.id;
  const other = firstName(iPaid ? b.partner : b.payer);
  const settled = b.settled_at ? shortDate(localDate(b.settled_at)) : null;
  const owes = formatCents(b.partner_owes_cents);
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
              {iPaid ? "You" : other} paid · {shortDate(b.bill_date)}
            </div>
            {settled ? (
              <div className="small num">{iPaid ? `${other} owed ${owes}` : `You owed ${other} ${owes}`}</div>
            ) : (
              <div className={`small num ${iPaid ? "owed" : "owe"}`}>{iPaid ? `${other} owes you ${owes}` : `You owe ${other} ${owes}`}</div>
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
                <ShareWord line={l} iPaid={iPaid} other={other} />
                <span className="num">{plainCents(l.price_cents)}</span>
              </div>
            );
          })}
        </div>
        {b.typed && <div className="soft xs dim">Added without a receipt.</div>}
        {settled ? (
          <div className="soft xs dim">Settled with the round of {settled}.</div>
        ) : (
          !iPaid && <div className="soft xs dim">Added by {other}. Bills can&apos;t be changed once saved.</div>
        )}
      </div>
    </main>
  );
}

// Whose each item is, in the viewer's words.
function ShareWord({ line, iPaid, other }: { line: BillLine; iPaid: boolean; other: string }) {
  if (line.kind !== "item") return null;
  if (line.share === "split") return <span className="owed xs">split</span>;
  const mine = (line.share === "payer") === iPaid;
  return <span className="dim xs">{mine ? "yours" : `${other}'s`}</span>;
}
