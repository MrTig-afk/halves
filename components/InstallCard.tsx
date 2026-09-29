"use client";

// The Home install card (A3) until the app is installed. Android/Chrome: the browser's own install
// prompt. iPhone (no prompt exists): the Share -> Add to Home Screen steps (A4). Never a popup on
// its own: nothing happens until the card is tapped.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/Icon";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

// The browser offers the prompt once, possibly before any app code has loaded: an inline script in
// the root layout keeps it on window.__bip, and this module picks it up, then listens itself.
type Held = Window & { __bip?: InstallPrompt };
let offered: InstallPrompt | null = typeof window === "undefined" ? null : ((window as Held).__bip ?? null);
let installed = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // no mini-infobar: the card is the only way in
    offered = e as InstallPrompt;
    changed();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    offered = null;
    changed();
  });
}

type Mode = "hidden" | "prompt" | "ios";
function mode(): Mode {
  const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  if (installed || standalone) return "hidden";
  if (offered) return "prompt";
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios ? "ios" : "hidden";
}
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export function InstallCard() {
  const m = useSyncExternalStore(subscribe, mode, () => "hidden" as Mode);
  const [steps, setSteps] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (steps) dialog.current?.showModal();
  }, [steps]);
  if (m === "hidden") return null;

  const open = async () => {
    const p = offered;
    if (m === "ios" || !p) return setSteps(true);
    offered = null; // a prompt can be used once
    (window as Held).__bip = undefined;
    changed();
    try {
      await p.prompt();
      if ((await p.userChoice).outcome === "accepted") installed = true;
    } catch {
      // already used, or refused by the browser: the card comes back on the next page load
    }
    changed();
  };

  return (
    <>
      <button type="button" className="soft row center-y install" onClick={open}>
        <span className="owed">
          <Icon name="phone" size={24} />
        </span>
        <span className="grow small">
          <b>Add Halves to your home screen</b>
          <span className="dim xs block">Opens straight to the camera next time.</span>
        </span>
      </button>
      {steps && (
        <dialog ref={dialog} className="sheet" aria-label="Install Halves on iPhone" onClose={() => setSteps(false)}>
          <div className="sheet-in">
            <div className="grab" />
            <b>Install Halves on iPhone</b>
            <div className="small">
              1. Tap <b>Share</b> <span className="dim">(square with arrow)</span>
            </div>
            <div className="small">
              2. Tap <b>Add to Home Screen</b>
            </div>
            <div className="small">3. Open Halves from your home screen</div>
            <div className="dim xs">Android and Chrome show an Install button instead.</div>
            <button type="button" className="btn" onClick={() => dialog.current?.close()}>
              Got it
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}

