"use client";

// Stat cells, metric groups, list rows, news cards — the shared vocabulary
// every droid screen consumes (spec §5 / §25 component hierarchy).

import type { ReactNode } from "react";
import { Explainable } from "@/components/Explain";
import type { ExplainContext } from "@/lib/explain";
import { dir } from "../lib/format";

export interface CellDef {
  label: string;
  value: ReactNode;
  sub?: string;
  term?: string;
  ctx?: ExplainContext;
  onClick?: () => void;
}

/** Stat strip — the desk-anatomy "cells" row, at mobile density. */
export function StatStrip({ cells, cols = 3 }: { cells: CellDef[]; cols?: 3 | 2 }) {
  if (!cells.length) return null;
  return (
    <div className="dx-stats" style={cols === 2 ? { gridTemplateColumns: "1fr 1fr" } : undefined}>
      {cells.map((c, i) => {
        const body = (
          <>
            <span className="dx-l">{c.label}</span>
            <span className="dx-v">{c.value}</span>
            {c.sub ? <span className="dx-l" style={{ color: "var(--dx-faint)" }}>{c.sub}</span> : null}
          </>
        );
        return c.onClick || c.term ? (
          <button key={i} className="dx-cell dx-tap" onClick={c.onClick} type="button">
            {c.term ? (
              <span className="dx-l">
                <Explainable term={c.term} ctx={c.ctx} dot>
                  {c.label}
                </Explainable>
              </span>
            ) : (
              <span className="dx-l">{c.label}</span>
            )}
            <span className="dx-v">{c.value}</span>
            {c.sub ? <span className="dx-l" style={{ color: "var(--dx-faint)" }}>{c.sub}</span> : null}
          </button>
        ) : (
          <div key={i} className="dx-cell">
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** Key/value metric rows — the mobile replacement for wide FY tables (§26). */
export function MetricList({
  rows,
  title,
}: {
  rows: Array<{ label: string; value: ReactNode; term?: string; ctx?: ExplainContext; tone?: number }>;
  title?: string;
}) {
  if (!rows.length) return null;
  return (
    <div className="dx-card">
      {title ? <div className="p-head">{title}</div> : null}
      {rows.map((r, i) => (
        <div className="dx-metric" key={i}>
          <span className="dx-ml">
            {r.term ? (
              <Explainable term={r.term} ctx={r.ctx} dot>
                {r.label}
              </Explainable>
            ) : (
              r.label
            )}
          </span>
          <span className={`dx-mv${r.tone !== undefined ? ` ${dir(r.tone)}` : ""}`}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function ListRow({
  symbol,
  name,
  right,
  rightSub,
  onClick,
  onLongPress,
  badge,
  children,
}: {
  symbol: string;
  name?: string;
  right?: ReactNode;
  rightSub?: ReactNode;
  onClick?: () => void;
  onLongPress?: () => void;
  badge?: ReactNode;
  children?: ReactNode;
}) {
  const timer = { current: 0 as ReturnType<typeof setTimeout> | 0, fired: false };
  return (
    <button
      className="dx-row"
      type="button"
      onClick={() => {
        if (timer.fired) {
          timer.fired = false;
          return;
        }
        onClick?.();
      }}
      onPointerDown={() => {
        timer.fired = false;
        if (!onLongPress) return;
        timer.current = setTimeout(() => {
          timer.fired = true;
          onLongPress();
        }, 450);
      }}
      onPointerUp={() => timer.current && clearTimeout(timer.current)}
      onPointerLeave={() => timer.current && clearTimeout(timer.current)}
      onContextMenu={(e) => onLongPress && e.preventDefault()}
    >
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span className="dx-sym dx-ellipsis">{symbol}</span>
        {name ? <span className="dx-name dx-ellipsis">{name}</span> : null}
        {children}
      </span>
      {badge}
      <span className="dx-right">
        {right != null ? <span className="dx-px">{right}</span> : null}
        {rightSub != null ? <span className="dx-chg">{rightSub}</span> : null}
      </span>
    </button>
  );
}

export function SignalRow({
  label,
  value,
  tone,
  detail,
}: {
  label: string;
  value: string;
  tone: number | null | undefined;
  detail?: string;
}) {
  const cls = tone === null || tone === undefined || !isFinite(tone)
    ? "dx-faint"
    : tone > 0
      ? "dx-up"
      : tone < 0
        ? "dx-down"
        : "dx-sub";
  return (
    <div className="dx-signal">
      <span className="dx-sl">{label}</span>
      <span className={`dx-sv ${cls}`}>{value}</span>
      {detail ? <span className="dx-sd">{detail}</span> : null}
    </div>
  );
}

export function Verdict({ children, icon = "▮" }: { children: ReactNode; icon?: string }) {
  return (
    <div className="dx-verdict">
      <span className="dx-amber" aria-hidden>{icon}</span>
      <span>{children}</span>
    </div>
  );
}
