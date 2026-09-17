"use client";

// Global explain system — one singleton popover, portalled to document.body.
// Delegated listener on [data-explain] attributes for zero-touch wiring.
// Alt+E toggles EXPLAIN MODE; select-to-explain chip on text selection.

import React, {
  createContext, useCallback, useContext, useEffect,
  useMemo, useRef, useState,
} from "react";
import { createPortal } from "react-dom";
import { lookup, normKey, buildExplainPrompt, cacheKey, type ExplainEntry, type ExplainContext } from "@/lib/explain";
import { chatComplete, streamChat, aiSystem, NO_INVENT } from "@/lib/ai";
import { store } from "@/lib/store";

// ---------- Context ----------

interface ExplainState {
  open: boolean;
  label: string;
  ctx: ExplainContext;
  anchor: DOMRect | null;
  mode: boolean;
  tier1: ExplainEntry | null;
  tier2: string;
  tier2Loading: boolean;
  source: string;
  model: string;
}

interface ExplainAPI {
  open(label: string, ctx?: ExplainContext, anchor?: DOMRect): void;
  close(): void;
  mode: boolean;
  toggleMode(): void;
}

const ExplainCtx = createContext<ExplainAPI>({
  open: () => {},
  close: () => {},
  mode: false,
  toggleMode: () => {},
});

export function useExplain(): ExplainAPI {
  return useContext(ExplainCtx);
}

// ---------- Provider ----------

export function ExplainProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ExplainState>({
    open: false, label: "", ctx: {}, anchor: null, mode: false,
    tier1: null, tier2: "", tier2Loading: false, source: "", model: "",
  });
  const abortRef = useRef<AbortController | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [selChip, setSelChip] = useState<{ text: string; x: number; y: number } | null>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Delegated listener for [data-explain]
  useEffect(() => {
    const trigger = store.getExplainTrigger();
    if (trigger === "off") return;

    function resolve(explainAttr: string, ctxAttr?: string, anchorEl?: Element): {
      label: string; ctx: ExplainContext; rect: DOMRect;
    } {
      let ctx: ExplainContext = {};
      if (ctxAttr) {
        try { ctx = JSON.parse(ctxAttr); } catch { /* noop */ }
      }
      // Try to get desk context from closest p-head
      const panel = anchorEl?.closest(".panel");
      const pHead = panel?.querySelector(".p-head");
      if (pHead && !ctx.desk) {
        ctx.desk = pHead.textContent?.slice(0, 80) ?? "";
      }
      const rect = (anchorEl as HTMLElement | null)?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0);
      return { label: explainAttr, ctx, rect };
    }

    // Find the nearest explainable ancestor (explicit data-explain OR implicit .p-head/.cell .lbl/table th/td strong)
    function findExplainable(target: HTMLElement): { el: HTMLElement; label: string; ctx: ExplainContext } | null {
      // 1. Explicit data-explain
      const explicit = target.closest("[data-explain]");
      if (explicit) {
        return {
          el: explicit as HTMLElement,
          label: explicit.getAttribute("data-explain") ?? "",
          ctx: JSON.parse(explicit.getAttribute("data-explain-ctx") ?? "{}"),
        };
      }
      // 2. Implicit: .p-head (panel header)
      if (target.matches(".p-head")) {
        return { el: target, label: target.textContent?.trim() ?? "", ctx: {} };
      }
      // 3. Implicit: .cell .lbl (stat label)
      const cellLabel = target.closest(".cell .lbl");
      if (cellLabel && cellLabel.matches(".lbl")) {
        return { el: cellLabel as HTMLElement, label: cellLabel.textContent?.trim() ?? "", ctx: {} };
      }
      // 4. Implicit: table th (column header)
      if (target.matches("table th")) {
        return { el: target, label: target.textContent?.trim() ?? "", ctx: {} };
      }
      // 5. Implicit: <strong> inside table td (row label — first strong in the row)
      const tdStrong = target.closest("td strong");
      if (tdStrong) {
        const text = tdStrong.textContent?.trim() ?? "";
        // Only explain short labels (skip long values/numbers)
        if (text.length > 0 && text.length < 60 && !/^\d/.test(text)) {
          return { el: tdStrong as HTMLElement, label: text, ctx: {} };
        }
      }
      return null;
    }

    function onClick(e: MouseEvent) {
      const hit = findExplainable(e.target as HTMLElement);
      if (!hit || !hit.label) return;
      const { label, ctx } = hit;
      const rect = hit.el.getBoundingClientRect();
      e.preventDefault();
      e.stopPropagation();
      openExplain(label, ctx, rect);
    }

    function onHover(e: MouseEvent) {
      if (store.getExplainTrigger() !== "hover+click") return;
      const hit = findExplainable(e.target as HTMLElement);
      if (!hit || !hit.label) return;
      const { label, ctx } = hit;
      const rect = hit.el.getBoundingClientRect();
      // Show tier-1 instantly
      const entry = lookup(label);
      setState((s) => ({
        ...s, open: true, label, ctx, anchor: rect,
        tier1: entry, tier2: "", tier2Loading: false,
        source: ctx.source ?? "GLOSSARY", model: store.getORModel(),
      }));
    }

    function onMouseLeave(e: MouseEvent) {
      const hit = findExplainable(e.target as HTMLElement);
      if (!hit) return;
      // Only close if not moving to the popover
      const related = e.relatedTarget as HTMLElement | null;
      if (related && (related.closest(".explain-popover") || related === tipRef.current)) return;
      setState((s) => ({ ...s, open: false }));
    }

    document.addEventListener("click", onClick);
    document.addEventListener("mouseover", onHover);
    document.addEventListener("mouseout", onMouseLeave);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("mouseover", onHover);
      document.removeEventListener("mouseout", onMouseLeave);
    };
  }, []);

  // Select-to-explain: show chip on text selection
  useEffect(() => {
    function onMouseUp(e: MouseEvent) {
      // Ignore clicks inside the chip itself or the explain popover
      const target = e.target as HTMLElement;
      if (target.closest(".explain-popover") || target.closest(".explain-tooltip") || target.closest(".explain-sel-chip")) return;
      // Small delay to let selection settle
      setTimeout(() => {
        const sel = window.getSelection();
        const text = sel?.toString().trim() ?? "";
        if (text.length < 2 || text.length > 120) { setSelChip(null); return; }
        // Ignore if selection is inside an input/textarea
        const anchor = sel?.anchorNode;
        if (anchor && (anchor.parentElement?.tagName === "INPUT" || anchor.parentElement?.tagName === "TEXTAREA")) return;
        const range = sel?.getRangeAt(0);
        if (!range) return;
        const rect = range.getBoundingClientRect();
        setSelChip({
          text,
          x: Math.min(rect.left + rect.width / 2, window.innerWidth - 100),
          y: rect.top - 8,
        });
      }, 10);
    }
    function onMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest(".explain-sel-chip")) {
        setSelChip(null);
      }
    }
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, []);

  // Esc to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && state.open) {
        close();
      }
      // Alt+E toggle
      if ((e.altKey || e.metaKey) && (e.key === "e" || e.key === "E") && !isTyping(e.target as Element | null)) {
        e.preventDefault();
        toggleMode();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.open, state.mode]);

  function isTyping(el: Element | null): boolean {
    if (!el) return false;
    const tag = (el.tagName || "").toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable;
  }

  const openExplain = useCallback((label: string, ctx: ExplainContext = {}, anchor?: DOMRect) => {
    const rect = anchor ?? new DOMRect(0, 0, 0, 0);
    const entry = lookup(label);
    setState((s) => ({
      ...s, open: true, label, ctx, anchor: rect,
      tier1: entry, tier2: "", tier2Loading: false,
      source: ctx.source ?? "GLOSSARY", model: store.getORModel(),
    }));
    // If no glossary entry and AI enabled, auto-fetch tier-2
    if (!entry && store.getExplainAI()) {
      fetchTier2(label, ctx);
    }
  }, []);

  const close = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState((s) => ({ ...s, open: false, tier2: "", tier2Loading: false }));
  }, []);

  const toggleMode = useCallback(() => {
    setState((s) => ({ ...s, mode: !s.mode }));
  }, []);

  const fetchTier2 = useCallback(async (label: string, ctx: ExplainContext) => {
    const ck = cacheKey(label, ctx);
    // Check cache
    const cached = store.getExplainCacheEntry(ck);
    if (cached) {
      setState((s) => ({ ...s, tier2: cached, tier2Loading: false }));
      return;
    }
    // Dedup in-flight
    const existing = store.getExplainInFlight(ck);
    if (existing) {
      try {
        const text = await existing;
        setState((s) => ({ ...s, tier2: text, tier2Loading: false }));
      } catch { /* noop */ }
      return;
    }

    const entry = lookup(label);
    const msgs = buildExplainPrompt(label, entry, ctx);
    const isDef = !ctx.symbol;

    setState((s) => ({ ...s, tier2Loading: true }));

    let full = "";
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const p = streamChat(msgs, {
      model: store.getExplainerModel(),
      apiKey: store.getORKey(),
      signal: ctrl.signal,
      onToken: (t) => {
        full += t;
        setState((s) => ({ ...s, tier2: full }));
      },
    });

    store.setExplainInFlight(ck, p);

    try {
      await p;
      store.setExplainCacheEntry(ck, full, isDef);
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        setState((s) => ({
          ...s, tier2: s.tier2 || "AI OFFLINE — GLOSSARY ONLY",
          tier2Loading: false,
        }));
      }
    } finally {
      setState((s) => ({ ...s, tier2Loading: false }));
      abortRef.current = null;
    }
  }, []);

  // Position popover (flip above if no room below)
  const popoverStyle = useMemo(() => {
    if (!state.anchor) return {};
    const w = isMobile ? window.innerWidth - 32 : 420;
    const h = 520;
    let x = state.anchor.right + 8;
    let y = state.anchor.top;
    if (typeof window !== "undefined") {
      if (x + w > window.innerWidth) x = state.anchor.left - w - 8;
      if (x < 8) x = 8;
      if (y + h > window.innerHeight) y = window.innerHeight - h - 8;
      if (y < 8) y = 8;
    }
    if (isMobile) {
      return { position: "fixed" as const, left: 16, right: 16, bottom: 16, top: "auto" as const, zIndex: 9999 };
    }
    return { position: "fixed" as const, left: x, top: y, zIndex: 9999 };
  }, [state.anchor, isMobile]);

  const api = useMemo<ExplainAPI>(() => ({
    open: openExplain,
    close,
    mode: state.mode,
    toggleMode,
  }), [openExplain, close, state.mode, toggleMode]);

  const touchStartY = useRef(0);

  // Swipe-to-dismiss on mobile bottom-sheet
  useEffect(() => {
    if (!isMobile) return;
    function onTouchStart(e: TouchEvent) {
      touchStartY.current = e.touches[0].clientY;
    }
    function onTouchEnd(e: TouchEvent) {
      const dy = e.changedTouches[0].clientY - touchStartY.current;
      if (dy > 60) close(); // swipe down = dismiss
    }
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [isMobile, close]);

  // Parse tier-2 into sections
  const sections = useMemo(() => {
    if (!state.tier2) return [];
    const lines = state.tier2.split("\n");
    const result: Array<{ header?: string; body: string }> = [];
    let cur: { header?: string; body: string } = { body: "" };
    for (const line of lines) {
      const m = line.match(/^(WHAT IT IS|HOW IT.?S? COMPUTED|WHY IT MATTERS|INDIA NOTE|READ HERE|WATCH FOR|ANSWER|EVIDENCE|SOURCE|MORE)\s*[:—–-]\s*(.*)/i);
      if (m) {
        if (cur.body.trim()) result.push(cur);
        cur = { header: m[1].toUpperCase(), body: m[2] };
      } else {
        cur.body += (cur.body ? "\n" : "") + line;
      }
    }
    if (cur.body.trim()) result.push(cur);
    return result;
  }, [state.tier2]);

  const tip1Sections = useMemo(() => {
    if (!state.tier1) return [];
    const s: Array<{ header: string; body: string }> = [];
    if (state.tier1.what) s.push({ header: "WHAT IT IS", body: state.tier1.what });
    if (state.tier1.how) s.push({ header: "HOW IT'S COMPUTED", body: state.tier1.how });
    if (state.tier1.goodBad) s.push({ header: "WHY IT MATTERS", body: state.tier1.goodBad });
    if (state.tier1.indiaNote) s.push({ header: "INDIA NOTE", body: state.tier1.indiaNote });
    return s;
  }, [state.tier1]);

  const hasData = state.ctx.values && state.ctx.values.some((v) => v !== null && v !== undefined);

  return (
    <ExplainCtx.Provider value={api}>
      {children}
      {/* EXPLAIN MODE overlay indicator */}
      {state.mode && typeof document !== "undefined" && createPortal(
        <>
          <style>{`
            .p-head, .cell .lbl, table th {
              cursor: help !important;
              border-bottom: 1px dotted #ffa028 !important;
            }
          `}</style>
          <div style={{
            position: "fixed", top: 0, left: 0, right: 0, zIndex: 10000,
            background: "rgba(255,160,40,0.12)", borderBottom: "2px solid #ffa028",
            padding: "4px 12px", fontFamily: "var(--mono)", fontSize: 11,
            color: "#ffa028", textAlign: "center", pointerEvents: "none",
          }}>
            EXPLAIN MODE ● ON — CLICK ANY DOTTLED LABEL TO EXPLAIN · ALT+E OR ESC TO EXIT
          </div>
        </>,
        document.body,
      )}
      {/* Select-to-explain chip */}
      {selChip && typeof document !== "undefined" && createPortal(
        <div
          ref={chipRef}
          className="explain-sel-chip"
          style={{
            position: "fixed",
            left: selChip.x,
            top: selChip.y,
            transform: "translate(-50%, -100%)",
            zIndex: 10001,
            background: "#1a1a1e",
            border: "1px solid #ffa028",
            borderRadius: 3,
            padding: "3px 8px",
            fontFamily: "var(--mono)",
            fontSize: 10,
            color: "#ffa028",
            cursor: "pointer",
            whiteSpace: "nowrap",
            boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
            letterSpacing: "0.06em",
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const label = selChip.text;
            // Find anchor rect from selection
            const sel = window.getSelection();
            const range = sel?.getRangeAt(0);
            const rect = range?.getBoundingClientRect();
            setSelChip(null);
            openExplain(label, {}, rect);
          }}
        >
          ▮ EXPLAIN
        </div>,
        document.body,
      )}
      {/* Tier-1 hover tooltip (follows cursor, pointer-events none) */}
      {state.open && state.tier1 && !state.tier2 && state.anchor && typeof document !== "undefined" && createPortal(
        <div
          ref={tipRef}
          className="explain-tooltip"
          style={{
            position: "fixed",
            left: Math.min(state.anchor.right + 8, (typeof window !== "undefined" ? window.innerWidth : 800) - 360),
            top: state.anchor.top,
            zIndex: 9998,
            maxWidth: 350, minWidth: 250,
            background: "#0a0a0c", border: "1px solid #ffa028",
            borderRadius: 3, padding: "8px 10px",
            fontFamily: "var(--mono)", fontSize: 11.5, lineHeight: 1.55,
            color: "#c9c9cf", pointerEvents: "none",
            boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
          }}
        >
          {tip1Sections.map((s, i) => (
            <div key={i} style={{ marginBottom: i < tip1Sections.length - 1 ? 4 : 0 }}>
              <span style={{ color: "#ffa028", fontSize: 10, fontWeight: 700 }}>{s.header}: </span>
              <span>{s.body}</span>
            </div>
          ))}
          {!store.getExplainAI() && (
            <div style={{ marginTop: 4, fontSize: 10, color: "#5b5b62" }}>
              AI OFF — GLOSSARY ONLY
            </div>
          )}
        </div>,
        document.body,
      )}
      {/* Tier-2 full popover (interactive, portalled) */}
      {state.open && (state.tier2 || state.tier1) && state.anchor && typeof document !== "undefined" && createPortal(
        <div
          className="explain-popover"
          role="dialog"
          aria-label={`Explain: ${state.label}`}
          style={{
            ...popoverStyle as React.CSSProperties,
            maxWidth: isMobile ? "100%" : 420,
            maxHeight: isMobile ? "70vh" : "min(60vh, 520px)",
            overflowY: "auto",
            background: "#121214",
            border: "1px solid #ffa028",
            borderRadius: 3,
            fontFamily: "var(--mono)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
            ...(isMobile ? { borderTop: "2px solid #ffa028" } : {}),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Mobile drag handle */}
          {isMobile && (
            <div style={{
              display: "flex", justifyContent: "center", padding: "6px 0 0",
            }}>
              <div style={{
                width: 36, height: 4, borderRadius: 2,
                background: "#3a3a40",
              }} />
            </div>
          )}
          {/* Header */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 12px", borderBottom: "1px solid #26262b",
          }}>
            <span style={{ color: "#ffa028", fontWeight: 700, fontSize: 13, flex: 1, letterSpacing: "0.05em" }}>
              ▮ {state.label.toUpperCase()}
            </span>
            <span style={{ color: "#5b5b62", fontSize: 10 }}>
              {state.source}
            </span>
            <button
              onClick={close}
              style={{
                background: "none", border: "none", color: "#5b5b62",
                cursor: "pointer", fontSize: 16, padding: "0 4px", lineHeight: 1,
              }}
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {/* Body */}
          <div style={{ padding: "10px 12px" }}>
            {/* Tier-1 sections (always shown) */}
            {!state.tier2 && tip1Sections.map((s, i) => (
              <div key={i} style={{ marginBottom: 10 }}>
                <div style={{
                  fontSize: 10.5, fontWeight: 700, color: "#ffa028",
                  textTransform: "uppercase", letterSpacing: "0.08em",
                  marginBottom: 3, borderBottom: "1px solid rgba(255,160,40,0.2)",
                  paddingBottom: 2,
                }}>
                  {s.header}
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.55, color: "#f5f5f4", textTransform: "none" }}>
                  {s.body}
                </div>
              </div>
            ))}

            {/* Tier-2 sections (streamed or cached) */}
            {sections.map((s, i) => (
              <div key={i} style={{ marginBottom: 10 }}>
                {s.header && (
                  <div style={{
                    fontSize: 10.5, fontWeight: 700, color: "#ffa028",
                    textTransform: "uppercase", letterSpacing: "0.08em",
                    marginBottom: 3, borderBottom: "1px solid rgba(255,160,40,0.2)",
                    paddingBottom: 2,
                    display: "flex", alignItems: "center", gap: 6,
                  }}>
                    {s.header}
                    {s.header === "READ HERE" && state.tier2Loading && (
                      <span style={{
                        width: 6, height: 6, borderRadius: "50%",
                        background: "#ffa028", display: "inline-block",
                      }} />
                    )}
                  </div>
                )}
                <div style={{
                  fontSize: 12, lineHeight: 1.55, color: "#f5f5f4",
                  textTransform: "none", whiteSpace: "pre-wrap",
                }}>
                  {s.body}
                </div>
              </div>
            ))}

            {/* Loading state */}
            {state.tier2Loading && !state.tier2 && (
              <div style={{ fontSize: 12, color: "#5b5b62" }}>
                LOADING…
              </div>
            )}

            {/* No glossary + no AI */}
            {!state.tier1 && !state.tier2 && !state.tier2Loading && (
              <div style={{ fontSize: 12, color: "#5b5b62" }}>
                NO GLOSSARY ENTRY — {store.getExplainAI() ? "CLICK FOR AI READ" : "ENABLE AI IN SETTINGS"}
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "6px 12px", borderTop: "1px solid #26262b", fontSize: 10, color: "#5b5b62",
          }}>
            <span>SOURCE: {state.source}</span>
            <span>{state.model?.split("/").pop() ?? "NEMOTRON"}</span>
          </div>
        </div>,
        document.body,
      )}
    </ExplainCtx.Provider>
  );
}

// ---------- Explainable wrapper ----------

export function Explainable({
  term, ctx, as, children, dot,
}: {
  term: string;
  ctx?: ExplainContext;
  as?: keyof JSX.IntrinsicElements;
  children?: React.ReactNode;
  dot?: boolean;
}) {
  const { mode } = useExplain();
  const { open } = useExplain();
  const localRef = useRef<any>(null);

  const style: React.CSSProperties = mode
    ? { borderBottom: "1px dotted #ffa028", cursor: "help" }
    : {};

  const TagName = as ?? "span";

  return (
    <span
      ref={localRef}
      data-explain={term}
      data-explain-ctx={ctx ? JSON.stringify(ctx) : undefined}
      style={style}
      tabIndex={mode ? 0 : undefined}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (mode && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          const rect = localRef.current?.getBoundingClientRect?.();
          if (rect) open(term, ctx ?? {}, rect);
        }
      }}
      onFocus={() => {
        if (mode) {
          const rect = localRef.current?.getBoundingClientRect?.();
          if (rect) open(term, ctx ?? {}, rect);
        }
      }}
    >
      {children ?? term}
    </span>
  );
}
