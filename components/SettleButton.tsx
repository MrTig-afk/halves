"use client";

// Settle all, with its confirm sheet. The sheet sends the amount it showed; the server settles
// only if that is still the balance, otherwise it answers with the new one to confirm again.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatCents } from "@/lib/money";

export function SettleButton({ partnerId, partner, balance: shown, open }: { partnerId: number; partner: string; balance: number; open: number }) {
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
        router.refresh();
        if (body.balance === 0) return setSheet(false); // the other person settled first
        setBalance(body.balance);
        setChanged(true);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      setSheet(false);
      router.refresh();
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
        Settle all
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
              <span className="small dim">
                Clears {open} open {open === 1 ? "bill" : "bills"}. The balance goes to $0.00 for both of you. This can&apos;t be undone.
              </span>
            )}
            {error && (
              <div className="banner amber" role="alert">
                {error}
              </div>
            )}
            <button type="button" className="btn" disabled={busy} onClick={settle}>
              {busy ? "Settling…" : "Settle all"}
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
