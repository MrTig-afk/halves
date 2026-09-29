"use client";

import { useEffect, useRef, useState } from "react";

// Registers the service worker and shows "A new version is ready" when a new
// deploy's worker is waiting. Never reloads on its own (Artifact G3): only the
// tab whose Reload was tapped reloads; other tabs just get the banner.
export function UpdatePrompt() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [stale, setStale] = useState(false); // another tab already took the update
  const accepted = useRef(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    const sw = navigator.serviceWorker;
    const onControllerChange = () => {
      if (accepted.current) window.location.reload();
      else setStale(true);
    };
    sw.addEventListener("controllerchange", onControllerChange);

    let reg: ServiceWorkerRegistration | undefined;
    const checkForUpdate = () => {
      if (document.visibilityState === "visible") reg?.update().catch(() => {});
    };
    const watch = (next: ServiceWorker | null) =>
      next?.addEventListener("statechange", () => {
        if (next.state === "installed" && sw.controller) setWaiting(next);
      });
    sw.register("/sw.js").then((r) => {
      reg = r;
      if (r.waiting && sw.controller) setWaiting(r.waiting);
      watch(r.installing); // the browser's own check may already be installing a new deploy
      r.addEventListener("updatefound", () => watch(r.installing));
    });
    // An installed app can stay open for days; look for a new deploy whenever it comes back to the front.
    document.addEventListener("visibilitychange", checkForUpdate);
    return () => {
      sw.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", checkForUpdate);
    };
  }, []);

  if (!waiting && !stale) return null;
  const reload = () => {
    if (waiting && !stale) {
      accepted.current = true; // the reload happens in onControllerChange, never straight after postMessage
      waiting.postMessage({ type: "SKIP_WAITING" });
    } else {
      window.location.reload();
    }
  };
  return (
    <div role="status" className="update-prompt">
      <span>A new version is ready</span>
      <button type="button" onClick={reload}>
        Reload
      </button>
    </div>
  );
}
