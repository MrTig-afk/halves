"use client";

// Reset someone's PIN: their tile becomes unclaimed again and every phone they used is signed out.
// The browser's own confirm, because it cannot be undone and the approved flow draws no sheet.
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ResetPinButton({ id, name }: { id: number; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn ghost sm"
      style={{ flex: "none" }}
      disabled={busy}
      onClick={async () => {
        if (!confirm(`Reset ${name}'s PIN? Their tile goes back to "Tap to set up" and they are signed out on every phone.`)) return;
        setBusy(true);
        const res = await fetch(`/api/people/${id}/reset`, { method: "POST" }).catch(() => null);
        setBusy(false);
        if (!res?.ok) {
          const body = await res?.json().catch(() => null);
          return alert(body?.message ?? `Couldn't reset ${name}'s PIN. Check your connection and try again.`);
        }
        router.refresh();
      }}
    >
      Reset PIN
    </button>
  );
}
