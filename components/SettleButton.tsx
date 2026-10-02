"use client";

// Settle all / Settle up with one person, with its confirm sheet (the caller gives the texts and
// where to go afterwards). The sheet sends the amount it showed; the server settles only if that is
// still the balance, otherwise it answers with the new one to confirm again.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatCents } from "@/lib/money";

export function SettleButton({
  partnerId,
  partner,
  balance: shown,
  label,
  note,
  confirm,
  after,
}: {
  partnerId: number;
  partner: string;
  balance: number;
  label: string; // the button on the page
  note: string; // under the amount in the sheet
  confirm: string; // the sheet's button
  after?: string; // where to go once settled; stays put when absent
}) {
  const router = useRouter();
  const [sheet, setSheet] = useState(false);
  // What the sheet asks the person to confirm; a changed tab replaces it with the server's figure.
  const [balance, setBalance] = useState(shown);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A native modal dialog: focus moves into it and stays there, Escape closes it, and the page
  // behind is inert - the basics for an action that cannot be undone.
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (sheet) dialog.current?.showModal();
  }, [sheet]);

  const settle = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ partner_id: partnerId, expected: balance }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 401) return router.replace("/signin");
      if (res.status === 409) {
        // A bill arrived since the sheet opened: show the new amount and ask again.
        const body = await res.json();
        if (body.balance === 0) {
          // The other person settled first: the same end as settling here.
          setSheet(false);
          if (after) router.replace(after);
          else router.refresh();
          return;
        }
        router.refresh();
        setBalance(body.balance);
        setChanged(true);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      setSheet(false);
      // replace, not push: Back must not return to the tab as it was before settling.
      if (after) router.replace(after);
      else router.refresh();
    } catch {
      setError("Couldn't settle. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn sm settle"
        onClick={() => {
          setBalance(shown);
          setChanged(false);
          setSheet(true);
        }}
      >
        {label}
      </button>
      {sheet && (
        <dialog
          ref={dialog}
          className="sheet"
          aria-label={`Settle up with ${partner}`}
          onCancel={(e) => (busy ? e.preventDefault() : setSheet(false))}
          onClick={(e) => e.target === e.currentTarget && !busy && setSheet(false) /* a tap on the backdrop */}
        >
          <div className="sheet-in">
            <div className="grab" />
            <b>Settle up with {partner}?</b>
            <div className={`num tab-amt ${balance > 0 ? "owed" : "owe"}`}>
              {balance > 0 ? `${partner} pays you ${formatCents(balance)}` : `You pay ${partner} ${formatCents(-balance)}`}
            </div>
            {changed ? (
              <div className="banner amber" role="alert">
                The tab changed since this opened, so the amount is different now. Check it and settle again.
              </div>
            ) : (
              <span className="small dim">{note}</span>
            )}
            {error && (
              <div className="banner amber" role="alert">
                {error}
              </div>
            )}
            <button type="button" className="btn" disabled={busy} onClick={settle}>
              {busy ? "Settling…" : confirm}
            </button>
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setSheet(false)}>
              Cancel
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}
