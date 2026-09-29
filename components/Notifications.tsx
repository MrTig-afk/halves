"use client";

// Web Push on this phone (PRD 6.7): the Settings switch (F1) and the screen shown on the first
// open after install (A5). On is per phone: this browser's subscription, saved for this session.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/Icon";

type State = "loading" | "on" | "off" | "blocked" | "install" | "unsupported" | "unknown";

const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const installed = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const iPhone = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
// The registration as it is now; `ready` would wait forever when no worker is registered.
const registration = () => navigator.serviceWorker.getRegistration();
const subscription = async () => (await registration())?.pushManager.getSubscription() ?? null;
// On the first open the worker may still be installing: wait for it, but not forever.
const activeRegistration = () =>
  Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, no) => setTimeout(() => no(new Error("no service worker")), 10_000))]);
const ASKED = "halves-notify-asked"; // A5 answered on this phone ("Not now" included)

async function readState(): Promise<State> {
  // Safari on iPhone offers push only to the installed app.
  if (!supported()) return iPhone() && !installed() ? "install" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const sub = Notification.permission === "granted" ? await subscription() : null;
  if (!sub) return "off";
  const r = await fetch(`/api/push?endpoint=${encodeURIComponent(sub.endpoint)}`);
  if (!r.ok) throw new Error("unknown");
  return (await r.json()).on ? "on" : "off";
}

async function turnOn(publicKey: string): Promise<State> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  const reg = await activeRegistration();
  // Always a fresh subscription, made with the current key: an old one may predate a key change.
  await (await reg.pushManager.getSubscription())?.unsubscribe();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
  const r = await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
  if (!r.ok) throw new Error("not saved");
  return "on";
}

async function turnOff(): Promise<State> {
  const sub = await subscription();
  if (sub) {
    // The browser first: once it has let go, nothing reaches this phone. A row left behind (the
    // request failed) is deleted by the push service's 410 on the next send.
    await sub.unsubscribe();
    await fetch("/api/push", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
  }
  return "off";
}

const NOTE: Partial<Record<State, string>> = {
  blocked: "Blocked in this browser's settings",
  install: "Add Halves to your home screen first",
  unsupported: "Not available in this browser",
  unknown: "Couldn't check. Reload to try again",
};

export function NotificationsSwitch({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    readState().then(setState, () => setState("unknown"));
  }, []);

  const set = async (on: boolean) => {
    if (busy || (state === "on") === on) return;
    setBusy(true);
    setFailed(false);
    try {
      setState(await (on ? turnOn(publicKey) : turnOff()));
    } catch {
      setFailed(true);
    }
    setBusy(false);
  };

  if (state === "loading") return null;
  if (!publicKey) return <span className="dim xs">Not set up yet</span>;
  if (NOTE[state]) return <span className="dim xs">{NOTE[state]}</span>;
  return (
    <span className="row center-y">
      {failed && <span className="xs owe">Try again</span>}
      <span className="seg" role="group" aria-label="Notifications">
        {[true, false].map((on) => (
          <button key={String(on)} type="button" aria-pressed={(state === "on") === on} disabled={busy} onClick={() => set(on)}>
            {on ? "On" : "Off"}
          </button>
        ))}
      </span>
    </span>
  );
}

// A5: once, on the first open of the installed app, while this phone has not been asked. Decided
// once per page load, so granting permission mid-way does not make the screen (and its error) vanish.
const noChange = () => () => {};
let due: boolean | null = null;
function firstOpen() {
  if (due === null) {
    try {
      due = localStorage.getItem(ASKED) === null && installed() && supported() && Notification.permission === "default";
    } catch {
      due = false;
    }
  }
  return due;
}
export function NotifyPrompt({ publicKey, partner }: { publicKey: string; partner: string }) {
  const show = useSyncExternalStore(noChange, firstOpen, () => false);
  const [answered, setAnswered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const open = show && !answered && !!publicKey;
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal(); // modal: Home behind is inert
  }, [open]);
  if (!open) return null;

  const close = () => {
    try {
      localStorage.setItem(ASKED, "1");
    } catch {}
    due = false;
    setAnswered(true);
  };
  const on = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await turnOn(publicKey);
      close();
    } catch {
      setFailed(true);
    }
    setBusy(false);
  };

  return (
    <dialog ref={dialog} className="takeover screen" aria-label="Notifications" onCancel={(e) => (busy ? e.preventDefault() : close())}>
      <div className="center">
        <div className="icon-art">
          <Icon name="bell" size={34} />
        </div>
        <b>Know when a bill is added</b>
        <span className="dim small">
          Halves tells you &quot;{partner} added a bill&quot; and when someone settles up. Items never appear in a notification.
        </span>
        {failed && (
          <div className="banner amber" role="alert">
            Couldn&apos;t turn them on. Try again, or later in Settings.
          </div>
        )}
      </div>
      <div className="foot">
        <button type="button" className="btn" disabled={busy} onClick={on}>
          Turn on notifications
        </button>
        <button type="button" className="btn ghost sm" disabled={busy} onClick={close}>
          Not now
        </button>
      </div>
    </dialog>
  );
}
