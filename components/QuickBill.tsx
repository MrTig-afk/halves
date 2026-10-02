"use client";

// A bill without a receipt (Artifact lane D, H): what it was, how much, who is on it, who paid and
// who shares it. Saved as an ordinary bill with one line named as the bill - no photo, no AI reading.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { PeoplePicker } from "@/components/PeoplePicker";
import type { Partner, SavedBill } from "@/components/Review";
import { Saved } from "@/components/Saved";
import { useSave } from "@/components/useSave";
import { today, uuid } from "@/lib/api";
import { MAX_BILL_CENTS } from "@/lib/bill";
import { typedFoot, typedHint } from "@/lib/billview";
import { formatCents, parseCents } from "@/lib/money";
import { firstName, shortDate } from "@/lib/names";
import { owes, regroup, setLabel } from "@/lib/split";

const noChange = () => () => {};
// The scan id of a save that may have reached the server, kept on this phone (even when the app is
// closed) until its outcome is known. The next bill goes out under it: if the first save landed,
// the server answers with that stored bill instead of saving a second one.
const PENDING = "halves:add-pending";
const pendingId = () => {
  try {
    return localStorage.getItem(PENDING);
  } catch {
    return null; // the server, or storage blocked
  }
};
const remember = (id: string | null) => {
  try {
    if (id) localStorage.setItem(PENDING, id);
    else localStorage.removeItem(PENDING);
  } catch {}
};

// `people`: everyone, you first then by id; `start`: who the bill starts with (lib/people.ts billPeople).
export function QuickBill({ meId, people, start }: { meId: number; people: Partner[]; start: number[] }) {
  const router = useRouter();
  const [scanId, setScanId] = useState(() => pendingId() ?? uuid()); // one per bill: a retried Save can never add it twice
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  // Until a date is picked, today on this phone's clock - never the server's, which renders in UTC
  // and is still on yesterday in an Australian morning.
  const [picked, setPicked] = useState<string | null>(null);
  const now = useSyncExternalStore(noChange, today, () => "");
  const date = picked ?? now;
  const [onBill, setOnBill] = useState(start);
  const [payer, setPayer] = useState(meId);
  const [split, setSplit] = useState(start); // Shared by
  const [saved, setSaved] = useState<SavedBill | null>(null);
  const names = Object.fromEntries(people.map((p) => [p.id, p.name]));
  const { saving, error: saveError, setError: setSaveError, send } = useSave((s) => setSaved({ saved: s, names }));

  const on = people.filter((p) => onBill.includes(p.id));
  const nm = (p: Partner) => (p.id === meId ? "You" : firstName(p.name));
  const options = on.map((p) => ({ id: p.id, name: nm(p) }));
  // Parsed on every keystroke, not on blur: Safari does not move focus to a tapped button.
  const parsed = parseCents(amount);
  const cents = parsed !== null && parsed > 0 && parsed <= MAX_BILL_CENTS ? parsed : null;
  // Name order breaks a one-cent tie, as on the server.
  const byName = [...on].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id - b.id).map((p) => p.id);
  const o = cents === null ? {} : owes([{ price_cents: cents, kind: "item", people: split }], byName, payer, cents);
  const foot = typedFoot(o, on, payer, meId);
  // After a failure that may have reached the server, nothing can change: Retry sends exactly this.
  const locked = saving || !!saveError?.retry;
  const canSave = !saving && description.trim() !== "" && cents !== null && date !== "" && split.some((q) => q !== payer);

  const save = async (id = scanId): Promise<void> => {
    if (cents === null) return;
    remember(id);
    const name = description.trim();
    await send(
      {
        scan_id: id,
        people: onBill,
        payer_id: payer,
        description: name,
        date,
        total_cents: cents,
        lines: [{ name, price_cents: cents, kind: "item", people: split }],
        ai: null,
        typed: true,
        date_edited: false,
        total_edited: false,
      },
      null,
      {
        lines: false,
        first: (r) => {
          // An answer settles the id. A conflict means it is someone else's (left by whoever used this
          // phone before): nothing was saved, so this bill goes again under its own. Any other refusal
          // comes before the save and leaves the id's outcome open, so it is kept.
          if (!r.ok && r.error === "conflict") {
            remember(null);
            const fresh = uuid();
            setScanId(fresh);
            void save(fresh);
            return true;
          }
          if (r.ok) remember(null);
          if (r.ok && r.duplicate && !r.same) {
            // An earlier, different bill held the id: that one is saved, this one is not yet.
            setScanId(uuid());
            setSaveError({ text: `Your earlier bill "${r.description}" ${formatCents(r.total_cents)} was saved. This one isn't yet - tap Save.`, retry: false });
            return true;
          }
          if (!r.ok && r.retryable) setPicked(date); // Retry sends exactly this, even after midnight
        },
      },
    );
  };

  if (saved) {
    const again = () => {
      setScanId(uuid());
      setDescription("");
      setAmount("");
      setPicked(null);
      setPayer(meId);
      setSplit(onBill); // the same people, everyone sharing
      setSaved(null);
    };
    return <Saved s={saved} again={again} done={() => router.push("/")} againLabel="Add another" />;
  }

  return (
    <main className="screen">
      <div className="bar">
        {/* Always works, even while a save is unanswered: the pending scan id stays on the phone (userflow D3). */}
        <Link href="/" className="back">
          ‹ Home
        </Link>
        <span className="ttl">New bill</span>
      </div>
      <div className="body" style={{ gap: 9 }} inert={locked}>
        {saveError && (
          <div className="banner amber" role="alert">
            {saveError.text}
          </div>
        )}
        <div className="field">
          <div className="row center-y">
            <label className="xs dim grow" htmlFor="qb-description">
              Description
            </label>
            {/* The date reads "Today" / "27 Sep"; the real date box lies invisibly over it, so a tap opens the phone's own picker. */}
            <label className="xs dim num" style={{ position: "relative" }}>
              {date === "" || date === now ? "Today" : shortDate(date)}
              <input
                className="plain"
                type="date"
                style={{ position: "absolute", inset: 0, width: "100%", opacity: 0 }}
                value={date}
                aria-label="Date"
                onClick={(e) => {
                  try {
                    e.currentTarget.showPicker?.();
                  } catch {} // already opening, or not allowed here: the tap opens the picker anyway
                }}
                onChange={(e) => setPicked(e.target.value || null)} // cleared: back to today, never a blank date
              />
            </label>
          </div>
          {/* Control characters (a pasted tab) are refused by the server; they become spaces here. */}
          <input
            id="qb-description"
            className="plain b"
            value={description}
            placeholder="What was it?"
            maxLength={60}
            autoFocus
            onChange={(e) => setDescription(e.target.value.replace(/[\u0000-\u001f\u007f]/g, " "))}
          />
        </div>
        <label className="field">
          <span className="xs dim">Amount</span>
          <span className="row center-y" style={{ gap: 2 }}>
            <b className="amount-in">$</b>
            <input className="plain b num amount-in" inputMode="decimal" value={amount} placeholder="0.00" onChange={(e) => setAmount(e.target.value)} />
          </span>
        </label>
        <PeoplePicker
          label="Who's on it"
          text={on.map(nm).join(", ")}
          title="Who's on this bill?"
          options={people.map((p) => ({ id: p.id, name: nm(p), locked: p.id === meId }))}
          selected={onBill}
          onChange={(sel) => {
            setSplit(regroup(split, onBill, sel));
            if (!sel.includes(payer)) setPayer(meId);
            setOnBill(sel);
          }}
          min={2}
          minText="Add at least one other person."
          max={5}
          maxText="A bill can have up to 5 people."
          note="Up to 5 people."
        />
        <PeoplePicker label="Who paid" text={nm(on.find((p) => p.id === payer) ?? on[0])} title="Who paid?" options={options} selected={[payer]} onChange={([id]) => setPayer(id)} multi={false} />
        <PeoplePicker label="Shared by" text={setLabel(split, on, meId)} title="Shared by" options={options} selected={split} onChange={setSplit} everyone />
        {/* With an amount, who pays what; without one, only "Nothing to split" (it is why Save stays grey). */}
        {(cents !== null || !split.some((q) => q !== payer)) && <div className="xs dim">{typedHint(split, payer, meId, on)}</div>}
      </div>
      <div className="foot">
        <div className="owebar">
          <div style={{ minWidth: 0 }}>
            <div className="xs dim">{foot.who}</div>
            <div className={foot.cents > 0 ? `amt num ${foot.owe ? "owe" : "owed"}` : "amt num dim"}>{formatCents(foot.cents)}</div>
            {cents !== null && <div className="xs dim num">{foot.each}</div>}
          </div>
          <button type="button" className="btn sm" style={{ flex: "none" }} disabled={!canSave} onClick={() => save()}>
            {saving ? "Saving…" : saveError?.retry ? "Retry" : "Save"}
          </button>
        </div>
      </div>
    </main>
  );
}
