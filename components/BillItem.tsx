// One bill in a list (Home's open bills, a settled round): date block, description, who paid,
// and who owes whom on this bill. Links to the read-only bill.
import Link from "next/link";
import { formatCents } from "@/lib/money";
import { dayMonth, firstName } from "@/lib/names";
import type { BillRow } from "@/lib/tab";

export function BillItem({ b, me, href, settled }: { b: BillRow; me: number; href: string; settled?: boolean }) {
  const { day, month } = dayMonth(b.bill_date);
  const iPaid = b.payer_id === me;
  const other = firstName(iPaid ? b.partner : b.payer);
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
          {iPaid ? "You" : other} paid {formatCents(b.total_cents)}
        </div>
      </div>
      <div className={`xs num right ${iPaid ? "owed" : "owe"}`}>
        {iPaid ? `${other} ${settled ? "owed" : "owes"}` : `You ${settled ? "owed" : "owe"}`}
        <br />
        {formatCents(b.partner_owes_cents)}
      </div>
    </Link>
  );
}
