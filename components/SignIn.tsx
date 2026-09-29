"use client";

// Sign-in: one tile per person, a PIN pad, choose-a-PIN (twice), and the lockout countdown.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { initial } from "@/lib/names";

export type Tile = { id: number; name: string; admin: boolean; claimed: boolean };

type Step =
  | { k: "tiles" }
  | { k: "pin"; tile: Tile; message?: string; shake?: boolean; n?: number }
  | { k: "set"; tile: Tile; first?: string; message?: string; n?: number }
  | { k: "locked"; tile: Tile; until: number };

type Answer = { ok?: boolean; error?: string; triesLeft?: number; lockedUntil?: string };

async function send(path: string, personId: number, pin: string): Promise<Answer> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ personId, pin }) });
    return (await res.json().catch(() => ({ error: "internal" }))) as Answer;
  } catch {
    return { error: "network" };
  }
}


export function SignIn({ tiles, next }: { tiles: Tile[]; next: string }) {
  const router = useRouter(); // next: Home, or a deep link the page already checked
  const [step, setStep] = useState<Step>({ k: "tiles" });
  const [busy, setBusy] = useState(false);

  const open = (tile: Tile) => setStep(tile.claimed ? { k: "pin", tile } : { k: "set", tile });
  const signedIn = () => {
    router.replace(next);
    router.refresh();
  };

  const entered = async (pin: string) => {
    if (step.k === "set") {
      if (!step.first) return setStep({ ...step, first: pin, message: undefined });
      if (pin !== step.first) return setStep({ k: "set", tile: step.tile, message: "Those didn't match. Choose a PIN again." });
    }
    if (step.k !== "pin" && step.k !== "set") return;
    setBusy(true);
    const a = await send(step.k === "set" ? "/api/auth/claim" : "/api/auth/pin", step.tile.id, pin);
    setBusy(false);
    if (a.ok) return signedIn();
    if (a.error === "locked" && a.lockedUntil) return setStep({ k: "locked", tile: step.tile, until: Date.parse(a.lockedUntil) });
    if (a.error === "wrong_pin") {
      const n = a.triesLeft ?? 0;
      return setStep({ k: "pin", tile: step.tile, message: `Wrong PIN. ${n} ${n === 1 ? "try" : "tries"} left.`, shake: true, n: Date.now() });
    }
    if (a.error === "claimed") return setStep({ k: "pin", tile: { ...step.tile, claimed: true }, message: "Someone just set this tile's PIN. Enter it to sign in.", n: Date.now() });
    if (a.error === "unclaimed") return setStep({ k: "set", tile: { ...step.tile, claimed: false }, message: "This tile was reset. Choose a new PIN.", n: Date.now() });
    const message =
      a.error === "network"
        ? "Couldn't reach Halves. Check your connection."
        : a.error === "changed"
          ? "This tile's PIN just changed. Try again."
          : "Something went wrong. Try again.";
    // Every answer gets a fresh pad (new n -> new key), so a digit typed next never resends the old PIN.
    setStep(step.k === "set" ? { k: "set", tile: step.tile, message, n: Date.now() } : { k: "pin", tile: step.tile, message, n: Date.now() });
  };

  if (step.k === "locked") return <Locked tile={step.tile} until={step.until} back={() => setStep({ k: "tiles" })} />;

  if (step.k === "pin" || step.k === "set") {
    const title = step.k === "pin" ? "Enter your PIN" : step.first ? "Enter it again" : `Hi ${step.tile.name}, choose a PIN`;
    return (
      <main className="screen">
        <div className="bar">
          <button type="button" className="back" onClick={() => setStep({ k: "tiles" })}>
            ‹ Back
          </button>
        </div>
        <div className="center pin-head">
          <span className="av big" data-admin={step.tile.admin || undefined}>
            {initial(step.tile.name)}
          </span>
          <b>{title}</b>
          {step.k === "set" && !step.first && <span className="dim small">4 digits. You&apos;ll need it on each new device.</span>}
        </div>
        <PinPad
          key={`${step.k}-${step.k === "set" ? step.first ?? "" : ""}-${step.n ?? 0}`}
          busy={busy}
          shake={step.k === "pin" && !!step.shake}
          message={step.message}
          onDone={entered}
        />
      </main>
    );
  }

  return (
    <main className="screen">
      <div className="center signin-head">
        <span className="logo" style={{ fontSize: 24 }}>
          <span className="mark" style={{ width: 30, height: 30 }} />
          Halves
        </span>
        <div className="dim small">Who&apos;s splitting?</div>
        <div className="tiles">
          {tiles.map((t) => (
            <button key={t.id} type="button" className={t.claimed ? "tile" : "tile new"} onClick={() => open(t)}>
              <span className="av big" data-admin={t.admin || undefined} data-new={!t.claimed || undefined}>
                {initial(t.name)}
              </span>
              {t.name}
              {t.admin ? <span className="xs dim">Admin</span> : !t.claimed && <span className="xs owed">Tap to set up</span>}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}

export function PinPad({ busy, shake, message, onDone }: { busy: boolean; shake: boolean; message?: string; onDone: (pin: string) => void }) {
  const [pin, setPin] = useState("");
  const press = (k: string) => {
    if (busy) return;
    if (k === "⌫") return setPin((p) => p.slice(0, -1));
    const next = (pin + k).slice(0, 4);
    setPin(next);
    if (next.length === 4) onDone(next);
  };
  return (
    <>
      <div className={shake ? "dots shake" : "dots"} aria-label={`${pin.length} of 4 digits entered`}>
        {[0, 1, 2, 3].map((i) => (
          <i key={i} className={i < pin.length ? "on" : undefined} />
        ))}
      </div>
      <div className="pin-msg owe small" role="alert">
        {message ?? " "}
      </div>
      <div className="pad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((k, i) =>
          k ? (
            <button key={i} type="button" className="key" onClick={() => press(k)} aria-label={k === "⌫" ? "Delete" : k}>
              {k}
            </button>
          ) : (
            <span key={i} />
          ),
        )}
      </div>
    </>
  );
}

function Locked({ tile, until, back }: { tile: Tile; until: number; back: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  return (
    <main className="screen">
      <div className="center">
        <div className="icon-art">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect width="18" height="11" x="3" y="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <b>{tile.name}&apos;s tile is locked</b>
        <div className="num" style={{ fontSize: 26, fontWeight: 800 }}>
          {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
        </div>
        <span className="dim small">Too many wrong PINs. Try again when the timer ends, or ask the admin to reset your PIN.</span>
      </div>
      <div className="foot">
        <button type="button" className="btn ghost sm" onClick={back}>
          Back to tiles
        </button>
      </div>
    </main>
  );
}
