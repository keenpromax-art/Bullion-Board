"use client";

// Scale-to-fit wrapper: the whole desk zooms down just enough to fit the
// panel height exactly — everything visible, never any scrolling.
// zoom <= 1 only (never upscale). Recomputes on panel resize and on
// content changes (data loads). Converges: measured height scales linearly
// with zoom, so one or two passes settle within 0.02 and stop.

import { useEffect, useRef, useState } from "react";

export default function FitBody({ children }: { children: React.ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);

  useEffect(() => {
    const o = outer.current;
    const s = inner.current;
    if (!o || !s) return;
    let raf = 0;
    const fit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const avail = o.clientHeight;
        if (!avail) return;
        const full = s.scrollHeight / (zoomRef.current || 1);
        if (!full || !isFinite(full)) return;
        const z = Math.min(1, avail / full);
        if (Math.abs(z - zoomRef.current) > 0.02) {
          zoomRef.current = z;
          setZoom(z);
        }
      });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(o);
    ro.observe(s);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={outer} className="fit-outer">
      <div ref={inner} className="fit-inner" style={{ zoom }}>
        {children}
      </div>
    </div>
  );
}
