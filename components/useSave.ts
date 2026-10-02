"use client";

// The one save handler for Review and the no-receipt form: send the bill, show "Saving…", go to
// sign-in when the session is gone, hand the stored bill to `onSaved`, else show the failure
// (lib/api.ts saveFailure). `lines` is false on the form, which has no lines to point at.
// `first` sees the answer before any of that and returns true when it dealt with it (the form's
// scan-id bookkeeping and its "earlier bill was saved" banner).
import { useRouter } from "next/navigation";
import { useState } from "react";
import { postBill, saveFailure, type SaveResult } from "@/lib/api";
import type { BillBody, Saved } from "@/lib/bill";

export type SaveError = { text: string; retry: boolean };

export function useSave(onSaved: (saved: Saved) => void) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<SaveError | null>(null);
  const send = async (body: BillBody, photo: Blob | null, opts: { lines?: boolean; first?: (r: SaveResult) => boolean | void } = {}) => {
    setSaving(true);
    setError(null);
    const r = await postBill(body, photo);
    setSaving(false);
    if (opts.first?.(r)) return;
    if (r.ok) return onSaved(r); // a retried save answers with the bill stored the first time, which is the one to show
    if (r.error === "signed_out") return router.replace("/signin");
    setError(saveFailure(r, opts.lines ?? true));
  };
  return { saving, error, setError, send };
}
