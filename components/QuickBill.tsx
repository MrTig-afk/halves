"use client";

// A bill without a receipt (Artifact lane D): what it was, how much, split equally or owed in
// full. Saved as an ordinary bill with one line named as the bill - no photo, no AI reading.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import type { Partner, SavedBill } from "@/components/Review";
import { Saved, today, uuid } from "@/components/ScanFlow";
import { postBill } from "@/lib/api";
import { MAX_BILL_CENTS } from "@/lib/bill";
import { formatCents, parseCents } from "@/lib/money";
import { firstName } from "@/lib/names";
import { partnerOwes } from "@/lib/split";

type Share = "split" | "partner";
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

export function QuickBill({ meId, partners }: { meId: number; partners: Partner[] }) {
  const router = useRouter();
  const [scanId, setScanId] = useState(() => pendingId() ?? uuid()); // one per bill: a retried Save can never add it twice
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  // Until a date is picked, today on this phone's clock - never the server's, which renders in UTC
  // and is still on yesterday in an Australian morning.
  const [picked, setPicked] = useState<string | null>(null);
  const now = useSyncExternalStore(noChange, today, () => "");
  const date = picked ?? now;
  const [partnerId, setPartnerId] = useState(partners[0]?.id ?? 0);
  const [share, setShare] = useState<Share>("split");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{ text: string; retry: boolean } | null>(null);
  const [saved, setSaved] = useState<SavedBill | null>(null);

  const partner = partners.find((p) => p.id === partnerId);
  const partnerName = partner ? firstName(partner.name) : "your partner";
  // Parsed on every keystroke, not on blur: Safari does not move focus to a tapped button.
  const parsed = parseCents(amount);
  const cents = parsed !== null && parsed > 0 && parsed <= MAX_BILL_CENTS ? parsed : null;
  const owes = cents === null ? 0 : partnerOwes([{ price_cents: cents, kind: "item", share }], cents);
  // After a failure that may have reached the server, nothing can change: Retry sends exactly this.
  const locked = saving || !!saveError?.retry;
  const canSave = !saving && !!partner && description.trim() !== "" && cents !== null && date !== "";

  const save = async (id = scanId) => {
    if (cents === null) return;
    setSaving(true);
    setSaveError(null);
    remember(id);
    const name = description.trim();
    const r = await postBill(
      {
        scan_id: id,
        people: [meId, partnerId],
        payer_id: meId,
        description: name,
        date,
        total_cents: cents,
        lines: [{ name, price_cents: cents, kind: "item", people: share === "split" ? [meId, partnerId] : [partnerId] }],
        ai: null,
        typed: true,
        date_edited: false,
        total_edited: false,
      },
      null,
    );
    setSaving(false);
    // An answer settles the id. A conflict means it is someone else's (left by whoever used this
    // phone before): nothing was saved, so this bill goes again under its own. Any other refusal
    // comes before the save and leaves the id's outcome open, so it is kept.
    if (!r.ok && r.error === "conflict") {
      remember(null);
      const fresh = uuid();
      setScanId(fresh);
      return save(fresh);
    }
    if (r.ok) remember(null);
    if (r.ok && r.duplicate && !r.same) {
      // An earlier, different bill held the id: that one is saved, this one is not yet.
      setScanId(uuid());
      return setSaveError({ text: `Your earlier bill "${r.description}" ${formatCents(r.total_cents)} was saved. This one isn't yet - tap Save.`, retry: false });
    }
    if (r.ok) {
      return setSaved({ saved: r, names: Object.fromEntries(partners.map((p) => [p.id, p.name])) });
    }
    if (r.error === "signed_out") return router.replace("/signin");
    if (r.retryable) setPicked(date); // Retry sends exactly this, even after midnight
    setSaveError(r.retryable ? { text: "Couldn't save. Check your connection and try again. Nothing you entered is lost.", retry: true } : { text: r.message, retry: false });
  };

  if (saved) {
    const again = () => {
      setScanId(uuid());
      setDescription("");
      setAmount("");
      setPicked(null);
      setShare("split");
      setSaved(null);
    };
    return <Saved s={saved} again={again} done={() => router.push("/")} againLabel="Add another" />;
  }

  return (
    <main className="screen">
      <div className="bar">
        <Link href="/" className="back">
          ‹ Home
        </Link>
        <span className="ttl">New bill</span>
      </div>
      <div className="body" style={{ gap: 10 }} inert={locked}>
        {saveError && (
          <div className="banner amber" role="alert">
            {saveError.text}
          </div>
        )}
        <label className="field">
          <span className="xs dim">Description</span>
          <input className="plain b" value={description} placeholder="What was it?" maxLength={60} autoFocus onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="field">
          <span className="xs dim">Amount</span>
          <span className="row center-y" style={{ gap: 2 }}>
            <b className="amount-in">$</b>
            <input className="plain b num amount-in" inputMode="decimal" value={amount} placeholder="0.00" onChange={(e) => setAmount(e.target.value)} />
          </span>
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
          <span className="grow" />
          <input className="plain dim num" type="date" value={date} onChange={(e) => setPicked(e.target.value)} aria-label="Date" />
        </div>
        <div className="lbl">How to split</div>
        <div className="row" role="group" aria-label="How to split">
          <button type="button" className={share === "split" ? "btn sm grow" : "btn ghost sm grow"} aria-pressed={share === "split"} onClick={() => setShare("split")}>
            Split equally
          </button>
          <button type="button" className={share === "partner" ? "btn sm grow" : "btn ghost sm grow"} aria-pressed={share === "partner"} onClick={() => setShare("partner")}>
            {partnerName} owes it all
          </button>
        </div>
        <div className="xs dim">You paid. {partnerName} adds the bills they paid from their own phone.</div>
      </div>
      <div className="foot">
        <div className="owebar">
          <div>
            <div className="xs dim">{partnerName} owes you</div>
            <div className={cents === null ? "amt num dim" : "amt owed num"}>{formatCents(owes)}</div>
          </div>
          <button type="button" className="btn sm" style={{ flex: "none" }} disabled={!canSave} onClick={() => save()}>
            {saving ? "Saving…" : saveError?.retry ? "Retry" : "Save"}
          </button>
        </div>
      </div>
    </main>
  );
}
