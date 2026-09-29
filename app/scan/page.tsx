"use client";

// M0 receipt chain (tasks T0.5): pick a photo -> crop -> AI read -> the lines it read.
// Artifact B2-B4 and E3/E4. The full review screen (sliders, voice, Save) is T1.3.
import Link from "next/link";
import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { ImageCropper } from "@/components/ImageCropper";
import { postReceipt, type ApiFailure } from "@/lib/api";
import { cropToJpeg, loadImage, type CropRect } from "@/lib/cropImage";
import { formatCents } from "@/lib/money";
import type { ReceiptReading } from "@/lib/receipt";

type Step =
  | { k: "pick"; problem?: string }
  | { k: "crop"; img: HTMLImageElement }
  | { k: "reading"; img: HTMLImageElement }
  | { k: "result"; reading: ReceiptReading }
  | { k: "failed"; img: HTMLImageElement; rect: CropRect | null; failure: ApiFailure };

export default function Scan() {
  const [step, setStep] = useState<Step>({ k: "pick" });
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);

  const picked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // picking the same photo again must fire change again
    if (!file) return;
    const img = await loadImage(file);
    setStep(img ? { k: "crop", img } : { k: "pick", problem: "This photo format can't be read - take a screenshot of it or use a JPEG." });
  };

  const read = async (img: HTMLImageElement, rect: CropRect | null) => {
    setStep({ k: "reading", img });
    const jpeg = await cropToJpeg(img, rect);
    if (!jpeg) {
      setStep({ k: "pick", problem: "That photo couldn't be prepared. Try another one." });
      return;
    }
    const r = await postReceipt(jpeg);
    setStep(r.ok ? { k: "result", reading: r.reading } : { k: "failed", img, rect, failure: r });
  };

  if (step.k === "crop") return <ImageCropper img={step.img} onCancel={() => setStep({ k: "pick" })} onConfirm={(rect) => read(step.img, rect)} />;
  if (step.k === "reading") return <Reading />;
  if (step.k === "result") return <Result reading={step.reading} again={() => setStep({ k: "pick" })} />;
  if (step.k === "failed") {
    return (
      <Failed
        failure={step.failure}
        recrop={() => setStep({ k: "crop", img: step.img })}
        retry={() => read(step.img, step.rect)}
        back={() => setStep({ k: "pick" })}
      />
    );
  }

  return (
    <main className="screen">
      <div className="bar">
        <Link href="/" className="logo">
          <span className="mark" />
          Halves
        </Link>
      </div>
      <div className="body">
        {step.problem && <div className="banner amber">{step.problem}</div>}
      </div>
      <div className="scrim" />
      <div className="sheet" role="dialog" aria-label="Add a receipt photo">
        <div className="grab" />
        <button type="button" className="btn" onClick={() => camera.current?.click()}>
          <Icon name="camera" /> Take photo
        </button>
        <button type="button" className="btn ghost" onClick={() => library.current?.click()}>
          <Icon name="image" /> Choose from photos
        </button>
        <Link href="/" className="btn ghost sm" style={{ border: 0 }}>
          Cancel
        </Link>
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={picked} />
        <input ref={library} type="file" accept="image/*" hidden onChange={picked} />
      </div>
    </main>
  );
}

function Reading() {
  return (
    <main className="screen" aria-busy="true">
      <div className="bar">
        <span className="ttl">New bill</span>
      </div>
      <div className="body">
        <b>Reading your receipt…</b>
        <div className="prog">
          <i />
        </div>
        <div className="xs dim">Usually under 5 seconds</div>
        {[90, 70, 82, 60, 76, 66].map((w) => (
          <div key={w} className="skel" style={{ width: `${w}%` }} />
        ))}
      </div>
    </main>
  );
}

function Result({ reading, again }: { reading: ReceiptReading; again: () => void }) {
  let pos = 0;
  return (
    <main className="screen">
      <div className="bar">
        <span className="ttl">New bill</span>
      </div>
      <div className="body">
        <div className="field">
          <div className="xs dim">Description</div>
          <b>{reading.store_name ?? "Receipt"}</b>
        </div>
        <div className="small dim num">
          {reading.date ?? "No date on the receipt"}
          {reading.total_cents !== null && ` · Total ${formatCents(reading.total_cents)}`}
        </div>
        <div className="items">
          {reading.lines.map((l, i) => {
            if (l.kind === "item") pos++;
            const note = l.kind === "discount" ? ` · follows ${pos}` : l.kind === "surcharge" ? " · fee, shared in proportion" : "";
            return (
              <div key={i} className={l.kind === "item" ? "it" : "it sub"}>
                <span className="pos">{l.kind === "item" ? pos : ""}</span>
                <span className="nm">
                  {l.name}
                  <span className="xs">{note}</span>
                </span>
                <span className="pr">{formatCents(l.price_cents)}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="foot">
        <button type="button" className="btn o" onClick={again}>
          <Icon name="camera" /> Scan another
        </button>
      </div>
    </main>
  );
}

function Failed({ failure, recrop, retry, back }: { failure: ApiFailure; recrop: () => void; retry: () => void; back: () => void }) {
  const noItems = failure.error === "no_items";
  const paused = failure.error === "ai_paused";
  return (
    <main className="screen">
      <div className="bar">
        <button type="button" className="back" onClick={back}>
          ‹ Back
        </button>
      </div>
      <div className="center">
        <div className="icon-art">
          <Icon name={paused ? "pause" : "receipt"} size={34} />
        </div>
        <b>{noItems ? "Couldn't find items in this photo" : paused ? "Receipt reading is paused" : "That didn't work"}</b>
        <span className="dim small">
          {noItems ? "Try cropping closer to the item lines, or retake it in better light." : failure.message}
        </span>
      </div>
      <div className="foot">
        {!paused && (
          <button type="button" className="btn" onClick={recrop}>
            Re-crop
          </button>
        )}
        {(failure.retryable || noItems) && (
          <button type="button" className="btn ghost" onClick={retry}>
            Try again
          </button>
        )}
      </div>
    </main>
  );
}
