import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { PhotoThumb } from "@/components/PhotoThumb";
import { formatCents, plainCents } from "@/lib/money";
import { editedAt, firstName, itemLabel, localDate, shortDate } from "@/lib/names";
import { requirePerson } from "@/lib/session";
import { eachCents } from "@/lib/split";
import { bill as loadBill, idParam } from "@/lib/tab";

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
  const other = shares[0] ? firstName(shares[0].name) : payer; // two people: the one other person
  const mine = b.people.find((p) => p.person_id === me.id);
  // Settled for me: every share when I paid, else my own share (another pair may still be open).
  const settledAt = iPaid ? b.settled_at : (mine?.settled_at ?? null);
  const settled = settledAt ? shortDate(localDate(settledAt)) : null;
  // A $0 share is settled at save with no round, so a round is named only if money was settled.
  const round = settled && (iPaid ? shares.some((p) => p.owes_cents > 0) : (mine?.owes_cents ?? 0) > 0);
  // All of what the bill shares out - my share, or everyone's when I paid, open or not.
  const owes = formatCents(b.amount);
  const many = b.people.length > 2;
  const people = b.people.map((p) => ({ id: p.person_id, name: p.name }));
  // The box (3+ people): who owes, in People order with the viewer as "You" (Artifact M5), $0.00 rows hidden.
  const box = b.people.filter((p) => p.person_id !== b.payer_id && p.owes_cents > 0);
  // The bill shows Settled only when every share is; two people always show Open or Settled.
  const pill = b.settled_at ? `Settled ${shortDate(localDate(b.settled_at))}` : many ? null : "Open";
  // The viewer's line: 3+ people, the payer's total owed or my own share (none at $0.00); two people as ever.
  const line = iPaid ? (many ? "Owed to you" : `${other} ${settled ? "owed" : "owes you"}`) : `You ${settled ? "owed" : "owe"} ${payer}`;
  const lineClass = settled ? "" : iPaid ? "owed" : "owe"; // a settled line is plain (C7)
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
            {b.total_edited_at && <span className="edited">edited {editedAt(b.total_edited_at)}</span>}
            <div className="xs dim">
              {iPaid ? "You" : payer} paid · {shortDate(b.bill_date)}
              {b.date_edited_at && <span className="edited">edited {editedAt(b.date_edited_at)}</span>}
            </div>
            {(!many || b.amount > 0) && <div className={`small num ${lineClass}`}>{line} {owes}</div>}
            {pill && <span className={b.settled_at ? "pill muted" : "pill ok"}>{pill}</span>}
          </div>
        </div>
        {many && box.length > 0 && (
          <div className="soft small" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {box.map((p) => (
              <div className="row" key={p.person_id}>
                <span className="grow">{p.person_id === me.id ? "You" : firstName(p.name)}</span>
                <span className="num">{formatCents(p.owes_cents)}</span>
                <span className={p.settled_at ? "pill muted" : "pill ok"}>{p.settled_at ? "Settled" : "Open"}</span>
              </div>
            ))}
          </div>
        )}
        <div className="list small">
          {b.lines.map((l, i) => {
            if (l.kind === "item") pos++;
            const label = itemLabel(l.people, people, me.id);
            // Tinted when I pay part of it (not the payer's own view): "your part" is my share of the item,
            // so an item its discounts bring to $0.00 or less is not mine to pay.
            // Nothing is mine to pay when my whole share is $0.00 (a share is never below it).
            const part = !iPaid && (mine?.owes_cents ?? 0) > 0 && l.kind === "item" && l.people?.includes(me.id) ? eachCents(b.lines, i) : 0;
            const you = part > 0;
            return (
              <div className={l.kind === "item" ? (you ? "li you" : "li") : "li sub"} key={l.position}>
                <div className="grow">
                  {l.kind === "item" && !b.typed ? `${pos} ${l.name}` : l.name}
                  {you && <div className="part">your part {formatCents(part)}</div>}
                </div>
                {label && <span className="dim xs">{label}</span>}
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
