// One bill in a list (Home's open bills, a settled round): date block, description, who paid,
// and who owes whom on this bill. Links to the read-only bill.
import Link from "next/link";
import { formatCents } from "@/lib/money";
import { dayMonth, firstName } from "@/lib/names";
import type { BillRow } from "@/lib/tab";

export function BillItem({ b, me, href, settled }: { b: BillRow; me: number; href: string; settled?: boolean }) {
  const { day, month } = dayMonth(b.bill_date);
  const iPaid = b.payer_id === me;
  const other = firstName(iPaid ? (b.others[0]?.name ?? "") : b.payer);
  const you = `You ${settled ? "owed" : "owe"}`;
  // Two people read as ever; with three or more there is no one name to put on it ("owed $X" is the
  // total owed to me on it).
  const words = !iPaid ? you : b.size > 2 ? "owed" : `${other} ${settled ? "owed" : "owes"}`;
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
          {iPaid ? "You" : firstName(b.payer)} paid {formatCents(b.total_cents)}
        </div>
      </div>
      <div className={`xs num right ${iPaid ? "owed" : "owe"}`}>
        {words}
        <br />
        {formatCents(b.amount)}
      </div>
    </Link>
  );
}
