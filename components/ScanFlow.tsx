"use client";

// Pick a photo -> crop -> AI read -> review and split, with the no-items and
// paused-AI error screens (both offer entering the bill by hand).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { ImageCropper } from "@/components/ImageCropper";
import { Review, type Draft, type Partner, type SavedBill } from "@/components/Review";
import { Saved } from "@/components/Saved";
import { clock, postReceipt, today, uuid, type ApiFailure } from "@/lib/api";
import { cropToJpeg, loadImage, type CropRect } from "@/lib/cropImage";
import type { ReceiptReading } from "@/lib/receipt";

type Step =
  | { k: "pick"; problem?: string }
  | { k: "crop"; img: HTMLImageElement }
  | { k: "reading"; img: HTMLImageElement }
  | { k: "review"; draft: Draft }
  | { k: "failed"; img: HTMLImageElement; rect: CropRect | null; failure: ApiFailure; jpeg: Blob }
  | { k: "saved"; saved: SavedBill };

// Every item starts shared by everyone on the bill (`start`: lib/people.ts billPeople).
function draftFrom(reading: ReceiptReading | null, photo: Blob, start: number[]): Draft {
  const base = { scan_id: uuid(), photo, ai: reading };
  if (!reading) return { ...base, description: "", date: today(), total_cents: null, rows: [{ key: 0, name: "", price_cents: 0, kind: "item", set: start }] };
  return {
    ...base,
    description: reading.store_name ?? "",
    date: reading.date ?? today(),
    total_cents: reading.total_cents,
    rows: reading.lines.map((l, i) => ({ key: i, name: l.name, price_cents: l.price_cents, kind: l.kind, set: start })),
  };
}

// `people`: everyone, you first then by id; `start`: who a new bill starts with.
export function ScanFlow({ meId, people, start }: { meId: number; people: Partner[]; start: number[] }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ k: "pick" });
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const run = useRef(0); // each read gets a number; going back makes a late answer stale

  const picked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // picking the same photo again must fire change again
    if (!file) return;
    const img = await loadImage(file);
    setStep(img ? { k: "crop", img } : { k: "pick", problem: "This photo format can't be read - take a screenshot of it or use a JPEG." });
  };

  const read = async (img: HTMLImageElement, rect: CropRect | null) => {
    const mine = ++run.current;
    setStep({ k: "reading", img });
    const jpeg = await cropToJpeg(img, rect);
    if (mine !== run.current) return;
    if (!jpeg) {
      setStep({ k: "pick", problem: "That photo couldn't be prepared. Try another one." });
      return;
    }
    const r = await postReceipt(jpeg);
    if (mine !== run.current) return;
    if (!r.ok && r.error === "signed_out") return router.replace("/signin");
    setStep(r.ok ? { k: "review", draft: draftFrom(r.reading, jpeg, start) } : { k: "failed", img, rect, failure: r, jpeg });
  };

  if (step.k === "crop") return <ImageCropper img={step.img} onCancel={() => setStep({ k: "pick" })} onConfirm={(rect) => read(step.img, rect)} />;
  if (step.k === "reading") {
    const { img } = step;
    return (
      <Reading
        back={() => {
          run.current++;
          setStep({ k: "crop", img });
        }}
      />
    );
  }
  if (step.k === "review") {
    return <Review meId={meId} people={people} start={start} draft={step.draft} onBack={() => setStep({ k: "pick" })} onSaved={(saved) => setStep({ k: "saved", saved })} />;
  }
  if (step.k === "saved") return <Saved s={step.saved} again={() => setStep({ k: "pick" })} done={() => router.push("/")} />;
  if (step.k === "failed") {
    return (
      <Failed
        failure={step.failure}
        recrop={() => setStep({ k: "crop", img: step.img })}
        retry={() => read(step.img, step.rect)}
        byHand={() => setStep({ k: "review", draft: draftFrom(null, step.jpeg, start) })}
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

function Reading({ back }: { back: () => void }) {
  return (
    <main className="screen" aria-busy="true">
      <div className="bar">
        <button type="button" className="back" onClick={back}>
          ‹ Crop
        </button>
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

function Failed({ failure, recrop, retry, byHand, back }: { failure: ApiFailure; recrop: () => void; retry: () => void; byHand: () => void; back: () => void }) {
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
        <b>{noItems ? "Couldn't find items in this photo" : paused ? `Receipt reading is paused${failure.until ? ` until ${clock(failure.until)}` : ""}` : "That didn't work"}</b>
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
        {(noItems || paused) && (
          <button type="button" className="btn ghost" onClick={byHand}>
            Enter by hand
          </button>
        )}
      </div>
    </main>
  );
}
