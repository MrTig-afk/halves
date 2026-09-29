"use client";

// Pick a photo -> crop -> AI read -> review and split, with the no-items and
// paused-AI error screens (both offer entering the bill by hand).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { ImageCropper } from "@/components/ImageCropper";
import { Review, type Draft, type Partner, type SavedBill } from "@/components/Review";
import { clock, postReceipt, type ApiFailure } from "@/lib/api";
import { cropToJpeg, loadImage, type CropRect } from "@/lib/cropImage";
import { formatCents } from "@/lib/money";
import type { ReceiptReading } from "@/lib/receipt";

type Step =
  | { k: "pick"; problem?: string }
  | { k: "crop"; img: HTMLImageElement }
  | { k: "reading"; img: HTMLImageElement }
  | { k: "review"; draft: Draft }
  | { k: "failed"; img: HTMLImageElement; rect: CropRect | null; failure: ApiFailure; jpeg: Blob }
  | { k: "saved"; saved: SavedBill };

const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
// crypto.randomUUID only exists on https and localhost; a phone testing over the LAN is neither.
const uuid = () =>
  crypto.randomUUID?.() ??
  "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16));

function draftFrom(reading: ReceiptReading | null, photo: Blob): Draft {
  const base = { scan_id: uuid(), photo, ai: reading };
  if (!reading) return { ...base, description: "", date: today(), total_cents: null, rows: [{ key: 0, name: "", price_cents: 0, kind: "item", share: "payer" }] };
  return {
    ...base,
    description: reading.store_name ?? "",
    date: reading.date ?? today(),
    total_cents: reading.total_cents,
    rows: reading.lines.map((l, i) => ({ key: i, name: l.name, price_cents: l.price_cents, kind: l.kind, share: "payer" })),
  };
}

export function ScanFlow({ me, partners }: { me: string; partners: Partner[] }) {
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
    setStep(r.ok ? { k: "review", draft: draftFrom(r.reading, jpeg) } : { k: "failed", img, rect, failure: r, jpeg });
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
    return <Review me={me} partners={partners} draft={step.draft} onBack={() => setStep({ k: "pick" })} onSaved={(saved) => setStep({ k: "saved", saved })} />;
  }
  if (step.k === "saved") return <Saved s={step.saved} again={() => setStep({ k: "pick" })} done={() => router.push("/")} />;
  if (step.k === "failed") {
    return (
      <Failed
        failure={step.failure}
        recrop={() => setStep({ k: "crop", img: step.img })}
        retry={() => read(step.img, step.rect)}
        byHand={() => setStep({ k: "review", draft: draftFrom(null, step.jpeg) })}
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

function Saved({ s, again, done }: { s: SavedBill; again: () => void; done: () => void }) {
  const now = s.was + s.owes;
  const tab = (c: number) => (c >= 0 ? `${s.partnerName} owes you ${formatCents(c)}` : `You owe ${s.partnerName} ${formatCents(-c)}`);
  return (
    <main className="screen">
      <div className="center">
        <div className="icon-art ok">
          <Icon name="check" size={40} />
        </div>
        <b style={{ fontSize: 17 }}>Saved</b>
        <div className="small">
          <b>{s.description}</b> · {s.partnerName} owes <span className="num">{formatCents(s.owes)}</span>
        </div>
        <div className="soft">
          <div className="xs dim">Your tab with {s.partnerName}</div>
          <div className={`num tab-amt ${now >= 0 ? "owed" : "owe"}`}>{tab(now)}</div>
          <div className="xs dim num">was {s.was >= 0 ? formatCents(s.was) : tab(s.was)}</div>
        </div>
        {s.photo === "not_kept_full" && <span className="dim xs">Photo not kept: photo storage is full. Export photos in Settings to free space.</span>}
      </div>
      <div className="foot">
        <button type="button" className="btn" onClick={again}>
          Scan another
        </button>
        <button type="button" className="btn ghost sm" onClick={done}>
          Done
        </button>
      </div>
    </main>
  );
}
