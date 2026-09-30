// The running tab: what each pair owes on open bills, the bills themselves, and the settled
// rounds. Every query is scoped to the signed-in person: a bill or round is only ever read by
// its payer or its partner.
import { query } from "./db";
import { ID_RE } from "./paths";
import type { LineKind } from "./receipt";
import type { Share } from "./split";

export type Tab = { partner_id: number; partner: string; balance: number; open: number }; // balance > 0: they owe me
export type BillRow = {
  id: number;
  description: string;
  bill_date: string; // YYYY-MM-DD
  total_cents: number;
  partner_owes_cents: number;
  payer_id: number;
  payer: string;
  partner_id: number;
  partner: string;
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
export type BillLine = { position: number; name: string; price_cents: number; kind: LineKind; share: Share | null };
export type Bill = BillRow & {
  photo_state: "none" | "kept" | "not_kept_full" | "archived";
  has_photo: boolean;
  typed: boolean; // added without a receipt (Artifact D4), stored when saved
  settled_at: string | null;
  lines: BillLine[];
};

// One tab per other person, even with nothing open yet. The same balance sum is also written
// inside two statements that must compute it on their own rows: saving a bill (the tab just
// before it, in the save's snapshot) and settleAll (exactly the rows it locks).
export const tabs = (me: number) =>
  query<Tab>(
    `select p.id::int as partner_id, p.name as partner,
            coalesce(sum(case when b.payer_id = $1 then b.partner_owes_cents else -b.partner_owes_cents end), 0)::int as balance,
            count(b.id)::int as open
     from person p
     left join bill b on b.settlement_id is null
       and ((b.payer_id = $1 and b.partner_id = p.id) or (b.payer_id = p.id and b.partner_id = $1))
     where p.id <> $1
     group by p.id, p.name order by p.id`,
    [me],
  );

const BILL_COLUMNS = `b.id::int, b.description, to_char(b.bill_date, 'YYYY-MM-DD') as bill_date, b.total_cents, b.partner_owes_cents,
  b.payer_id::int, pa.name as payer, b.partner_id::int, pb.name as partner`;
const BILL_FROM = `bill b join person pa on pa.id = b.payer_id join person pb on pb.id = b.partner_id`;

export const openBills = (me: number) =>
  query<BillRow>(
    `select ${BILL_COLUMNS} from ${BILL_FROM}
     where b.settlement_id is null and (b.payer_id = $1 or b.partner_id = $1)
     order by b.bill_date desc, b.id desc`,
    [me],
  );

export const rounds = (me: number, only: number | null = null) =>
  query<Round>(
    `select s.id::int, s.amount_cents, s.created_at::text, s.settled_by::int, sb.name as settled_by_name,
            (select count(*)::int from bill where settlement_id = s.id) as bills,
            o.id::int as other_id, o.name as other
     from settlement s join person sb on sb.id = s.settled_by
       join person o on o.id = case when s.person_low_id = $1 then s.person_high_id else s.person_low_id end
     where $1 in (s.person_low_id, s.person_high_id) and ($2::bigint is null or s.id = $2)
     order by s.created_at desc, s.id desc`,
    [me, only],
  );

export async function round(id: number, me: number): Promise<{ round: Round; bills: BillRow[] } | null> {
  const [found] = await rounds(me, id);
  if (!found) return null;
  const bills = await query<BillRow>(
    `select ${BILL_COLUMNS} from ${BILL_FROM} where b.settlement_id = $1 and (b.payer_id = $2 or b.partner_id = $2)
     order by b.bill_date desc, b.id desc`,
    [id, me],
  );
  return { round: found, bills };
}

export async function bill(id: number, me: number): Promise<Bill | null> {
  const [b] = await query<Omit<Bill, "lines">>(
    `select ${BILL_COLUMNS}, b.photo_state,
            exists (select 1 from receipt_photo p where p.bill_id = b.id) as has_photo,
            b.typed,
            (select created_at::text from settlement where id = b.settlement_id) as settled_at
     from ${BILL_FROM} where b.id = $1 and (b.payer_id = $2 or b.partner_id = $2)`,
    [id, me],
  );
  if (!b) return null;
  const lines = await query<BillLine>(
    "select position, name, price_cents, kind, share from line_item where bill_id = $1 order by position",
    [id],
  );
  return { ...b, lines };
}

// A route or page id: digits only, or it is simply not found.
export const idParam = (s: string) => (ID_RE.test(s) ? Number(s) : null);

// Settle all between me and one other person, in one statement. The open bills are locked, the
// balance is worked out from exactly those rows, and they are all stamped with the new
// settlement - but only when that balance is the one the person confirmed (`expected`, from my
// side). If a bill arrived in between, nothing is settled and the new balance comes back to be
// confirmed; money that changed hands always matches the record. A second press (or the partner
// pressing at the same moment) waits for the lock, finds nothing open and settles nothing. A net
// balance of zero records nothing: there is no money to hand over, so there is no Settle all.
export async function settleAll(
  me: number,
  other: number,
  expected: number,
): Promise<{ id: number | null; amount_cents: number; balance: number; bills: number }> {
  const [r] = await query<{ id: number | null; balance: number; bills: number }>(
    `with pair as (
       select id, payer_id, partner_owes_cents from bill
       where settlement_id is null
         and ((payer_id = $1 and partner_id = $2) or (payer_id = $2 and partner_id = $1))
       for update
     ),
     bal as (select coalesce(sum(case when payer_id = $1 then partner_owes_cents else -partner_owes_cents end), 0)::int as b from pair),
     s as (
       insert into settlement (person_low_id, person_high_id, amount_cents, from_person_id, to_person_id, settled_by)
       select least($1::bigint, $2::bigint), greatest($1::bigint, $2::bigint), abs(b),
              case when b > 0 then $2::bigint else $1::bigint end, case when b > 0 then $1::bigint else $2::bigint end, $1
       from bal where b <> 0 and b = $3
       returning id
     ),
     u as (update bill set settlement_id = s.id from s where bill.id in (select id from pair) returning 1)
     select (select id::int from s) as id, (select b from bal) as balance, (select count(*)::int from u) as bills`,
    [me, other, expected],
  );
  return { id: r.id, amount_cents: Math.abs(r.balance), balance: r.balance, bills: r.bills };
}
