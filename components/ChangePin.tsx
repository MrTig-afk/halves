"use client";

// Current PIN, then the new one twice. One request at the end; a wrong current PIN counts towards
// the sign-in lockout and starts again from the top.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PinPad } from "@/components/SignIn";

type Step = { k: "current" | "new" | "again"; current?: string; next?: string; message?: string };
const TITLES = { current: "Enter your current PIN", new: "Choose a new PIN", again: "Enter the new PIN again" };

export function ChangePin() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ k: "current" });
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(0); // a fresh pad after every answer

  const entered = async (pin: string) => {
    setN((x) => x + 1);
    if (step.k === "current") return setStep({ k: "new", current: pin });
    if (step.k === "new") return setStep({ ...step, k: "again", next: pin, message: undefined });
    if (pin !== step.next) return setStep({ k: "new", current: step.current, message: "Those didn't match. Choose a new PIN again." });
    setBusy(true);
    const res = await fetch("/api/auth/change-pin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ current: step.current, next: pin }),
    }).catch(() => null);
    if (res?.ok) return router.replace("/settings?done=pin"); // stays busy: no stray second attempt
    setBusy(false);
    // Signed out, or the admin reset this tile meanwhile: only signing in again helps.
    if (res?.status === 401 || res?.status === 409) return router.replace("/signin");
    const r = await res?.json().catch(() => null);
    const message =
      r?.error === "wrong_pin"
        ? `Wrong PIN. ${r.triesLeft} ${r.triesLeft === 1 ? "try" : "tries"} left.`
        : r?.error === "locked"
          ? "Too many wrong PINs. Try again in a few minutes, or ask the admin to reset your PIN."
          : (r?.message ?? "Couldn't change your PIN. Check your connection and try again.");
    setStep({ k: "current", message });
  };

  return (
    <div className="center">
      <b>{TITLES[step.k]}</b>
      <PinPad key={n} busy={busy} shake={!!step.message} message={step.message} onDone={entered} />
    </div>
  );
}
