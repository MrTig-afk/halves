"use client";

// Free-form 4-corner crop (ported from NutritionDE ImageCropper.jsx; pointer events cover
// mouse and touch). Artifact B3: dark screen, white box with corner brackets,
// Cancel / Full image / Read items.
import { useEffect, useRef, useState } from "react";
import type { CropRect } from "@/lib/cropImage";

type Box = { x: number; y: number; w: number; h: number }; // canvas pixels
type Mode = "move" | "nw" | "ne" | "sw" | "se";
const MIN = 40;
const HANDLE = 22;

export function ImageCropper({
  img,
  onConfirm,
  onCancel,
}: {
  img: HTMLImageElement;
  onConfirm: (rect: CropRect | null) => void;
  onCancel: () => void;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ mode: Mode; x: number; y: number; start: Box } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number; scale: number } | null>(null);
  const [box, setBox] = useState<Box | null>(null);

  // Fit the photo into the space between the bars.
  useEffect(() => {
    const area = areaRef.current!;
    const scale = Math.min(1, (area.clientWidth - 28) / img.naturalWidth, (area.clientHeight - 28) / img.naturalHeight);
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    setSize({ w, h, scale });
    setBox({ x: Math.round(w * 0.1), y: Math.round(h * 0.1), w: Math.round(w * 0.8), h: Math.round(h * 0.8) });
  }, [img]);

  useEffect(() => {
    if (!size || !box) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { w, h } = size;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, w, box.y);
    ctx.fillRect(0, box.y + box.h, w, h - box.y - box.h);
    ctx.fillRect(0, box.y, box.x, box.h);
    ctx.fillRect(box.x + box.w, box.y, w - box.x - box.w, box.h);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.lineWidth = 4;
    const L = 16;
    for (const [cx, cy, dx, dy] of [
      [box.x, box.y, 1, 1],
      [box.x + box.w, box.y, -1, 1],
      [box.x, box.y + box.h, 1, -1],
      [box.x + box.w, box.y + box.h, -1, -1],
    ]) {
      ctx.beginPath();
      ctx.moveTo(cx, cy + dy * L);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + dx * L, cy);
      ctx.stroke();
    }
  }, [img, size, box]);

  const pos = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * size!.w) / r.width, y: ((e.clientY - r.top) * size!.h) / r.height };
  };

  const onDown = (e: React.PointerEvent) => {
    if (!box) return;
    const p = pos(e);
    const corners: [Mode, number, number][] = [
      ["nw", box.x, box.y],
      ["ne", box.x + box.w, box.y],
      ["sw", box.x, box.y + box.h],
      ["se", box.x + box.w, box.y + box.h],
    ];
    const corner = corners.find(([, cx, cy]) => Math.abs(p.x - cx) <= HANDLE && Math.abs(p.y - cy) <= HANDLE);
    const inside = p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;
    const mode = corner?.[0] ?? (inside ? "move" : null);
    if (!mode) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, x: p.x, y: p.y, start: box };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !size) return;
    const p = pos(e);
    const dx = p.x - d.x;
    const dy = p.y - d.y;
    const b = d.start;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    let { x, y, w, h } = b;
    if (d.mode === "move") {
      x = clamp(b.x + dx, 0, size.w - b.w);
      y = clamp(b.y + dy, 0, size.h - b.h);
    }
    if (d.mode === "nw" || d.mode === "sw") {
      x = clamp(b.x + dx, 0, b.x + b.w - MIN);
      w = b.x + b.w - x;
    }
    if (d.mode === "ne" || d.mode === "se") w = clamp(b.w + dx, MIN, size.w - b.x);
    if (d.mode === "nw" || d.mode === "ne") {
      y = clamp(b.y + dy, 0, b.y + b.h - MIN);
      h = b.y + b.h - y;
    }
    if (d.mode === "sw" || d.mode === "se") h = clamp(b.h + dy, MIN, size.h - b.y);
    setBox({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
  };

  const confirm = () => {
    if (!box || !size) return onConfirm(null);
    const s = size.scale;
    onConfirm({ x: Math.round(box.x / s), y: Math.round(box.y / s), width: Math.round(box.w / s), height: Math.round(box.h / s) });
  };

  return (
    <div className="screen crop-screen">
      <div className="bar">
        <span className="ttl">Crop to the items</span>
      </div>
      <div className="crop-area" ref={areaRef}>
        {size && (
          <canvas
            ref={canvasRef}
            width={size.w}
            height={size.h}
            aria-label="Receipt photo. Drag the corners to box the item lines."
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
          />
        )}
      </div>
      <div className="foot">
        <div className="row">
          <button type="button" className="btn ghost sm" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn ghost sm" onClick={() => onConfirm(null)}>
            Full image
          </button>
          <button type="button" className="btn sm" onClick={confirm}>
            Read items
          </button>
        </div>
      </div>
    </div>
  );
}
