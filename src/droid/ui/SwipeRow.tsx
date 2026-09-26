"use client";

// Swipe-left row (spec §7): reveals ONE 76px action slot; the slot itself
// scrolls horizontally so all four actions stay reachable on a 360px phone.
// Long-press (450ms) opens the action sheet without firing the tap.

import { useEffect, useRef, useState } from "react";

export interface SwipeAction {
  key: string;
  label: string;
  color: string;
  onClick: () => void;
}

const REVEAL = 76;

export default function SwipeRow({
  actions,
  children,
  onTap,
  onLongPress,
}: {
  actions: SwipeAction[];
  children: React.ReactNode;
  onTap?: () => void;
  onLongPress?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const st = useRef({ x: 0, y: 0, dx: 0, lock: null as null | "h" | "v", moved: false, fired: false, lp: 0 as ReturnType<typeof setTimeout> | 0 });

  useEffect(() => () => {
    if (st.current.lp) clearTimeout(st.current.lp);
  }, []);

  const inner = () => ref.current?.querySelector(".dx-swipe-inner") as HTMLElement | null;

  const down = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    st.current = { ...st.current, x: e.clientX, y: e.clientY, dx: open ? -REVEAL : 0, lock: null, moved: false, fired: false };
    if (onLongPress) {
      st.current.lp = setTimeout(() => {
        if (st.current.moved) return;
        st.current.fired = true;
        try {
          navigator.vibrate?.(12);
        } catch {
          /* no haptics */
        }
        onLongPress();
      }, 450);
    }
  };

  const move = (e: React.PointerEvent) => {
    const s = st.current;
    const rawX = e.clientX - s.x;
    const rawY = e.clientY - s.y;
    if (!s.lock) {
      if (Math.abs(rawX) > 12 || Math.abs(rawY) > 12) {
        s.lock = Math.abs(rawX) > Math.abs(rawY) ? "h" : "v";
        if (s.lock === "h" && s.lp) clearTimeout(s.lp);
        if (s.lock === "h") {
          try {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
        }
      } else return;
    }
    if (s.lock !== "h") return;
    s.moved = true;
    if (s.lp) clearTimeout(s.lp);
    const base = open ? -REVEAL : 0;
    let next = base + rawX;
    if (next > 0) next = next * 0.2;
    if (next < -REVEAL) next = -REVEAL + (next + REVEAL) * 0.25;
    s.dx = next;
    const el = inner();
    if (el) {
      el.style.transition = "none";
      el.style.transform = `translateX(${next}px)`;
    }
  };

  const up = () => {
    const s = st.current;
    if (s.lp) clearTimeout(s.lp);
    const el = inner();
    if (el && s.lock) {
      el.style.transition = "";
      const finalOpen = s.dx < -34;
      el.style.transform = `translateX(${finalOpen ? -REVEAL : 0}px)`;
      setOpen(finalOpen);
      if (finalOpen) slotRef.current?.scrollTo({ left: 0 });
    }
    if (!s.moved && !s.fired && !open && onTap) onTap();
    st.current = { ...s, dx: 0, lock: null, moved: false, fired: false };
  };

  const close = () => {
    setOpen(false);
    const el = inner();
    if (el) el.style.transform = "translateX(0)";
  };

  return (
    <div className="dx-swipe" ref={ref}>
      <div
        ref={slotRef}
        className="dx-swipe-actions"
        style={{ width: REVEAL, overflowX: "auto", scrollbarWidth: "none" }}
      >
        {actions.map((a) => (
          <button
            key={a.key}
            style={{ background: a.color, width: REVEAL, flex: "0 0 auto" }}
            onClick={() => {
              close();
              a.onClick();
            }}
          >
            {a.label}
          </button>
        ))}
      </div>
      <div
        className="dx-swipe-inner dx-row"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {children}
      </div>
    </div>
  );
}
