// What the no-receipt form, the review's breakdown and the Saved screen say, worked out from the numbers. Pure, so the
// branches (who paid, how many people, a $0 share) are tested, not just looked at.
import type { Saved } from "./bill";
import { formatCents } from "./money";
import { firstName, listNames } from "./names";
import { breakdown, type Share, type SplitLine } from "./split";

type Person = { id: number; name: string };

// The form's footer (Artifact foot()): what the others owe whoever paid, from the signed-in person's side.
export function typedFoot(o: Record<number, number>, on: Person[], payer: number, me: number) {
  const rows = on.filter((p) => p.id !== payer);
  const each = rows.map((p) => `${p.id === me ? "You" : firstName(p.name)} ${formatCents(o[p.id] ?? 0)}`).join(" · ");
  if (payer === me) return { who: "Owed to you", cents: rows.reduce((s, p) => s + (o[p.id] ?? 0), 0), each, owe: false };
  return { who: `You owe ${firstName(on.find((p) => p.id === payer)?.name ?? "")}`, cents: o[me] ?? 0, each, owe: true };
}

// The hint under Shared by (Artifact tyDraw): who pays what, in words.
export function typedHint(split: number[], payer: number, me: number, on: Person[]): string {
  if (!split.some((q) => q !== payer)) return "Nothing to split: only whoever paid is ticked.";
  if (split.length === 1) return split[0] === me ? "You owe it all." : `${firstName(on.find((p) => p.id === split[0])?.name ?? "")} owes it all.`;
  return `Split equally between ${split.length} people.`;
}

export type SavedView = {
  line: { label: string; cents?: number }[]; // after the description: "Priya owes $9.60", "Priya paid", "you owe $19.00"
  heading: string | null; // "Your tab with Priya": one big line (two people, or someone else paid); null: one row per person
  rows: { label: string; cents: number; owed: boolean; was: string }[];
  notified: string | null;
};

// B7 / D3 / H2. A $0 share is hidden; with two people the tab card always shows. `me` is whoever is
// not among the tabs (they list everyone else on the bill).
export function savedView(s: Saved, names: Record<number, string>): SavedView {
  const nm = (id: number) => (names[id] ? firstName(names[id]) : "your partner");
  const others = s.tabs.map((t) => t.person_id);
  const owed = (id: number) => s.shares.find((x) => x.person_id === id)?.owes ?? 0;
  const two = s.tabs.length === 1;
  const iPaid = !others.includes(s.payer_id);
  const mine = s.shares.find((x) => !others.includes(x.person_id))?.owes ?? 0;
  const tab = (id: number, now: number) => (now >= 0 ? `${nm(id)} owes you` : `You owe ${nm(id)}`);
  const row = (id: number, was: number, now: number, spelled = false) => ({
    label: tab(id, now),
    cents: Math.abs(now),
    owed: now >= 0,
    // Today's spelling: a negative was in words. The payer's side (H2) spells it in words either way.
    was: spelled && was !== 0 ? `was: ${tab(id, was)} ${formatCents(Math.abs(was))}` : was >= 0 ? `was ${formatCents(was)}` : `was ${tab(id, was)} ${formatCents(-was)}`,
  });
  const notified = s.notified.length ? `${listNames(s.notified.map(nm))} ${s.notified.length === 1 ? "has" : "have"} been notified.` : null;
  if (!iPaid) {
    const t = s.tabs.find((x) => x.person_id === s.payer_id)!;
    return {
      line: [{ label: `${nm(s.payer_id)} paid` }, ...(mine > 0 ? [{ label: "you owe", cents: mine }] : [])],
      heading: `Your tab with ${nm(s.payer_id)}`,
      rows: two || mine > 0 ? [row(t.person_id, t.was, t.was - mine, true)] : [],
      notified,
    };
  }
  return {
    line: s.shares.filter((x) => x.owes > 0).map((x) => ({ label: `${nm(x.person_id)} owes`, cents: x.owes })),
    heading: two ? `Your tab with ${nm(s.tabs[0].person_id)}` : null,
    rows: s.tabs.filter((t) => two || owed(t.person_id) > 0).map((t) => row(t.person_id, t.was, t.was + owed(t.person_id))),
    notified,
  };
}

// The panel under a person's button on the review (Artifact B5c/B5d breakdown()): their part of each
// item they had, their share of the fee, a Rounding line only when not 0, and the items that were not theirs.
export type BreakdownView = { head: string; total: number; rows: { label: string; n: number; cents: number }[]; rounding: string | null; not: string | null };
export function breakdownView(lines: (SplitLine & { name: string })[], on: Person[], payer: number, receiptTotalCents: number | null, q: number, me: number): BreakdownView {
  const ids = on.map((p) => p.id);
  const nm = (id: number) => (id === me ? "You" : firstName(on.find((p) => p.id === id)?.name ?? ""));
  const b = breakdown(lines, ids, payer, receiptTotalCents, q);
  const head = payer === me ? `${nm(q)} owes you` : q === me ? `You owe ${nm(payer)}` : `${nm(q)} owes ${nm(payer)}`;
  const called = (i: number) => lines[i].name.trim() || "Item";
  const rows = b.parts.map((x) => ({ label: called(x.line) + (lines[x.line + 1]?.kind === "discount" ? ", less discount" : ""), n: x.n, cents: x.cents }));
  if (b.fee !== null) rows.push({ label: `Card fee, ${q === me ? "your" : `${nm(q)}'s`} share`, n: 1, cents: b.fee });
  const not = lines.filter((l) => l.kind === "item" && !l.people?.includes(q)).map((l) => l.name.trim() || "Item");
  return {
    head,
    total: b.total,
    rows,
    rounding: b.rounding ? `${b.rounding > 0 ? "+" : "-"}${formatCents(Math.abs(b.rounding))}` : null,
    not: not.length ? `Not ${q === me ? "yours" : `${nm(q)}'s`}: ${not.join(", ")}.` : null,
  };
}

// Transitional, until T8: the voice reply still says "mine / split / partner". "partner" has an
// answer only on a bill of exactly two; null: skip that change.
export function voiceSet(share: Share, on: number[], me: number): number[] | null {
  if (share === "split") return on.slice();
  if (share === "payer") return [me];
  return on.length === 2 ? on.filter((p) => p !== me) : null;
}
