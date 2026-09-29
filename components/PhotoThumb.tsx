"use client";

// The receipt photo as a thumbnail; a tap shows it full size over the page, and a tap anywhere
// closes it again (an installed app has no browser back button to rely on).
import { useState } from "react";

export function PhotoThumb({ src }: { src: string }) {
  const [big, setBig] = useState(false);
  return (
    <>
      <button type="button" className="thumb" onClick={() => setBig(true)} aria-label="Show the receipt photo">
        {/* eslint-disable-next-line @next/next/no-img-element -- a private, per-user photo; nothing to optimise */}
        <img src={src} alt="" />
      </button>
      {big && (
        <button type="button" className="photo-full" onClick={() => setBig(false)} aria-label="Close the photo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="Receipt" />
        </button>
      )}
    </>
  );
}
