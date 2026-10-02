"use client";

// The drop-down for people on a bill (Artifact dropdown()): a labelled box with the names in it, and
// a panel right under it (above it when there is no room below) with a scrim behind. Multi-pick:
// one real checkbox per person, an optional "Everyone", a "Done". Pick-one: radios, closes at once.
// Focus moves into the panel on open and back to the box on close; Escape closes. Text is 16 px.
// `Panel` is the panel alone, for what opens from somewhere else (the breakdown under the total).
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

export type Option = { id: number; name: string; locked?: boolean };

// A panel right under `anchor` (above it when there is no room below) with a scrim behind it.
// Closing hands focus back to the anchor. It is placed against the nearest positioned ancestor,
// so render it outside a sticky footer.
export function Panel({ anchor, title, done, onClose, children }: { anchor: RefObject<HTMLElement | null>; title: string; done?: boolean; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const close = () => {
    onClose();
    anchor.current?.focus();
  };
  useLayoutEffect(() => {
    const p = panel.current;
    const host = p?.offsetParent?.getBoundingClientRect();
    const a = anchor.current;
    if (!p || !a || !host) return;
    const r = a.getBoundingClientRect();
    let top = r.bottom - host.top + 4;
    if (r.bottom + 4 + p.offsetHeight > window.innerHeight - 8) top = r.top - host.top - p.offsetHeight - 4;
    p.style.top = `${Math.max(8, top)}px`;
  }); // every render: a refusal line makes the panel taller
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("input:not(:disabled), .ddok")?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const esc = (ev: KeyboardEvent) => ev.key === "Escape" && close();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  });
  return (
    <>
      <div className="ddscrim" onClick={close} />
      <div className="ddp" ref={panel} role="dialog" aria-label={title}>
        {children}
        {done && (
          <button type="button" className="btn sm ddok" onClick={close}>
            Done
          </button>
        )}
      </div>
    </>
  );
}

export function PeoplePicker({
  label,
  text,
  title,
  options,
  selected,
  onChange,
  multi = true,
  everyone,
  min = 1,
  minText = "Pick at least one person.",
  max,
  maxText,
  note,
  chip,
}: {
  label: string;
  text: string; // what the box shows
  title: string;
  options: Option[]; // in the order they are listed and returned
  selected: number[];
  onChange: (ids: number[]) => void;
  multi?: boolean;
  everyone?: boolean; // an "Everyone" button that ticks all
  min?: number;
  minText?: string;
  max?: number;
  maxText?: string;
  note?: string;
  chip?: boolean; // the box is an item's names button, with no row or label around it (`label` is then only its spoken name)
}) {
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const box = useRef<HTMLButtonElement>(null);
  const group = useId();
  const close = () => {
    setOpen(false);
    setHint(null);
  };

  const toggle = (id: number) => {
    const next = options.map((o) => o.id).filter((x) => (x === id ? !selected.includes(id) : selected.includes(x)));
    if (next.length < min) return setHint(minText);
    if (max !== undefined && next.length > max) return setHint(maxText ?? null);
    setHint(null);
    onChange(next);
  };

  const trigger = chip ? (
    <button ref={box} type="button" className={selected.length === options.length ? "who all" : "who"} aria-haspopup="dialog" aria-expanded={open} aria-label={`${label}: ${text}`} onClick={() => setOpen(true)}>
      {text}{" "}
      <span className="chev" aria-hidden="true">
        ▾
      </span>
    </button>
  ) : (
    <button ref={box} type="button" className="dd" aria-haspopup="dialog" aria-expanded={open} aria-label={`${label}: ${text}`} onClick={() => setOpen(true)}>
      <span className="ddv">{text}</span>
      <span className="chev" aria-hidden="true">
        ▾
      </span>
    </button>
  );
  const panel = open && (
    <Panel anchor={box} title={title} done={multi} onClose={close}>
      <div className="row center-y">
        <span className="ddt">{title}</span>
        {everyone && (
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => {
              setHint(null);
              onChange(options.map((o) => o.id));
            }}
          >
            Everyone
          </button>
        )}
      </div>
      {options.map((o) => (
        <label key={o.id} className="ddr">
          <input
            type={multi ? "checkbox" : "radio"}
            name={group}
            checked={selected.includes(o.id)}
            disabled={o.locked}
            onChange={() => (multi ? toggle(o.id) : onChange([o.id]))}
            onClick={() => {
              // pick-one closes also when the name already picked is tapped again, which fires no change
              if (multi) return;
              close();
              box.current?.focus();
            }}
          />
          <span>
            {o.name}
            {o.locked && <span className="xs dim"> always</span>}
          </span>
        </label>
      ))}
      {note && <div className="xs dim">{note}</div>}
      <div className="xs owe" role="alert" hidden={!hint}>
        {hint}
      </div>
    </Panel>
  );
  if (chip) {
    return (
      <>
        {trigger}
        {panel}
      </>
    );
  }
  return (
    <div className="row small center-y">
      <span className="lab">{label}</span>
      {trigger}
      {panel}
    </div>
  );
}
