"use client";

// Contextual floating action button (spec §13) — replaces desktop-only controls.

export interface FabItem {
  key: string;
  label: string;
  icon: string;
  onClick: () => void;
}

export default function FAB({
  items,
  open,
  onToggle,
  ariaLabel = "Quick actions",
}: {
  items: FabItem[];
  open: boolean;
  onToggle: (v: boolean) => void;
  ariaLabel?: string;
}) {
  if (!items.length) return null;
  return (
    <div className="dx-fab-wrap">
      {open &&
        items.map((it) => (
          <button key={it.key} className="dx-fab-item" onClick={() => { onToggle(false); it.onClick(); }}>
            <span aria-hidden>{it.icon}</span>
            {it.label}
          </button>
        ))}
      <button
        className="dx-fab"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => onToggle(!open)}
      >
        {open ? "✕" : "＋"}
      </button>
    </div>
  );
}
