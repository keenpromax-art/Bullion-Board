"use client";

// Bottom sheet (spec §6 / §7 gesture table): drag handle, backdrop tap,
// swipe-down dismiss, Esc, and Android-back consumption.

import { useCallback, useEffect, useRef, useState } from "react";

export default function Sheet({
  open,
  onClose,
  title,
  half = false,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  half?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number; active: boolean }>({ y: 0, dy: 0, active: false });
  const [dy, setDy] = useState(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  // Android / browser back closes the sheet before leaving the route.
  useEffect(() => {
    if (!open) return;
    const prev = window.history.state;
    try {
      window.history.pushState({ ...(prev as object | null), dxSheet: 1 }, "");
    } catch {
      /* history unavailable */
    }
    const onPop = () => onCloseRef.current();
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Closed via UI → consume the extra history entry we pushed.
      const st = window.history.state as { dxSheet?: number } | null;
      if (st && st.dxSheet) window.history.back();
    };
  }, [open]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    drag.current = { y: e.clientY, dy: 0, active: true };
    setDy(0);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current.active) return;
    const d = e.clientY - drag.current.y;
    drag.current.dy = Math.max(0, d);
    setDy(drag.current.dy);
  }, []);

  const onPointerUp = useCallback(() => {
    if (!drag.current.active) return;
    const fired = drag.current.dy >= 120;
    drag.current.active = false;
    setDy(0);
    if (fired) onCloseRef.current();
  }, []);

  if (!open) return null;

  return (
    <div
      className="dx-sheet-back"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={sheetRef}
        className={`dx-sheet${half ? " dx-half" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? "Sheet"}
        style={dy ? { transform: `translateY(${dy}px)`, transition: "none" } : undefined}
      >
        <div
          className="dx-handle"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-hidden
        />
        {(title || true) && (
          <div className="dx-sheet-head">
            <span className="dx-sheet-title">{title ?? ""}</span>
            <button className="dx-iconbtn" onClick={onClose} aria-label="Close sheet" style={{ fontSize: 15 }}>
              ✕
            </button>
          </div>
        )}
        <div className="dx-sheet-body">{children}</div>
        {footer ? (
          <div style={{ padding: "0 14px 14px", display: "flex", gap: 8 }}>{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

/** List of actions inside a sheet (long-press menu, FAB menu, quick actions). */
export function ActionList({
  items,
  onPick,
}: {
  items: Array<{ key: string; label: string; icon?: string; danger?: boolean; hint?: string }>;
  onPick: (key: string) => void;
}) {
  return (
    <div className="dx-actions">
      {items.map((it) => (
        <button
          key={it.key}
          className="dx-row"
          onClick={() => onPick(it.key)}
          style={it.danger ? { color: "var(--dx-red)" } : undefined}
        >
          <span aria-hidden style={{ width: 20, textAlign: "center" }}>{it.icon ?? "›"}</span>
          <span style={{ fontSize: 13, letterSpacing: "0.05em" }}>{it.label}</span>
          {it.hint ? <span className="dx-right dx-faint" style={{ fontSize: 10 }}>{it.hint}</span> : null}
        </button>
      ))}
    </div>
  );
}
