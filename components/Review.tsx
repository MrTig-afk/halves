"use client";

// The review screen: name the bill, pick who it is with, and set each item's share with a
// 3-position slider (mine / half / partner's). Any name or price can be tapped and edited.
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useVoice } from "@/components/useVoice";
import { useRouter } from "next/navigation";
import { clock, postBill, saveFailure, type VoiceResult } from "@/lib/api";
import { MAX_NAME, type ReceiptReading } from "@/lib/receipt";
import { MAX_BILL_CENTS, type Saved } from "@/lib/bill";
import { formatCents, parseCents } from "@/lib/money";
import { firstName as first, initial } from "@/lib/names";
import type { LineKind } from "@/lib/receipt";
import { partnerOwes, type Share } from "@/lib/split";

export type Partner = { id: number; name: string };
export type Row = { key: number; name: string; price_cents: number; kind: LineKind; share: Share };
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

const ORDER: Share[] = ["payer", "split", "partner"];
type Snapshot = { shares: Map<number, Share>; partnerId: number | null }; // what a voice change replaced
let nextKey = 1_000_000;

export function Review({
  me,
  meId,
  partners,
  draft,
  onBack,
  onSaved,
}: {
  me: string;
  meId: number;
  partners: Partner[];
  draft: Draft;
  onBack: () => void;
  onSaved: (s: SavedBill) => void;
}) {
  const router = useRouter();
  const [description, setDescription] = useState(draft.description);
  const [date, setDate] = useState(draft.date);
  const [partnerId, setPartnerId] = useState(partners[0]?.id ?? 0);
  const [rows, setRows] = useState(draft.rows);
  const [total, setTotal] = useState(draft.total_cents);
  const [editing, setEditing] = useState<number | null>(null);
  const partner = partners.find((p) => p.id === partnerId);
  const partnerName = partner ? first(partner.name) : "your partner";
  const owes = partnerOwes(rows, total);

  // Voice: the item numbers the AI answers with map to the rows as they were when sent. A change
  // is applied at once (sliders animate, rows flash) and Undo puts back exactly what it replaced.
  const sent = useRef<number[]>([]);
  const [flash, setFlash] = useState<Set<number>>(new Set());
  const [undo, setUndo] = useState<Snapshot | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const now = useRef({ rows, partnerId }); // the committed state, for building the Undo snapshot
  useEffect(() => {
    now.current = { rows, partnerId };
  });
  const heard = (r: VoiceResult) => {
    if (!r.ok || (!r.changes.length && r.partner === null)) return;
    const share = new Map(r.changes.map((c) => [sent.current[c.item - 1], c.share]));
    const before: Snapshot = { shares: new Map(), partnerId: null };
    setRows(
      now.current.rows.map((row) => {
        const s = share.get(row.key);
        if (!s || row.kind !== "item") return row;
        before.shares.set(row.key, row.share);
        return { ...row, share: s };
      }),
    );
    if (r.partner !== null && r.partner !== now.current.partnerId) {
      before.partnerId = now.current.partnerId;
      setPartnerId(r.partner);
    }
    setUndo(before);
    setFlash(new Set(share.keys()));
    setTimeout(() => setFlash(new Set()), 1400);
  };
  const voice = useVoice(() => {
    const items = rows.filter((r) => r.kind === "item");
    sent.current = items.map((r) => r.key);
    return items.map((r, i) => r.name.trim() || `Item ${i + 1}`);
  }, heard);
  const settle = (restore: boolean) => {
    if (restore && undo) {
      setRows((rs) => rs.map((r) => (undo.shares.has(r.key) ? { ...r, share: undo.shares.get(r.key)! } : r)));
      if (undo.partnerId !== null) setPartnerId(undo.partnerId);
    }
    setUndo(null);
    voice.reset();
    setNote(restore ? "Undone. Tap the mic and say which items are shared." : "Applied. Tap the mic to change more.");
  };

  // Save sends the lines and the total; the server works out what is owed. A failure keeps
  // everything on screen, and Retry sends the same bill again.
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{ text: string; retry: boolean } | null>(null);
  const save = async () => {
    if (rows.reduce((s, r) => s + Math.abs(r.price_cents), 0) > MAX_BILL_CENTS) {
      return setSaveError({ text: "A bill can be at most $100,000. Check the prices.", retry: false });
    }
    setSaving(true);
    setSaveError(null);
    const r = await postBill(
      {
        scan_id: draft.scan_id,
        people: [meId, partnerId],
        payer_id: meId,
        description: description.trim(),
        date,
        total_cents: total,
        lines: rows.map((row) => ({
          name: row.name.trim() || (row.kind === "item" ? "Item" : row.kind === "discount" ? "Discount" : "Fee"),
          price_cents: row.price_cents,
          kind: row.kind,
          people: row.kind !== "item" ? null : row.share === "payer" ? [meId] : row.share === "split" ? [meId, partnerId] : [partnerId],
        })),
        ai: draft.ai,
        typed: false,
        date_edited: false, // T7 sends the real signals; edited() still compares a read date and total
        total_edited: false,
      },
      draft.photo,
    );
    setSaving(false);
    if (r.ok) {
      // A retried save answers with the bill stored the first time, which is the one to show.
      return onSaved({ saved: r, names: Object.fromEntries(partners.map((p) => [p.id, p.name])) });
    }
    if (r.error === "signed_out") return router.replace("/signin");
    setSaveError(saveFailure(r)); // the same handling as the no-receipt form
  };
  // After a failure that may have reached the server, the bill might already be saved under this
  // scan id: nothing can change and Back is off, so Retry sends exactly what was shown.
  const locked = saving || !!saveError?.retry;
  const busy = saving || voice.state.k === "listening" || voice.state.k === "working";
  const canSave = !busy && !!partner && description.trim() !== "" && date !== "" && rows.some((r) => r.kind === "item");

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
  // A share set by hand after a voice change keeps that change: Undo would otherwise overwrite it.
  const all = (share: Share) => {
    setUndo(null);
    setRows((rs) => rs.map((r) => (r.kind === "item" ? { ...r, share } : r)));
  };
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
    setUndo(null);
    update(r.key, { share });
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
        <label className="field">
          <span className="xs dim">Description</span>
          <input className="plain b" value={description} placeholder="What was it?" onChange={(e) => setDescription(e.target.value)} maxLength={60} />
        </label>
        <div className="row small center-y">
          <span className="dim">With you and</span>
          <select className="plain b" value={partnerId} onChange={(e) => {
              setUndo(null);
              setPartnerId(Number(e.target.value));
            }} aria-label="Split with">
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
          <MoneyInput cents={total} label="Receipt total" allowEmpty placeholder="Total" onChange={setTotal} ok={(v) => v >= 0 && v <= MAX_BILL_CENTS} />
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
        {(voice.state.k !== "idle" || note) && (
          <div className="voice" role="status">
            {voice.state.k === "listening" ? (
              <span className="dim xs">Listening… tap the mic again when you are done</span>
            ) : voice.state.k === "working" ? (
              <span className="dim xs">Working it out…</span>
            ) : voice.state.k === "done" ? (
              <Heard r={voice.state.result} />
            ) : (
              <span className="dim xs">{note}</span>
            )}
          </div>
        )}
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
                  ok={(v) => Math.abs(v) <= MAX_BILL_CENTS && (r.kind === "discount" ? v < 0 : v >= 0)}
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
    return <span className="xs">{r.error === "ai_paused" && r.until ? `Voice is paused until ${clock(r.until)}, use the sliders` : r.message}</span>;
  }
  return (
    <>
      <span className="dim xs">{r.changes.length || r.partner !== null ? "Heard:" : "Didn't catch any items - try again"}</span>
      {r.transcript && <q>{r.transcript}</q>}
      {r.dropped.length > 0 && (
        <span className="xs">
          No item {r.dropped.join(", ")} on this bill - left out
        </span>
      )}
    </>
  );
}
