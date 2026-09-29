"use client";

// Add a person (F3): a name, the warning about unclaimed tiles, and "Add <Name>".
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AddPerson() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = name.trim() || "them";

  const add = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/people", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    if (res?.ok) return router.replace("/settings/people"); // stays busy: no second tap on the way out
    setBusy(false);
    const body = await res?.json().catch(() => null);
    setError(body?.message ?? "Couldn't add them. Check your connection and try again.");
  };

  return (
    <>
      <div className="body" style={{ gap: 10 }}>
        <label className="field">
          <span className="xs dim">Name</span>
          <input className="plain b" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="banner amber">
          A new tile appears on the sign-in screen. Whoever taps it first sets its PIN, so tell {shown} straight away.
        </div>
        {error && (
          <div className="banner amber" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="foot">
        <button type="button" className="btn" disabled={busy || !name.trim()} onClick={add}>
          Add {name.trim() || "a person"}
        </button>
      </div>
    </>
  );
}
