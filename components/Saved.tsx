"use client";

// Saved (Artifact B7, D3, H2): shared by the scan flow and the no-receipt form. What it says is
// worked out in lib/billview.ts; this only lays it out.
import { Icon } from "@/components/Icon";
import type { SavedBill } from "@/components/Review";
import { savedView } from "@/lib/billview";
import { formatCents } from "@/lib/money";

export function Saved({ s: { saved, names }, again, done, againLabel = "Scan another" }: { s: SavedBill; again: () => void; done: () => void; againLabel?: string }) {
  const v = savedView(saved, names);
  return (
    <main className="screen">
      <div className="center">
        <div className="icon-art ok">
          <Icon name="check" size={40} />
        </div>
        <b style={{ fontSize: 17 }}>Saved</b>
        <div className="small">
          <b>{saved.description}</b>
          {v.line.map((p, i) => (
            <span key={i}>
              {" · "}
              {p.label}
              {p.cents !== undefined && <> <span className="num">{formatCents(p.cents)}</span></>}
            </span>
          ))}
        </div>
        {v.rows.length > 0 &&
          (v.heading ? (
            <div className="soft">
              <div className="xs dim">{v.heading}</div>
              <div className={`num tab-amt ${v.rows[0].owed ? "owed" : "owe"}`}>
                {v.rows[0].label} {formatCents(v.rows[0].cents)}
              </div>
              <div className="xs dim num">{v.rows[0].was}</div>
            </div>
          ) : (
            <div className="soft" style={{ textAlign: "left", display: "flex", flexDirection: "column", gap: 6 }}>
              {v.rows.map((r, i) => (
                <div key={i} className="row small center-y">
                  <span className="grow">{r.label}</span>
                  <b className={`num ${r.owed ? "owed" : "owe"}`}>{formatCents(r.cents)}</b>
                  <span className="xs dim num">{r.was}</span>
                </div>
              ))}
            </div>
          ))}
        {v.notified && <span className="dim xs">{v.notified}</span>}
        {saved.photo === "not_kept_full" && <span className="dim xs">Photo not kept: photo storage is full. Export photos in Settings to free space.</span>}
      </div>
      <div className="foot">
        <button type="button" className="btn" onClick={again}>
          {againLabel}
        </button>
        <button type="button" className="btn ghost sm" onClick={done}>
          Done
        </button>
      </div>
    </main>
  );
}
