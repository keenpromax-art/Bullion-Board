"use client";

// Scale-to-fit wrapper with an escape hatch: `fit` mode zooms the whole
// desk down just enough to fit the panel height exactly (no scrolling);
// `full` mode renders 1:1 with internal scrolling for close reading.
// zoom <= 1 only in fit mode (never upscale). Recomputes on panel resize
// and on content changes (data loads). Converges: measured height scales
// linearly with zoom, so one or two passes settle within 0.02 and stop.

import { useEffect, useRef, useState } from "react";

export default function FitBody({
  mode,
  onZoom,
  children,
}: {
  mode: "fit" | "full";
  onZoom?: (z: number) => void;
  children: React.ReactNode;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const cbRef = useRef(onZoom);
  cbRef.current = onZoom;

  useEffect(() => {
    const o = outer.current;
    const s = inner.current;
    if (!o || !s) return;
    let raf = 0;
    const fit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (modeRef.current !== "fit") {
          if (zoomRef.current !== 1) {
            zoomRef.current = 1;
            setZoom(1);
            cbRef.current?.(1);
          }
          return;
        }
        const avail = o.clientHeight;
        if (!avail) return;
        const full = s.scrollHeight / (zoomRef.current || 1);
        if (!full || !isFinite(full)) return;
        const z = Math.min(1, avail / full);
        if (Math.abs(z - zoomRef.current) > 0.02) {
          zoomRef.current = z;
          setZoom(z);
          cbRef.current?.(z);
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
    <div ref={outer} className="fit-outer" data-mode={mode}>
      <div ref={inner} className="fit-inner" style={mode === "fit" ? { zoom } : undefined}>
        {children}
      </div>
    </div>
  );
}
