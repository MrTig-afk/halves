// One bill in a list (Home's open bills, a settled round): date block, description, who paid,
// and who owes whom on this bill. Links to the read-only bill.
import Link from "next/link";
import { formatCents } from "@/lib/money";
import { dayMonth, firstName } from "@/lib/names";
import type { BillRow } from "@/lib/tab";

// The rows of Home with three or more people (M2, "home") and of one person's tab (M3, "pair", with
// that person's first name): the second line under the description and the word over the amount.
// A pair row is a bill between two of us: with more people on it the share is that person's (never
// her/his).
export function rowText(b: BillRow, me: number, form: "home" | "pair", name = ""): { line: string; word: string } {
  const iPaid = b.payer_id === me;
  if (form === "home") {
    return { line: iPaid ? `You paid · with ${b.others.map((o) => firstName(o.name)).join(", ")}` : `${firstName(b.payer)} paid`, word: iPaid ? "owed" : "you owe" };
  }
  // A bill the other person paid reads as on Home ("<Name> paid", "you owe").
  const paid = iPaid ? `You paid${b.size > 2 ? ` · ${b.size} people` : ""}` : `${name} paid`;
  return { line: paid, word: !iPaid ? "you owe" : b.size > 2 ? `${name}'s share` : "owes" };
}

export function BillItem({ b, me, href, settled, form, name }: { b: BillRow; me: number; href: string; settled?: boolean; form?: "home" | "pair"; name?: string }) {
  const { day, month } = dayMonth(b.bill_date);
  const iPaid = b.payer_id === me;
  const other = firstName(iPaid ? (b.others[0]?.name ?? "") : b.payer);
  const you = `You ${settled ? "owed" : "owe"}`;
  // Two people read as ever; with three or more there is no one name to put on it ("owed $X" is the
  // total owed to me on it).
  const words = !iPaid ? you : b.size > 2 ? "owed" : `${other} ${settled ? "owed" : "owes"}`;
  const row = form && rowText(b, me, form, name);
  return (
    <Link href={href} className="li">
      <div className="date">
        {month.toUpperCase()}
        <b>{day}</b>
      </div>
      <div className="grow">
        <div className="small">
          <b>{b.description}</b>
        </div>
        <div className="xs dim">
          {row ? row.line : `${iPaid ? "You" : firstName(b.payer)} paid ${formatCents(b.total_cents)}`}
        </div>
      </div>
      <div className={`xs num right ${iPaid ? "owed" : "owe"}`}>
        {row ? row.word : words}
        <br />
        {formatCents(b.amount)}
      </div>
    </Link>
  );
}
