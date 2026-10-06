// Bullion Droid — data hooks over the EXISTING /api surface (no new endpoints).
// Convention: parallel legs, fail-open, memoized derivatives, "—" on NaN.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Quote } from "@/lib/types";
import type { HistResp } from "./types";
import { droidStore } from "./droidStore";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /** unix ms of last successful load — drives "UPDATED 12S AGO" copy */
  ts: number;
}

function useAsync<T>(fn: () => Promise<T>, deps: React.DependencyList, pollMs = 0): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ts, setTs] = useState(0);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    alive.current = true;
    let cancel = false;
    setLoading(true);
    fnRef
      .current()
      .then((d) => {
        if (cancel || !alive.current) return;
        setData(d);
        setError(null);
        setTs(Date.now());
      })
      .catch((e: unknown) => {
        if (cancel || !alive.current) return;
        setError(e instanceof Error ? e.message || "TAPE OFF" : "TAPE OFF");
      })
      .finally(() => {
        if (!cancel && alive.current) setLoading(false);
      });
    return () => {
      cancel = true;
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  useEffect(() => {
    if (!pollMs) return;
    const onVis = () => {
      if (document.visibilityState === "visible") setTick((t) => t + 1);
    };
    // Only tick while the tab is actually on screen. A background interval
    // still spends the user's battery and, for news, still spends an upstream
    // request per tick for a screen nobody is looking at.
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      setTick((t) => t + 1);
    }, pollMs);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [pollMs]);

  return { data, loading, error, refresh, ts };
}

export function pollMs(): number {
  if (typeof window === "undefined") return 0;
  const lite = droidStore.isLite();
  const prefs = droidStore.getPrefs();
  return lite ? 60_000 : Math.max(10, prefs.refreshSec || 15) * 1000;
}

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.error) {
    throw new Error(String(j?.error ?? `${r.status} TAPE OFF`));
  }
  return j as T;
}

// ---------- quote ----------

const CONCURRENCY = 6;

export function useQuotes(symbols: string[]): AsyncState<Record<string, Quote>> {
  const key = symbols.join(",");
  const ms = pollMs();
  return useAsync<Record<string, Quote>>(async () => {
    const out: Record<string, Quote> = {};
    const queue = [...symbols];
    const errors: string[] = [];
    async function worker() {
      for (;;) {
        const s = queue.shift();
        if (!s) return;
        try {
          const q = await json<Quote>(`/api/quote?symbol=${encodeURIComponent(s)}`);
          out[s] = q;
        } catch (e: unknown) {
          errors.push(s);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, queue.length)) }, worker));
    if (Object.keys(out).length === 0 && errors.length) {
      throw new Error("QUOTE TAPE OFF — RETRY");
    }
    return out;
  }, [key], symbols.length ? ms : 0);
}

// ---------- history / chart ----------

export interface RangeSpec {
  label: string;
  range: string;
  interval: string;
}

export const RANGES: RangeSpec[] = [
  { label: "1D", range: "1d", interval: "5m" },
  { label: "1W", range: "5d", interval: "15m" },
  { label: "1M", range: "1mo", interval: "1d" },
  { label: "6M", range: "6mo", interval: "1d" },
  { label: "1Y", range: "1y", interval: "1d" },
  { label: "5Y", range: "5y", interval: "1wk" },
];

export function useHistory(
  symbol: string | null,
  range = "6mo",
  interval = "1d"
): AsyncState<HistResp> {
  return useAsync<HistResp>(
    () =>
      json<HistResp>(
        `/api/history?symbol=${encodeURIComponent(symbol || "")}&range=${range}&interval=${interval}`
      ),
    [symbol, range, interval],
    0
  );
}

// ---------- company profile (security page stats) ----------

export interface CompanyProfile {
  name?: string;
  exchange?: string;
  currency?: string;
  sector?: string;
  industry?: string;
  summary?: string;
  price?: {
    px?: number | null; prevClose?: number | null; open?: number | null;
    high?: number | null; low?: number | null; hi52?: number | null; lo52?: number | null;
    ma50?: number | null; ma200?: number | null; vol?: number | null; avgVol?: number | null;
    beta?: number | null;
  };
  valuation?: {
    mktCap?: number | null; ev?: number | null; trailPE?: number | null; fwdPE?: number | null;
    peg?: number | null; pb?: number | null; ps?: number | null; evEbitda?: number | null;
    trailEps?: number | null; fwdEps?: number | null; book?: number | null;
  };
  dividends?: { rate?: number | null; yield?: number | null; payout?: number | null; exDiv?: number | null };
  events?: { earnDate?: number | null };
  financials?: {
    revenue?: number | null; gross?: number | null; ebitda?: number | null; net?: number | null;
    ocf?: number | null; fcf?: number | null; cash?: number | null; debt?: number | null;
    revGrowth?: number | null; earnGrowth?: number | null;
  };
  margins?: { gross?: number | null; oper?: number | null; net?: number | null; ebitda?: number | null; roe?: number | null; roa?: number | null };
  holders?: { sharesOut?: number | null; float?: number | null; shortRatio?: number | null; insider?: number | null; instit?: number | null };
}

export interface CompanyResp {
  symbol: string;
  quote: Quote | null;
  profile: CompanyProfile | null;
  partial?: boolean;
  errors?: { quote?: string | null; history?: string | null; profile?: string | null };
  derived?: {
    offHighPct?: number | null; offLowPct?: number | null; avgVol20?: number | null;
    yieldPct?: number | null; mktCap?: number | null; trailPE?: number | null; fwdPE?: number | null;
  };
  links?: { screener?: string | null; tradingview?: string | null; yahoo?: string | null };
}

export function useCompany(symbol: string | null): AsyncState<CompanyResp> {
  return useAsync<CompanyResp>(
    () => json<CompanyResp>(`/api/company?symbol=${encodeURIComponent(symbol || "")}`),
    [symbol],
    0
  );
}

// ---------- generic GET with JSON body ----------

export function useApi<T>(path: string, enabled = true): AsyncState<T> {
  // Disabled legs never resolve → loading stays true, data stays null, and
  // the section renders its skeleton without burning a request.
  return useAsync<T>(
    () => (enabled ? json<T>(path) : new Promise<never>(() => undefined)),
    [path, enabled],
    0
  );
}

/**
 * A GET that re-fetches on an interval. Use for anything the user reads as a
 * live wire rather than a snapshot — news in particular. `useApi` fires once
 * and never again, which is right for reference data and wrong for a headline
 * feed: a droid home left open overnight would still be showing this morning's
 * tape.
 */
export function useApiPoll<T>(path: string, pollMs = 60_000, enabled = true): AsyncState<T> {
  return useAsync<T>(
    () => (enabled ? json<T>(path) : new Promise<never>(() => undefined)),
    [path, enabled],
    enabled ? pollMs : 0
  );
}

// ---------- responsive / lifecycle hooks ----------

export function useIsTablet(): boolean {
  return useMedia("(min-width: 768px)");
}

export function useIsDesktop(): boolean {
  return useMedia("(min-width: 1200px)");
}

export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    setMatch(mq.matches);
    const on = (e: MediaQueryListEvent) => setMatch(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

export function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}
