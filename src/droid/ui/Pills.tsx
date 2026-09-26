"use client";

import type { ReactNode } from "react";

export function Pills({
  items,
  value,
  onChange,
  ariaLabel,
}: {
  items: Array<{ id: string; label: string }>;
  value: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="dx-pills" role="tablist" aria-label={ariaLabel}>
      {items.map((it) => (
        <button
          key={it.id}
          role="tab"
          aria-selected={it.id === value}
          className={`dx-pill${it.id === value ? " dx-on" : ""}`}
          onClick={() => onChange(it.id)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function H({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="dx-h">
      <span>{children}</span>
      {right}
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <div className="dx-note">{children}</div>;
}

export function Skeleton({ rows = 3, height = 56 }: { rows?: number; height?: number }) {
  return (
    <div className="dx-col" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="dx-sk" style={{ height }} />
      ))}
    </div>
  );
}

export function EmptyState({ title, desc, action }: { title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="dx-state">
      <div className="dx-state-t">{title}</div>
      {desc ? <div className="dx-state-d">{desc}</div> : null}
      {action}
    </div>
  );
}

export function ErrorState({ what, retry, detail }: { what: string; retry?: () => void; detail?: string }) {
  return (
    <div className="dx-state" role="alert">
      <div className="dx-state-t">{what} — TAPE OFF</div>
      <div className="dx-state-d">{detail ?? "THE FEED DID NOT ANSWER. NOTHING IS INVENTED WHILE IT IS DOWN."}</div>
      {retry ? (
        <button className="dx-btn" onClick={retry}>
          RETRY ⟳
        </button>
      ) : null}
    </div>
  );
}

export function Badge({
  kind,
  children,
}: {
  kind: "up" | "down" | "fnc" | "mute";
  children: ReactNode;
}) {
  return <span className={`dx-badge dx-${kind}`}>{children}</span>;
}
