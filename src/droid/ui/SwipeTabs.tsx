"use client";

// Swipeable tab strip (spec §7): horizontal pan on the CONTENT changes tabs,
// the strip itself scrolls natively. Rubber-banded, threshold 60px.

import { useCallback, useRef, useState } from "react";

export interface TabDef {
  id: string;
  label: string;
}

export default function SwipeTabs({
  tabs,
  value,
  onChange,
  children,
  right,
}: {
  tabs: TabDef[];
  value: string;
  onChange: (id: string) => void;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  const idx = Math.max(0, tabs.findIndex((t) => t.id === value));
  const paneRef = useRef<HTMLDivElement>(null);
  const st = useRef({ x: 0, y: 0, dx: 0, lock: null as null | "h" | "v", id: 0 });
  const [dx, setDx] = useState(0);

  const go = useCallback(
    (dir: 1 | -1) => {
      const next = idx + dir;
      if (next < 0 || next >= tabs.length) return;
      onChange(tabs[next].id);
    },
    [idx, tabs, onChange]
  );

  const down = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    st.current = { x: e.clientX, y: e.clientY, dx: 0, lock: null, id: e.pointerId };
    setDx(0);
  };

  const move = (e: React.PointerEvent) => {
    const s = st.current;
    if (!s.id) return;
    const rawX = e.clientX - s.x;
    const rawY = e.clientY - s.y;
    if (!s.lock) {
      if (Math.abs(rawX) > 14 || Math.abs(rawY) > 14) {
        s.lock = Math.abs(rawX) > Math.abs(rawY) ? "h" : "v";
        if (s.lock === "h") {
          try {
            (e.currentTarget as HTMLElement).setPointerCapture(s.id);
          } catch {
            /* ignore */
          }
        }
      } else return;
    }
    if (s.lock !== "h") return;
    // rubber-band at the ends
    const atStart = idx === 0 && rawX > 0;
    const atEnd = idx === tabs.length - 1 && rawX < 0;
    s.dx = atStart || atEnd ? rawX * 0.25 : rawX;
    setDx(s.dx);
  };

  const up = () => {
    const s = st.current;
    const fired = s.dx;
    st.current = { x: 0, y: 0, dx: 0, lock: null, id: 0 };
    setDx(0);
    if (Math.abs(fired) >= 60) go(fired < 0 ? 1 : -1);
  };

  return (
    <div>
      <div className="dx-tabs">
        <div className="dx-tabs-strip" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === value}
              className={`dx-tab${t.id === value ? " dx-on" : ""}`}
              onClick={() => onChange(t.id)}
            >
              {t.label}
            </button>
          ))}
          {right}
        </div>
      </div>
      <div
        ref={paneRef}
        className="dx-tabpane"
        style={
          dx
            ? { transform: `translateX(${dx}px)`, opacity: 1 - Math.min(0.25, Math.abs(dx) / 600) }
            : undefined
        }
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        role="tabpanel"
      >
        {children}
      </div>
    </div>
  );
}
