"use client";

// System / Light / Dark for this phone. Applied at once, and saved in a cookie so the server
// renders it (theme and status-bar colour) on every page from then on.
import { useState } from "react";
import { THEME_COLOR, THEME_COOKIE, type Theme } from "@/lib/theme";

function save(t: Theme) {
  document.cookie =
    t === "system" ? `${THEME_COOKIE}=; path=/; max-age=0; samesite=lax` : `${THEME_COOKIE}=${t}; path=/; max-age=34560000; samesite=lax`; // 400 days
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
  // The status bar now; the next page the server renders brings the same from the cookie.
  // Under System a tag keeps its own scheme; a single tag (from a forced choice) asks the phone.
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    const media = m.getAttribute("media");
    const dark = t === "dark" || (t === "system" && (media ? media.includes("dark") : matchMedia("(prefers-color-scheme: dark)").matches));
    m.setAttribute("content", dark ? THEME_COLOR.dark : THEME_COLOR.light);
  });
}

export function Appearance({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState(initial);
  return (
    <span className="seg" role="group" aria-label="Appearance">
      {(["system", "light", "dark"] as const).map((t) => (
        <button
          key={t}
          type="button"
          aria-pressed={theme === t}
          onClick={() => {
            setTheme(t);
            save(t);
          }}
        >
          {t === "system" ? "System" : t === "light" ? "Light" : "Dark"}
        </button>
      ))}
    </span>
  );
}
