"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return (
    <div className="grow">
      <button
        type="button"
        className="linkrow owe"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(false);
          const res = await fetch("/api/auth/signout", { method: "POST" }).catch(() => null);
          if (!res?.ok) {
            setBusy(false);
            return setError(true); // still signed in: say so rather than pretend
          }
          router.replace("/signin");
          router.refresh();
        }}
      >
        Sign out of this phone
      </button>
      {error && (
        <div className="xs owe" role="alert">
          Couldn&apos;t sign out. Check your connection and try again.
        </div>
      )}
    </div>
  );
}
