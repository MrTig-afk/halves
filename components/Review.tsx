"use client";

// The review screen: name the bill, pick who it is with, and set each item's share with a
// 3-position slider (mine / half / partner's). Any name or price can be tapped and edited.
import { useState } from "react";
import { formatCents, parseCents } from "@/lib/money";
import type { LineKind } from "@/lib/receipt";
import { partnerOwes, type Share } from "@/lib/split";

export type Partner = { id: number; name: string };
export type Row = { key: number; name: string; price_cents: number; kind: LineKind; share: Share };
export type Draft = { description: string; date: string; total_cents: number | null; rows: Row[] };

const ORDER: Share[] = ["payer", "split", "partner"];
const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const initial = (name: string) => name.trim().charAt(0).toUpperCase();
let nextKey = 1_000_000;

export function Review({ me, partners, draft, onBack }: { me: string; partners: Partner[]; draft: Draft; onBack: () => void }) {
  const [description, setDescription] = useState(draft.description);
  const [date, setDate] = useState(draft.date);
  const [partnerId, setPartnerId] = useState(partners[0]?.id ?? 0);
  const [rows, setRows] = useState(draft.rows);
  const [total, setTotal] = useState(draft.total_cents);
  const [editing, setEditing] = useState<number | null>(null);
  const partner = partners.find((p) => p.id === partnerId);
  const partnerName = partner ? first(partner.name) : "your partner";
  const owes = partnerOwes(rows, total);

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  // Removing an item removes the discount lines under it too: a discount belongs to its item,
  // and must never slide onto a different one.
  const remove = (key: number) =>
    setRows((rs) => {
      const i = rs.findIndex((r) => r.key === key);
      if (i < 0) return rs;
      let end = i + 1;
      if (rs[i]?.kind === "item") while (rs[end]?.kind === "discount") end++;
      return [...rs.slice(0, i), ...rs.slice(end)];
    });
  const all = (share: Share) => setRows((rs) => rs.map((r) => (r.kind === "item" ? { ...r, share } : r)));
  const add = () => {
    const key = nextKey++;
    setRows((rs) => [...rs, { key, name: "", price_cents: 0, kind: "item", share: "split" }]);
    setEditing(key);
  };

  const slide = (e: React.MouseEvent<HTMLButtonElement>, r: Row) => {
    let share: Share;
    if (e.detail === 0) share = ORDER[(ORDER.indexOf(r.share) + 1) % 3]; // keyboard: cycle
    else {
      const b = e.currentTarget.getBoundingClientRect();
      share = ORDER[Math.max(0, Math.min(2, Math.floor(((e.clientX - b.left) / b.width) * 3)))];
    }
    update(r.key, { share });
  };

  let pos = 0;
  return (
    <main className="screen">
      <div className="bar">
        <button type="button" className="back" aria-label="Back" onClick={onBack}>
          ‹
        </button>
        <span className="ttl">New bill</span>
      </div>
      <div className="body" style={{ gap: 8 }}>
        <label className="field">
          <span className="xs dim">Description</span>
          <input className="plain b" value={description} placeholder="What was it?" onChange={(e) => setDescription(e.target.value)} maxLength={60} />
        </label>
        <div className="row small center-y">
          <span className="dim">With you and</span>
          <select className="plain b" value={partnerId} onChange={(e) => setPartnerId(Number(e.target.value))} aria-label="Split with">
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="row small center-y">
          <input className="plain dim num" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
          <span className="dim">·</span>
          {/* The receipt total decides All ½ and All partner's; editable in case the AI misread it. */}
          <MoneyInput cents={total} label="Receipt total" allowEmpty placeholder="Total" onChange={setTotal} ok={(v) => v >= 0} />
        </div>
        <div className="row">
          <button type="button" className="btn ghost sm" onClick={() => all("split")}>
            All ½
          </button>
          <button type="button" className="btn ghost sm" onClick={() => all("payer")}>
            All mine
          </button>
          <button type="button" className="btn ghost sm" onClick={() => all("partner")}>
            All {partnerName}&apos;s
          </button>
        </div>
        <div className="row center-y">
          <span className="grow xs dim">Slide each item</span>
          <div className="legend">
            <span>Mine</span>
            <span>½</span>
            <span>{partnerName}</span>
          </div>
        </div>
        <div className="items">
          {rows.map((r) => {
            if (r.kind === "item") pos++;
            const note = r.kind === "discount" ? `follows ${pos}` : r.kind === "surcharge" ? "fee, shared in proportion" : "";
            const knob = r.share === "payer" ? initial(me) : r.share === "split" ? "½" : initial(partnerName);
            return (
              // Editing a row shows Remove under its name; it stays until another row is edited, never
              // ending on blur (Safari does not focus a clicked button, so blur cannot tell a click on
              // Remove from leaving the row). The slider never moves, so a tap on it is never a Remove.
              <div key={r.key} className={r.kind === "item" ? "it" : "it sub"}>
                <span className="pos">{r.kind === "item" ? pos : ""}</span>
                <span className="nm">
                  <input
                    className="plain"
                    value={r.name}
                    placeholder="Item name"
                    maxLength={80}
                    aria-label={`Line ${pos} name`}
                    autoFocus={editing === r.key}
                    onFocus={() => setEditing(r.key)}
                    onChange={(e) => update(r.key, { name: e.target.value })}
                  />
                  {note && <span className="xs dim">{note}</span>}
                  {editing === r.key && (
                    <button
                      type="button"
                      className="remove"
                      onClick={() => {
                        remove(r.key);
                        setEditing(null);
                      }}
                    >
                      Remove
                    </button>
                  )}
                </span>
                <MoneyInput
                  cents={r.price_cents}
                  label="Price"
                  onFocus={() => setEditing(r.key)}
                  onChange={(v) => update(r.key, { price_cents: v ?? 0 })}
                  ok={(v) => (r.kind === "discount" ? v < 0 : v >= 0)}
                />
                {r.kind === "item" ? (
                  <button type="button" className="s3" data-v={r.share} data-k={knob} aria-label={`${r.name || "Item"}: ${r.share === "payer" ? "yours" : r.share === "split" ? "split equally" : `${partnerName}'s`}`} onClick={(e) => slide(e, r)} />
                ) : (
                  <span className="s3 none" />
                )}
              </div>
            );
          })}
        </div>
        <button type="button" className="btn ghost sm" style={{ flex: "none" }} onClick={add}>
          + Add a line
        </button>
      </div>
      <div className="foot">
        <div className="owebar">
          <div>
            <div className="xs dim">{partnerName} owes you</div>
            <div className="amt owed num">{formatCents(owes)}</div>
          </div>
          <button type="button" className="btn sm" style={{ flex: "none" }} disabled title="Saving arrives with the next step">
            Save
          </button>
        </div>
      </div>
    </main>
  );
}

// Shows an amount as money; while focused it is plain text to edit. An unreadable entry, or one
// `ok` rejects (a discount must be negative), puts the old value back. With allowEmpty, clearing
// the box means "no amount" (null).
function MoneyInput({
  cents,
  label,
  ok,
  onChange,
  onFocus,
  allowEmpty,
  placeholder,
}: {
  cents: number | null;
  label: string;
  ok: (cents: number) => boolean;
  onChange: (cents: number | null) => void;
  onFocus?: () => void;
  allowEmpty?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      className="plain pr num"
      inputMode="decimal"
      aria-label={label}
      placeholder={placeholder}
      value={text ?? (cents === null ? "" : formatCents(cents))}
      onFocus={() => {
        setText(cents === null ? "" : (cents / 100).toFixed(2));
        onFocus?.();
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text !== null && allowEmpty && text.trim() === "") onChange(null);
        else {
          const v = text === null ? null : parseCents(text);
          if (v !== null && ok(v)) onChange(v);
        }
        setText(null);
      }}
    />
  );
}
