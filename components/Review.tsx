"use client";

// The review screen (Artifact B5): name the bill, pick who is on it and who paid, and set who had each
// item. Any name or price can be tapped and edited; the footer says what each person owes and why.
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { Panel, PeoplePicker } from "@/components/PeoplePicker";
import { useSave } from "@/components/useSave";
import { useVoice } from "@/components/useVoice";
import { clock, type VoiceResult } from "@/lib/api";
import { edited, MAX_BILL_CENTS, type Saved } from "@/lib/bill";
import { breakdownView, typedFoot } from "@/lib/billview";
import { formatCents, parseCents } from "@/lib/money";
import { editedAt, firstName as first } from "@/lib/names";
import { MAX_NAME, type LineKind, type ReceiptReading } from "@/lib/receipt";
import { eachCents, owes, regroup, setLabel } from "@/lib/split";

export type Partner = { id: number; name: string };
export type Row = { key: number; name: string; price_cents: number; kind: LineKind; set: number[] }; // set: who had an item
export type Draft = {
  scan_id: string; // one per draft: a retried Save can never add the bill twice
  description: string;
  date: string;
  total_cents: number | null;
  rows: Row[];
  photo: Blob | null; // the cropped receipt, kept with the bill
  ai: ReceiptReading | null; // what the AI read, stored unchanged
};
// What the server answered, plus the names of the people it speaks of (the Saved screen).
export type SavedBill = { saved: Saved; names: Record<number, string> };

type Snapshot = Map<number, number[]>; // each set a voice change replaced
let nextKey = 1_000_000;

// `people`: everyone, you first then by id; `start`: who the bill starts with (lib/people.ts billPeople).
export function Review({
  meId,
  people,
  start,
  draft,
  onBack,
  onSaved,
}: {
  meId: number;
  people: Partner[];
  start: number[];
  draft: Draft;
  onBack: () => void;
  onSaved: (s: SavedBill) => void;
}) {
  const [description, setDescription] = useState(draft.description);
  const [date, setDate] = useState(draft.date);
  const [total, setTotal] = useState(draft.total_cents);
  // The moment the person last changed the date / the total, on this phone's clock (display only:
  // the server stamps the save time). null: never changed.
  const [dateAt, setDateAt] = useState<string | null>(null);
  const [totalAt, setTotalAt] = useState<string | null>(null);
  const [onBill, setOnBill] = useState(start);
  const [payer, setPayer] = useState(meId);
  const [rows, setRows] = useState(draft.rows);
  const [editing, setEditing] = useState<number | null>(null);
  const [info, setInfo] = useState<number | null>(null); // whose breakdown is open
  const infoBox = useRef<HTMLElement | null>(null); // the button that opened it

  const on = people.filter((p) => onBill.includes(p.id));
  const nm = (p: Partner) => (p.id === meId ? "You" : first(p.name));
  const options = on.map((p) => ({ id: p.id, name: nm(p) }));
  // Name order breaks a one-cent tie, as on the server.
  const byName = [...on].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id - b.id);
  const lines = rows.map((r) => ({ name: r.name, price_cents: r.price_cents, kind: r.kind, people: r.kind === "item" ? r.set : null }));
  const o = owes(lines, byName.map((p) => p.id), payer, total);
  const foot = typedFoot(o, on, payer, meId);
  const tags = edited(draft.ai, date, total, { date: dateAt !== null, total: totalAt !== null });
  const bv = info ? breakdownView(lines, byName, payer, total, info, meId) : null;

  // Voice: the item numbers the AI answers with map to the rows as they were when sent. A change
  // is applied at once (rows flash) and Undo puts back exactly what it replaced.
  const sent = useRef<number[]>([]);
  const [flash, setFlash] = useState<Set<number>>(new Set());
  const [undo, setUndo] = useState<Snapshot | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const now = useRef({ rows, onBill }); // the committed state, for building the Undo snapshot
  useEffect(() => {
    now.current = { rows, onBill };
  });
  const heard = (r: VoiceResult) => {
    if (!r.ok) return;
    const sets = new Map<number, number[]>();
    for (const c of r.changes) {
      const key = sent.current[c.item - 1];
      const set = c.people.filter((p) => now.current.onBill.includes(p));
      if (key !== undefined && set.length) sets.set(key, set);
    }
    if (!sets.size) return;
    const before: Snapshot = new Map();
    const moved = new Set<number>(); // only rows whose people changed flash (Artifact B6)
    setRows(
      now.current.rows.map((row) => {
        const set = sets.get(row.key);
        if (!set || row.kind !== "item") return row;
        before.set(row.key, row.set);
        if (set.length !== row.set.length || set.some((p) => !row.set.includes(p))) moved.add(row.key);
        return { ...row, set };
      }),
    );
    if (moved.size) setUndo(before); // nothing to keep or undo when every set was already so
    setFlash(moved);
    setTimeout(() => setFlash(new Set()), 1400);
  };
  const voice = useVoice(() => {
    const items = rows.filter((r) => r.kind === "item");
    sent.current = items.map((r) => r.key);
    return items.map((r, i) => r.name.trim() || `Item ${i + 1}`);
  }, () => now.current.onBill, heard);
  const settle = (restore: boolean) => {
    if (restore && undo) setRows((rs) => rs.map((r) => (undo.has(r.key) ? { ...r, set: undo.get(r.key)! } : r)));
    setUndo(null);
    voice.reset();
    setNote(restore ? "Undone. Tap the mic and say who had what" : "Applied. Tap the mic to change more.");
  };

  // Save sends the lines and the total; the server works out what is owed. A failure keeps
  // everything on screen, and Retry sends the same bill again.
  const names = Object.fromEntries(people.map((p) => [p.id, p.name]));
  const { saving, error: saveError, setError: setSaveError, send } = useSave((saved) => onSaved({ saved, names }));
  const save = () => {
    if (rows.reduce((s, r) => s + Math.abs(r.price_cents), 0) > MAX_BILL_CENTS) {
      return setSaveError({ text: "A bill can be at most $100,000. Check the prices.", retry: false });
    }
    return send(
      {
        scan_id: draft.scan_id,
        people: onBill,
        payer_id: payer,
        description: description.trim(),
        date,
        total_cents: total,
        lines: lines.map((l) => ({
          ...l,
          name: l.name.trim() || (l.kind === "item" ? "Item" : l.kind === "discount" ? "Discount" : "Fee"),
        })),
        ai: draft.ai,
        typed: false,
        date_edited: dateAt !== null, // the server decides from the reading (edited()); this is only "the person changed it"
        total_edited: totalAt !== null,
      },
      draft.photo,
    );
  };
  // After a failure that may have reached the server, the bill might already be saved under this
  // scan id: nothing can change and Back is off, so Retry sends exactly what was shown.
  const locked = saving || !!saveError?.retry;
  const busy = saving || voice.state.k === "listening" || voice.state.k === "working";
  // As on the no-receipt form: nothing to save while nobody besides whoever paid owes anything (PRD 6.3).
  const canSave = !busy && description.trim() !== "" && date !== "" && rows.some((r) => r.kind === "item") && byName.some((p) => p.id !== payer && (o[p.id] ?? 0) > 0);

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
  const add = () => {
    const key = nextKey++;
    setRows((rs) => [...rs, { key, name: "", price_cents: 0, kind: "item", set: onBill }]);
    setEditing(key);
  };

  let pos = 0;
  return (
    <main className="screen">
      <div className="bar">
        <button type="button" className="back" aria-label="Back" onClick={onBack} disabled={locked}>
          ‹
        </button>
        <span className="ttl">New bill</span>
      </div>
      {/* Nothing can change while the bill is being saved: what is on screen is what is sent. */}
      <div className="body" style={{ gap: 8 }} inert={locked}>
        {saveError && (
          <div className="banner amber" role="alert">
            {saveError.text}
          </div>
        )}
        <div className="field">
          <div className="row center-y">
            <label className="xs dim grow" htmlFor="rv-description">
              Description
            </label>
            {/* The date and the receipt total, each editable (the AI can misread); an edit is marked with when it was made. */}
            <span className="row small center-y" style={{ flexWrap: "wrap", justifyContent: "flex-end", gap: 4 }}>
              <input
                className="plain dim num"
                type="date"
                value={date}
                aria-label="Date"
                onChange={(e) => {
                  setDate(e.target.value);
                  setDateAt(new Date().toISOString());
                }}
              />
              {tags.date && dateAt && <span className="edited">edited {editedAt(dateAt)}</span>}
              {/* The dot travels with the total, so a wrapped line never starts or ends on it. */}
              <span className="row center-y" style={{ gap: 4, flex: "none" }}>
                <span className="dim">·</span>
                <span style={{ width: 88 }}>
                  <MoneyInput
                    cents={total}
                    label="Receipt total"
                    allowEmpty
                    placeholder="Total"
                    onChange={(v) => {
                      if (v === total) return; // focusing and leaving the box is not an edit
                      setTotal(v);
                      setTotalAt(new Date().toISOString());
                    }}
                    ok={(v) => v >= 0 && v <= MAX_BILL_CENTS}
                  />
                </span>
              </span>
              {tags.total && totalAt && <span className="edited">edited {editedAt(totalAt)}</span>}
            </span>
          </div>
          <input id="rv-description" className="plain b" value={description} placeholder="What was it?" onChange={(e) => setDescription(e.target.value.replace(/[\u0000-\u001f\u007f]/g, " "))} maxLength={60} />
        </div>
        <PeoplePicker
          label="Who's on it"
          text={on.map(nm).join(", ")}
          title="Who's on this bill?"
          options={people.map((p) => ({ id: p.id, name: nm(p), locked: p.id === meId }))}
          selected={onBill}
          onChange={(sel) => {
            setUndo(null);
            setRows((rs) => rs.map((r) => (r.kind === "item" ? { ...r, set: regroup(r.set, onBill, sel) } : r)));
            if (!sel.includes(payer)) setPayer(meId);
            setOnBill(sel);
          }}
          min={2}
          minText="Add at least one other person."
          max={5}
          maxText="A bill can have up to 5 people."
          note="Up to 5 people."
        />
        <PeoplePicker
          label="Who paid"
          text={nm(on.find((p) => p.id === payer) ?? on[0])}
          title="Who paid?"
          options={options}
          selected={[payer]}
          onChange={([id]) => {
            setUndo(null);
            setPayer(id);
          }}
          multi={false}
        />
        <div className="xs dim">Every item starts shared by everyone. Tap the green names to change who had it.</div>
        {/* Always there (Artifact B6), so nothing below it moves when voice starts. */}
        <div className="voice" role="status">
          {voice.state.k === "listening" ? (
            <span className="dim xs">Listening…</span>
          ) : voice.state.k === "working" ? (
            <span className="dim xs">Working it out…</span>
          ) : voice.state.k === "done" ? (
            <Heard r={voice.state.result} />
          ) : (
            <span className="dim xs">{note ?? "Tap the mic and say who had what"}</span>
          )}
        </div>
        <div className="ihead">
          <span className="grow">Item</span>
          <span style={{ width: 88, textAlign: "right" }}>Price</span>
          <span style={{ width: 92, textAlign: "right" }}>Shared by (tap)</span>
        </div>
        <div className="items">
          {rows.map((r, i) => {
            if (r.kind === "item") pos++;
            const sub = r.kind === "discount" ? `follows ${pos}` : r.kind === "surcharge" ? "fee, shared in proportion" : "";
            return (
              // Editing a row shows Remove under its name; it stays until another row is edited, never
              // ending on blur (Safari does not focus a clicked button, so blur cannot tell a click on
              // Remove from leaving the row). The names button never moves, so a tap on it is never a Remove.
              <div key={r.key} className={`${r.kind === "item" ? "it" : "it sub"}${flash.has(r.key) ? " flash" : ""}`}>
                <span className="pos">{r.kind === "item" ? pos : ""}</span>
                <span className="nm">
                  <input
                    className="plain"
                    value={r.name}
                    placeholder="Item name"
                    maxLength={MAX_NAME}
                    aria-label={`Line ${pos} name`}
                    autoFocus={editing === r.key}
                    onFocus={() => setEditing(r.key)}
                    onChange={(e) => update(r.key, { name: e.target.value })}
                  />
                  {sub && <span className="xs dim">{sub}</span>}
                  {r.kind === "item" && <span className="xs dim num">{r.set.length > 1 ? `${formatCents(eachCents(lines, i))} each` : "all of it"}</span>}
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
                  ok={(v) => Math.abs(v) <= MAX_BILL_CENTS && (r.kind === "discount" ? v < 0 : v >= 0)}
                />
                {r.kind === "item" ? (
                  <PeoplePicker
                    chip
                    label={`Who had ${r.name.trim() || "item"}`}
                    text={setLabel(r.set, on, meId)}
                    title={`Who had ${r.name.trim() || "this item"}?`}
                    options={options}
                    selected={r.set}
                    onChange={(set) => {
                      setUndo(null);
                      update(r.key, { set });
                    }}
                    everyone
                  />
                ) : (
                  <span className="who none" aria-hidden="true">
                    Everyone
                  </span>
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
        <div className="owebar m3">
          <div style={{ minWidth: 0 }}>
            <div className="xs dim">{foot.who}</div>
            <div className={foot.cents > 0 ? `amt num ${foot.owe ? "owe" : "owed"}` : "amt num dim"}>{formatCents(foot.cents)}</div>
            <div className="fbs num">
              {on
                .filter((p) => p.id !== payer)
                .map((p) => (
                  <button key={p.id} type="button" className="fb" disabled={locked} onClick={(ev) => {
                      infoBox.current = ev.currentTarget;
                      setInfo(p.id);
                    }}>
                    {nm(p)} {formatCents(o[p.id] ?? 0)} ›
                  </button>
                ))}
            </div>
          </div>
          <button
            type="button"
            className={voice.state.k === "listening" ? "mic live" : "mic"}
            aria-label={voice.state.k === "listening" ? "Stop and work out the split" : "Speak the split"}
            aria-pressed={voice.state.k === "listening"}
            disabled={locked || voice.state.k === "working" || !rows.some((r) => r.kind === "item")}
            onClick={() => {
              if (undo) setUndo(null); // speaking again keeps the last change
              setNote(null);
              voice.toggle();
            }}
          >
            <Icon name="mic" size={20} />
          </button>
          <button type="button" className="btn sm" style={{ flex: "none" }} disabled={!canSave} onClick={save}>
            {saving ? "Saving…" : saveError?.retry ? "Retry" : "Save"}
          </button>
        </div>
        {undo && (
          <div className="row" inert={locked}>
            <button type="button" className="btn sm grow" onClick={() => settle(false)}>
              Keep
            </button>
            <button type="button" className="btn ghost sm grow" onClick={() => settle(true)}>
              Undo
            </button>
          </div>
        )}
      </div>
      {/* Outside the footer: the panel is placed against the screen, and a sticky footer would be its frame. */}
      {bv && (
        <Panel anchor={infoBox} title={`${bv.head} ${formatCents(bv.total)}`} done onClose={() => setInfo(null)}>
          <div className="row">
            <span className="ddt">
              {bv.head} {formatCents(bv.total)}
            </span>
          </div>
          {bv.rows.map((x, i) => (
            <div key={i} className="bd">
              <span>
                {x.label}
                {x.n > 1 && <span className="dim"> ÷{x.n}</span>}
              </span>
              <span className="num">{formatCents(x.cents)}</span>
            </div>
          ))}
          {bv.rounding && (
            <div className="bd">
              <span>Rounding</span>
              <span className="num">{bv.rounding}</span>
            </div>
          )}
          <div className="bd tot">
            <span>{bv.head}</span>
            <span className="num">{formatCents(bv.total)}</span>
          </div>
          {bv.not && <div className="xs dim">{bv.not}</div>}
        </Panel>
      )}
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

// What the voice call came back with.
function Heard({ r }: { r: VoiceResult }) {
  if (!r.ok) {
    return <span className="xs">{r.error === "ai_paused" && r.until ? `Voice is paused until ${clock(r.until)}, use the buttons` : r.message}</span>;
  }
  return (
    <>
      <span className="dim xs">{r.changes.length ? "Heard:" : "Didn't catch any items - try again"}</span>
      {r.transcript && <q>{r.transcript}</q>}
      {r.dropped.length > 0 && (
        <span className="xs">
          No item {r.dropped.join(", ")} on this bill - left out
        </span>
      )}
    </>
  );
}
