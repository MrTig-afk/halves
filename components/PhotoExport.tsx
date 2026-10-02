"use client";

// F5: Download zip -> "Did <file> save on your laptop?" -> Yes deletes exactly the photos in that
// zip; No deletes nothing.
import { useRef, useState } from "react";

type Props = { count: number; megabytes: string; usedPercent: number; upto: number; file: string };

export function PhotoExport({ count, megabytes, usedPercent, upto, file }: Props) {
  const [step, setStep] = useState<"start" | "confirm" | "done" | "unsure">("start");
  const [deleted, setDeleted] = useState(0);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false); // Yes and No wait a moment, so a double click on Download presses neither
  const [error, setError] = useState<string | null>(null);
  const token = useRef(0); // names this export; set when Download is pressed
  const form = useRef<HTMLFormElement>(null);
  const tokenField = useRef<HTMLInputElement>(null);
  const arming = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Posts the form into the hidden frame, inside the click itself (a browser only lets a download
  // start from the click). The zip downloads and this screen stays; if it did not, Yes finds nothing
  // stamped and says so - photos are only ever deleted after a whole zip was sent.
  const start = () => {
    setError(null);
    token.current = Date.now(); // a fresh token per export
    if (tokenField.current) tokenField.current.value = String(token.current);
    form.current?.submit();
    setArmed(false);
    setStep("confirm");
    clearTimeout(arming.current);
    arming.current = setTimeout(() => setArmed(true), 2000);
  };

  const confirmDelete = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/photos/archive", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ upto, token: token.current }),
    }).catch(() => null);
    setBusy(false);
    if (!res) {
      // The delete may have gone through with the answer lost on the way back.
      setStep("unsure");
      return setError("Couldn't reach Halves, so this phone can't tell whether the photos were deleted. Reload this page to see what's left.");
    }
    if (!res.ok) return setError("Couldn't delete the photos. Nothing was deleted - try again.");
    const n = (await res.json()).deleted;
    if (n === 0) {
      return setError(
        "Nothing was deleted: the zip hasn't finished downloading. When it has saved, press Yes again. If the download failed, press No and download it again.",
      );
    }
    setDeleted(n);
    setStep("done"); // stays on this message; Settings shows the new count when you go back
  };

  return (
    <>
      <div className="body" style={{ gap: 10 }}>
        {(step === "start" || step === "confirm") && (
          <>
            <div className="soft">
              <b className="num">
                {count} {count === 1 ? "photo" : "photos"} · {megabytes} MB
              </b>
              <div className="xs dim">not exported yet · storage {usedPercent}% used</div>
            </div>
            <div className="small dim">
              Download them as a zip to your laptop. After you confirm it saved, they&apos;re deleted here to free space. Bills keep their
              numbers.
            </div>
          </>
        )}
        {step === "confirm" && (
          <div className="banner amber">
            Did <b>{file}</b> save on your laptop?
          </div>
        )}
        {step === "done" && (
          <div className="banner ok" role="status">
            {deleted} {deleted === 1 ? "photo" : "photos"} deleted. Their bills show &quot;photo archived&quot;.
          </div>
        )}
        {error && (
          <div className="banner amber" role="alert">
            {error}
          </div>
        )}
      </div>
      {/* The export posts here, so an error answer never replaces the app. */}
      <iframe name="photo-export" title="Photo export" hidden />
      <form ref={form} method="post" action="/api/photos/export" target="photo-export" hidden>
        <input type="hidden" name="upto" value={upto} />
        <input type="hidden" name="t" defaultValue="" ref={tokenField} />
      </form>
      <div className="foot">
        {step === "start" && (
          <button type="button" className="btn" onClick={start}>
            Download zip
          </button>
        )}
        {step === "confirm" && (
          <>
            <button type="button" className="btn" disabled={busy || !armed} onClick={confirmDelete}>
              Yes, delete them here
            </button>
            <button type="button" className="btn ghost sm" disabled={busy || !armed} onClick={() => {
                clearTimeout(arming.current);
                setError(null);
                setStep("start");
              }}>
              No, keep them
            </button>
          </>
        )}
      </div>
    </>
  );
}
