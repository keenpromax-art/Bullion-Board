"use client";

// Touch-native chart (spec §S4/§7): pan · pinch zoom · long-press crosshair ·
// double-tap reset · keyboard pan/zoom. Renders SVG only — no chart library.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OHLCBar } from "@/lib/types";

interface Ptr {
  x: number;
  y: number;
}

const MAX_POINTS = 420;

export default function TouchChart({
  bars,
  height = 210,
  showVolume = true,
  lite = false,
  label = "PRICE",
}: {
  bars: OHLCBar[];
  height?: number;
  showVolume?: boolean;
  lite?: boolean;
  label?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(340);
  const [win, setWin] = useState<{ a: number; b: number } | null>(null);
  const [cross, setCross] = useState<number | null>(null);
  const ptrs = useRef(new Map<number, Ptr>());
  const gesture = useRef({
    startX: 0,
    startY: 0,
    startA: 0,
    startB: 0,
    moved: false,
    pinchDist: 0,
    pinchA: 0,
    pinchB: 0,
    longT: 0 as ReturnType<typeof setTimeout> | 0,
    lastTap: 0,
  });

  const len = bars.length;

  // default window = fit all
  useEffect(() => {
    setWin({ a: 0, b: Math.max(1, len) });
    setCross(null);
  }, [len]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(200, el.clientWidth)));
    ro.observe(el);
    setW(Math.max(200, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const geometry = useMemo(() => {
    if (!win || !len) return null;
    const i0 = Math.max(0, Math.floor(win.a));
    const i1 = Math.min(len - 1, Math.ceil(win.b));
    if (i1 < i0) return null;
    const k = Math.max(1, Math.round((i1 - i0) / MAX_POINTS));
    const idx: number[] = [];
    for (let i = i0; i <= i1; i += k) idx.push(i);
    if (idx[idx.length - 1] !== i1) idx.push(i1);

    let lo = Infinity;
    let hi = -Infinity;
    for (const i of idx) {
      const b = bars[i];
      if (!b) continue;
      if (isFinite(b.low)) lo = Math.min(lo, b.low);
      if (isFinite(b.high)) hi = Math.max(hi, b.high);
    }
    if (!isFinite(lo) || !isFinite(hi)) return null;
    const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.01 || 1;
    lo -= pad;
    hi += pad;

    const volH = showVolume ? Math.round(height * 0.18) : 0;
    const priceH = height - volH - 8;
    const x = (i: number) => ((i - win.a) / Math.max(1e-6, win.b - win.a)) * W;
    const y = (p: number) => priceH - ((p - lo) / Math.max(1e-9, hi - lo)) * priceH;

    const pts = idx.map((i) => ({ i, x: x(i), y: y(bars[i].close), c: bars[i].close }));
    const maxVol = Math.max(
      1,
      ...idx.map((i) => (isFinite(bars[i].volume) ? bars[i].volume : 0))
    );

    return { lo, hi, x, y, pts, idx, volH, priceH, maxVol, k };
  }, [win, bars, len, W, height, showVolume]);

  const clampWin = (a: number, b: number) => {
    let spanV = Math.min(Math.max(6, b - a), Math.max(6, len));
    let na = a;
    if (na < -2) na = -2;
    if (na + spanV > len + 2) na = len + 2 - spanV;
    if (na < -2) na = -2;
    return { a: na, b: na + spanV };
  };

  const reset = useCallback(() => setWin({ a: 0, b: Math.max(1, len) }), [len]);

  // ---------- pointer handling ----------
  const localX = (e: React.PointerEvent | PointerEvent) => {
    const el = wrapRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.min(Math.max(0, e.clientX - r.left), W);
  };

  const onDown = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (ptrs.current.size === 1) {
      g.startX = e.clientX;
      g.startY = e.clientY;
      g.startA = win?.a ?? 0;
      g.startB = win?.b ?? len;
      g.moved = false;
      // long-press → crosshair (560ms)
      g.longT = setTimeout(() => {
        if (gesture.current.moved) return;
        const x = localX(e);
        const w = win ?? { a: 0, b: len };
        const idx = Math.round(w.a + (x / W) * (w.b - w.a));
        setCross(Math.min(Math.max(0, idx), Math.max(0, len - 1)));
      }, 560);
    } else if (ptrs.current.size === 2) {
      if (g.longT) clearTimeout(g.longT);
      const [p1, p2] = [...ptrs.current.values()];
      g.pinchDist = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1;
      g.pinchA = win?.a ?? 0;
      g.pinchB = win?.b ?? len;
      setCross(null);
    }
  };

  const onMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (ptrs.current.size >= 2 && g.pinchDist) {
      const [p1, p2] = [...ptrs.current.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1;
      const scale = d / g.pinchDist;
      const span0 = Math.max(6, g.pinchB - g.pinchA);
      const mid = (g.pinchA + g.pinchB) / 2;
      const newSpan = Math.min(Math.max(6, span0 / scale), Math.max(6, len));
      setWin(clampWin(mid - newSpan / 2, mid + newSpan / 2));
      g.moved = true;
      return;
    }

    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (!g.moved && Math.hypot(dx, dy) > 8) {
      g.moved = true;
      if (g.longT) clearTimeout(g.longT);
    }

    if (cross !== null && ptrs.current.size === 1 && g.moved) {
      // dragging an active crosshair tracks the finger
      const x = localX(e);
      const w = win ?? { a: 0, b: len };
      const idx = Math.round(w.a + (x / W) * (w.b - w.a));
      setCross(Math.min(Math.max(0, idx), Math.max(0, len - 1)));
      return;
    }

    if (g.moved && win && ptrs.current.size === 1) {
      const spanV = g.startB - g.startA;
      const shift = (-dx / Math.max(1, W)) * spanV;
      setWin(clampWin(g.startA + shift, g.startB + shift));
    }
  };

  const onUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (g.longT) clearTimeout(g.longT);
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) g.pinchDist = 0;

    if (ptrs.current.size === 0) {
      // double-tap resets
      const now = Date.now();
      if (!g.moved && now - g.lastTap < 300) {
        reset();
        setCross(null);
        g.lastTap = 0;
      } else {
        g.lastTap = now;
      }
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!win) return;
    const s = win.b - win.a;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const dirn = e.key === "ArrowLeft" ? -1 : 1;
      const shift = dirn * s * 0.15;
      setWin(clampWin(win.a + shift, win.b + shift));
    } else if (e.key === "+" || e.key === "=" || e.key === "-") {
      e.preventDefault();
      const f = e.key === "-" ? 1.25 : 0.8;
      const mid = (win.a + win.b) / 2;
      const ns = Math.min(Math.max(6, s * f), Math.max(6, len));
      setWin(clampWin(mid - ns / 2, mid + ns / 2));
    } else if (e.key === "Escape") {
      setCross(null);
    }
  };

  if (!len) {
    return (
      <div className="dx-chart" style={{ height }} ref={wrapRef}>
        <div className="dx-state" style={{ height: "100%", border: "none" }}>
          <div className="dx-state-t">NO TAPE</div>
          <div className="dx-state-d">NO BARS RETURNED FOR THIS RANGE.</div>
        </div>
      </div>
    );
  }

  const g = geometry;
  const last = bars[len - 1];
  const prev = len > 1 ? bars[len - 2] : null;
  const lastUp = prev && last.close >= prev.close;

  return (
    <div
      className="dx-chart"
      ref={wrapRef}
      style={{ height }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onKeyDown={onKey}
      tabIndex={0}
      role="img"
      aria-label={`${label} chart — ${len} bars, drag to pan, pinch to zoom, long-press for crosshair`}
    >
      {g ? (
        <svg width={W} height={height} viewBox={`0 0 ${W} ${height}`} aria-hidden>
          {/* price line */}
          <path
            d={`M ${g.pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L ")}`}
            fill="none"
            stroke={lastUp ? "var(--dx-green)" : "var(--dx-red)"}
            strokeWidth={1.6}
            strokeLinejoin="round"
          />
          {/* last price tag */}
          <line
            x1={0}
            x2={W}
            y1={g.y(last.close)}
            y2={g.y(last.close)}
            stroke="rgba(255,176,0,0.55)"
            strokeDasharray="3 3"
            strokeWidth={1}
          />
          {showVolume &&
            g.idx.map((i) => {
              const b = bars[i];
              const v = isFinite(b.volume) ? b.volume : 0;
              const h = (v / g.maxVol) * g.volH;
              const bw = Math.max(1, (W / Math.max(8, g.idx.length)) * 0.6);
              return (
                <rect
                  key={`v${i}`}
                  x={g.x(i) - bw / 2}
                  y={height - h}
                  width={bw}
                  height={h}
                  fill={b.close >= b.open ? "rgba(0,214,100,0.28)" : "rgba(255,69,58,0.28)"}
                />
              );
            })}
          {/* crosshair */}
          {cross !== null && bars[cross] ? (
            <g>
              <line
                x1={g.x(cross)}
                x2={g.x(cross)}
                y1={0}
                y2={height}
                stroke="var(--dx-amber)"
                strokeWidth={1}
                strokeDasharray="2 3"
              />
              <line
                x1={0}
                x2={W}
                y1={g.y(bars[cross].close)}
                y2={g.y(bars[cross].close)}
                stroke="var(--dx-amber)"
                strokeWidth={1}
                strokeDasharray="2 3"
              />
              <circle cx={g.x(cross)} cy={g.y(bars[cross].close)} r={3} fill="var(--dx-amber)" />
            </g>
          ) : null}
        </svg>
      ) : null}

      {cross !== null && bars[cross] ? (
        <div className="dx-chart-tip">
          <span><b>{bars[cross].date}</b></span>
          <span>O <b>{bars[cross].open.toFixed(2)}</b></span>
          <span>H <b>{bars[cross].high.toFixed(2)}</b></span>
          <span>L <b>{bars[cross].low.toFixed(2)}</b></span>
          <span>C <b>{bars[cross].close.toFixed(2)}</b></span>
          {lite ? null : <span>VOL <b>{Math.round(bars[cross].volume || 0).toLocaleString("en-IN")}</b></span>}
        </div>
      ) : null}
    </div>
  );
}
