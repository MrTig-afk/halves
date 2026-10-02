// The running tab: what each pair owes on open shares, the bills themselves, and the settled
// rounds. A bill has 2 to 5 people (bill_person); a share is a non-payer's row, open while it has
// no settlement and owes more than $0.00. Every query is scoped to the signed-in person - only the
// people on a bill ever read it - and passes that person to the database (lib/db.ts).
import { query } from "./db";
import { ID_RE } from "./paths";
import type { LineKind } from "./receipt";

export type Tab = { partner_id: number; partner: string; balance: number; open: number }; // balance > 0: they owe me
export type BillRow = {
  id: number;
  description: string;
  bill_date: string; // YYYY-MM-DD
  total_cents: number;
  payer_id: number;
  payer: string;
  size: number; // people on the bill
  others: { id: number; name: string }[]; // everyone on it but me
  amount: number; // what is open to me: the open shares when I paid, else my share (a round: what it settled)
};
export type Round = {
  id: number;
  amount_cents: number;
  created_at: string;
  settled_by: number;
  settled_by_name: string;
  bills: number;
  other_id: number;
  other: string;
};
export type BillLine = { position: number; name: string; price_cents: number; kind: LineKind; people: number[] | null }; // people: who had an item
export type BillPerson = { person_id: number; name: string; owes_cents: number; settled_at: string | null };
export type Bill = BillRow & {
  added_by: number;
  adder: string;
  photo_state: "none" | "kept" | "not_kept_full" | "archived";
  has_photo: boolean;
  typed: boolean; // added without a receipt (Artifact D4), stored when saved
  date_edited_at: string | null; // ISO moments, null = not edited
  total_edited_at: string | null;
  settled_at: string | null; // null while any share is open
  people: BillPerson[]; // the payer included, at 0
  lines: BillLine[];
};

// Open: no round yet and more than $0.00 (a $0.00 share is settled at save and never open).
const OPEN = "q.settlement_id is null and q.owes_cents > 0";

// One tab per other person, even with nothing open yet. The same balance sum is also written
// inside two statements that must compute it on their own rows: saving a bill (the tab just
// before it, in the save's snapshot) and settleAll (exactly the rows it locks).
export const tabs = (me: number) =>
  query<Tab>(
    `select p.id::int as partner_id, p.name as partner,
            coalesce(sum(case when b.payer_id = $1 then q.owes_cents else -q.owes_cents end), 0)::int as balance,
            count(b.id)::int as open
     from person p
     left join (bill_person q join bill b on b.id = q.bill_id) on ${OPEN}
       and ((b.payer_id = $1 and q.person_id = p.id) or (b.payer_id = p.id and q.person_id = $1))
     where p.id <> $1
     group by p.id, p.name order by p.id`,
    [me],
    me,
  );

const BILL_COLUMNS = (amount: string) => `b.id::int, b.description, to_char(b.bill_date, 'YYYY-MM-DD') as bill_date, b.total_cents,
  b.payer_id::int, pa.name as payer,
  (select count(*)::int from bill_person where bill_id = b.id) as size,
  (select coalesce(jsonb_agg(jsonb_build_object('id', o.person_id, 'name', pe.name) order by o.person_id), '[]'::jsonb)
   from bill_person o join person pe on pe.id = o.person_id where o.bill_id = b.id and o.person_id <> $1) as others,
  ${amount} as amount`;
const BILL_FROM = "bill b join person pa on pa.id = b.payer_id";
const MEMBER = "exists (select 1 from bill_person m where m.bill_id = b.id and m.person_id = $1)";

// Bills I am on that are open for me: I paid and some share is open, or my own share is.
export const openBills = (me: number) =>
  query<BillRow>(
    `select ${BILL_COLUMNS(`case when b.payer_id = $1
        then (select coalesce(sum(q.owes_cents), 0)::int from bill_person q where q.bill_id = b.id and ${OPEN})
        else (select coalesce(sum(q.owes_cents), 0)::int from bill_person q where q.bill_id = b.id and q.person_id = $1 and ${OPEN}) end`)}
     from ${BILL_FROM}
     where ${MEMBER}
       and ((b.payer_id = $1 and exists (select 1 from bill_person q where q.bill_id = b.id and ${OPEN}))
         or exists (select 1 from bill_person q where q.bill_id = b.id and q.person_id = $1 and ${OPEN}))
     order by b.bill_date desc, b.id desc`,
    [me],
    me,
  );

export const rounds = (me: number, only: number | null = null) =>
  query<Round>(
    `select s.id::int, s.amount_cents, s.created_at::text, s.settled_by::int, sb.name as settled_by_name,
            (select count(distinct bill_id)::int from bill_person where settlement_id = s.id) as bills,
            o.id::int as other_id, o.name as other
     from settlement s join person sb on sb.id = s.settled_by
       join person o on o.id = case when s.person_low_id = $1 then s.person_high_id else s.person_low_id end
     where $1 in (s.person_low_id, s.person_high_id) and ($2::bigint is null or s.id = $2)
     order by s.created_at desc, s.id desc`,
    [me, only],
    me,
  );

export async function round(id: number, me: number): Promise<{ round: Round; bills: BillRow[] } | null> {
  const [found] = await rounds(me, id);
  if (!found) return null;
  const bills = await query<BillRow>(
    `select ${BILL_COLUMNS("(select coalesce(sum(q.owes_cents), 0)::int from bill_person q where q.bill_id = b.id and q.settlement_id = $2)")}
     from ${BILL_FROM}
     where ${MEMBER} and exists (select 1 from bill_person q where q.bill_id = b.id and q.settlement_id = $2)
     order by b.bill_date desc, b.id desc`,
    [me, id],
    me,
  );
  return { round: found, bills };
}

// One bill, only for someone on it (the same null for a missing bill and someone else's). `amount`
// here is all of what the bill shares out - my share, or everyone's when I paid - open or not.
export async function bill(id: number, me: number): Promise<Bill | null> {
  const [b] = await query<Omit<Bill, "lines">>(
    `select ${BILL_COLUMNS(`case when b.payer_id = $1
        then (select coalesce(sum(q.owes_cents), 0)::int from bill_person q where q.bill_id = b.id)
        else (select coalesce(sum(q.owes_cents), 0)::int from bill_person q where q.bill_id = b.id and q.person_id = $1) end`)},
            b.photo_state,
            exists (select 1 from receipt_photo p where p.bill_id = b.id) as has_photo,
            b.typed, coalesce(b.added_by, b.payer_id)::int as added_by, ad.name as adder,
            to_char(b.date_edited_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as date_edited_at,
            to_char(b.total_edited_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as total_edited_at,
            case when exists (select 1 from bill_person q where q.bill_id = b.id and ${OPEN}) then null
                 else coalesce((select max(q.settled_at) from bill_person q where q.bill_id = b.id), b.created_at)::text end as settled_at,
            (select coalesce(jsonb_agg(jsonb_build_object('person_id', q.person_id, 'name', pe.name, 'owes_cents', q.owes_cents,
               'settled_at', q.settled_at::text) order by q.person_id), '[]'::jsonb)
             from bill_person q join person pe on pe.id = q.person_id where q.bill_id = b.id) as people
     from ${BILL_FROM} join person ad on ad.id = coalesce(b.added_by, b.payer_id)
     where b.id = $2 and ${MEMBER}`,
    [me, id],
    me,
  );
  if (!b) return null;
  const lines = await query<BillLine>(
    `select li.position, li.name, li.price_cents, li.kind,
            case when li.kind = 'item' then (select coalesce(jsonb_agg(lp.person_id order by lp.person_id), '[]'::jsonb) from line_item_person lp where lp.line_item_id = li.id) end as people
     from line_item li where li.bill_id = $1 order by li.position`,
    [id],
    me,
  );
  return { ...b, lines };
}

// A route or page id: digits only, or it is simply not found.
export const idParam = (s: string) => (ID_RE.test(s) ? Number(s) : null);

// Settle all between me and one other person, in one statement. Exactly the open shares between the
// two (theirs on bills I paid, mine on bills they paid) are locked, the balance is worked out from
// those rows, and they are all stamped with the new settlement - but only when that balance is the
// one the person confirmed (`expected`, from my side). Nothing else changes: other pairs' shares on
// the same bills stay open. If a bill arrived in between, nothing is settled and the new balance
// comes back to be confirmed; money that changed hands always matches the record. A second press (or
// the other person pressing at the same moment) waits for the lock, finds nothing open and settles
// nothing. A net balance of zero records nothing: there is no money to hand over, so there is no
// Settle all.
export async function settleAll(
  me: number,
  other: number,
  expected: number,
): Promise<{ id: number | null; amount_cents: number; balance: number; bills: number }> {
  const [r] = await query<{ id: number | null; balance: number; bills: number }>(
    `with pair as (
       select q.bill_id, q.person_id, q.owes_cents, b.payer_id
       from bill_person q join bill b on b.id = q.bill_id
       where ${OPEN}
         and ((b.payer_id = $1 and q.person_id = $2) or (b.payer_id = $2 and q.person_id = $1))
       for update of q
     ),
     bal as (select coalesce(sum(case when payer_id = $1 then owes_cents else -owes_cents end), 0)::int as b from pair),
     s as (
       insert into settlement (person_low_id, person_high_id, amount_cents, from_person_id, to_person_id, settled_by)
       select least($1::bigint, $2::bigint), greatest($1::bigint, $2::bigint), abs(b),
              case when b > 0 then $2::bigint else $1::bigint end, case when b > 0 then $1::bigint else $2::bigint end, $1
       from bal where b <> 0 and b = $3
       returning id, created_at
     ),
     u as (
       update bill_person set settlement_id = s.id, settled_at = s.created_at from s
       where (bill_person.bill_id, bill_person.person_id) in (select bill_id, person_id from pair)
       returning 1
     )
     select (select id::int from s) as id, (select b from bal) as balance, (select count(*)::int from u) as bills`,
    [me, other, expected],
    me,
  );
  return { id: r.id, amount_cents: Math.abs(r.balance), balance: r.balance, bills: r.bills };
}
