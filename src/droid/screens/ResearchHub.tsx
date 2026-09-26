"use client";

// RESEARCH HUB (spec §S12) — saved research (recents), the compare launcher
// (≤4 symbols → metric-grouped rows), and one-tap screeners.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { droidStore } from "../lib/droidStore";
import { useApi, useMounted, type CompanyResp } from "../lib/quotes";
import { num } from "../lib/format";
import { H, Note, Skeleton, ErrorState, Badge } from "../ui/Pills";
import { MetricList } from "../ui/Cards";
import Sheet from "../ui/Sheet";

interface ScreenerResp {
  rows?: Array<{ symbol: string; name?: string; [k: string]: unknown }>;
  error?: string;
}

type MetricKey = "pe" | "pb" | "roe" | "margin" | "growth" | "yield" | "ret1y" | "vol";

const METRICS: Array<{ key: MetricKey; label: string; unit: string; better?: "high" | "low" }> = [
  { key: "pe", label: "P/E (TRAIL)", unit: "×" },
  { key: "pb", label: "P/B", unit: "×" },
  { key: "roe", label: "ROE", unit: "%" },
  { key: "margin", label: "NET MARGIN", unit: "%" },
  { key: "growth", label: "REV GROWTH", unit: "%", better: "high" },
  { key: "yield", label: "DIV YIELD", unit: "%", better: "high" },
  { key: "ret1y", label: "1Y RETURN", unit: "%", better: "high" },
  { key: "vol", label: "ANNUALISED VOL", unit: "%", better: "low" },
];

function useCompare(symbols: string[]) {
  const [data, setData] = useState<Record<string, { co: CompanyResp | null; ret1y: number | null; vol: number | null }>>({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!symbols.length) return;
    setLoading(true);
    setErr("");
    const out: Record<string, { co: CompanyResp | null; ret1y: number | null; vol: number | null }> = {};
    let fails = 0;
    for (const s of symbols) {
      try {
        const [co, hist] = await Promise.all([
          fetch(`/api/company?symbol=${encodeURIComponent(s)}`, { cache: "no-store" }).then((r) => r.json()),
          fetch(`/api/history?symbol=${encodeURIComponent(s)}&range=1y&interval=1d`, { cache: "no-store" }).then((r) => r.json()),
        ]);
        const bars = Array.isArray(hist?.bars) ? hist.bars : [];
        let ret1y: number | null = null;
        let vol: number | null = null;
        if (bars.length > 20) {
          const closes: number[] = bars.map((b: { close: number }) => b.close).filter((v: number) => isFinite(v));
          if (closes.length > 20 && closes[0]) {
            ret1y = ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;
            const rets: number[] = [];
            for (let i = 1; i < closes.length; i++) rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
            const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
            const variance = rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, rets.length - 1);
            vol = Math.sqrt(variance) * Math.sqrt(252) * 100;
          }
        }
        out[s] = { co: co && !co.error ? co : null, ret1y, vol };
      } catch {
        fails++;
        out[s] = { co: null, ret1y: null, vol: null };
      }
    }
    setData(out);
    setLoading(false);
    if (fails === symbols.length) setErr("ALL COMPARE LEGS FAILED — NOTHING INVENTED.");
  }, [symbols.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setData({});
    load();
  }, [load]);

  return { data, loading, err, refresh: load };
}

export default function ResearchHub() {
  const router = useRouter();
  const params = useSearchParams();
  const mounted = useMounted();
  const [picked, setPicked] = useState<string[]>([]);
  const [pickOpen, setPickOpen] = useState(false);
  const [q, setQ] = useState("");

  const recents = useMemo(() => (mounted ? droidStore.getRecents() : []), [mounted]);

  useEffect(() => {
    const p = params.get("compare");
    if (p) setPicked(p.split(",").map(decodeURIComponent).filter(Boolean).slice(0, 4));
  }, [params]);

  const cmp = useCompare(picked);
  const lookup = useApi<{ rows?: Array<{ symbol: string; name: string; exch: string }> }>(
    `/api/lookup?q=${encodeURIComponent(q.trim())}`,
    q.trim().length >= 2
  );

  const bySym = cmp.data;
  const valueOf = (sym: string, key: MetricKey): number | null => {
    const d = bySym[sym];
    if (!d) return null;
    const v = d.co?.profile?.valuation;
    const m = d.co?.profile?.margins;
    const f = d.co?.profile?.financials;
    if (key === "pe") return d.co?.derived?.trailPE ?? v?.trailPE ?? null;
    if (key === "pb") return v?.pb ?? null;
    if (key === "roe") return m?.roe ?? null;
    if (key === "margin") return m?.net ?? null;
    if (key === "growth") return f?.revGrowth ?? null;
    if (key === "yield") return d.co?.derived?.yieldPct ?? null;
    if (key === "ret1y") return d.ret1y;
    if (key === "vol") return d.vol;
    return null;
  };

  function toggle(sym: string) {
    setPicked((p) => {
      const next = p.includes(sym) ? p.filter((s) => s !== sym) : [...p, sym].slice(0, 4);
      return next;
    });
  }

  return (
    <div>
      <H right={<button className="dx-btn dx-ghost" style={{ minHeight: 30, fontSize: 10 }} onClick={() => setPickOpen(true)}>＋ ADD</button>}>
        RESEARCH HUB
      </H>

      <div className="dx-inline">
        <Badge kind="fnc">COMPARE ≤4</Badge>
        <Badge kind="mute">{picked.length} PICKED</Badge>
        <span className="dx-spacer" />
        <button className="dx-pill" onClick={() => setPickOpen(true)}>PICK SYMBOLS</button>
        {picked.length ? <button className="dx-pill" onClick={() => setPicked([])}>CLEAR</button> : null}
      </div>

      {picked.length >= 2 ? (
        <>
          <H right={<button className="dx-btn dx-ghost" style={{ minHeight: 30, fontSize: 10 }} onClick={cmp.refresh}>⟳</button>}>
            COMPARE MATRIX
          </H>
          {cmp.loading ? (
            <Skeleton rows={6} height={54} />
          ) : cmp.err ? (
            <ErrorState what="COMPARE" retry={cmp.refresh} detail={cmp.err} />
          ) : (
            <div className="dx-col" style={{ gap: 10 }}>
              {METRICS.map((m) => (
                <MetricList
                  key={m.key}
                  title={`${m.label}${m.unit ? ` (${m.unit})` : ""}`}
                  rows={picked.map((s) => {
                    const v = valueOf(s, m.key);
                    return {
                      label: s.replace(/\.(NS|BO)$/, ""),
                      value: v === null ? "—" : num(v, Math.abs(v) >= 100 ? 0 : 1),
                    };
                  })}
                />
              ))}
            </div>
          )}
          <Note>
            EVERY CELL IS A DIRECT READ FROM /api/company AND THE 1Y DAILY TAPE — NO RATINGS, NO
            TARGETS, NO INVENTED SCORES. “—” MEANS THE FEED DID NOT REPORT IT.
          </Note>
        </>
      ) : (
        <div className="dx-state" style={{ marginTop: 12 }}>
          <div className="dx-state-t">PICK 2–4 SYMBOLS</div>
          <div className="dx-state-d">
            COMPARE P/E, ROE, MARGIN, GROWTH, 1Y RETURN AND VOL SIDE BY SIDE. PHONE = STACKED ROWS,
            TABLET = WIDE MATRIX.
          </div>
          <button className="dx-btn" onClick={() => setPickOpen(true)}>PICK SYMBOLS</button>
        </div>
      )}

      <H>RECENTLY RESEARCHED</H>
      {recents.length ? (
        <div className="dx-inline">
          {recents.map((s) => (
            <button key={s} className="dx-pill" onClick={() => router.push(`/research/${encodeURIComponent(s)}`)}>
              {s.replace(/\.(NS|BO)$/, "")}
            </button>
          ))}
        </div>
      ) : (
        <div className="dx-note">OPEN A SECURITY TO START A PAPER TRAIL HERE.</div>
      )}

      <H>SCREENERS & TOOLS</H>
      <div className="dx-list">
        {[
          { id: "67", label: "QUANT SCREENER", hint: "FILTER THE WHOLE UNIVERSE" },
          { id: "68", label: "CANSLIM / GROWTH", hint: "GROWTH SCREEN" },
          { id: "18", label: "DCF", hint: "INTRINSIC VALUE" },
          { id: "22", label: "RISK & VaR", hint: "PORTFOLIO RISK" },
          { id: "110", label: "OPTION CHAIN", hint: "PCR · MAX PAIN · OI" },
          { id: "40", label: "DIVIDEND DESK", hint: "YIELD & PAYOUT" },
        ].map((t) => (
          <Link key={t.id} href={`/d/${t.id}`} className="dx-row">
            <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span className="dx-sym">{t.label}</span>
              <span className="dx-name">{t.hint}</span>
            </span>
            <span className="dx-right dx-fnc" style={{ fontSize: 10 }}>OPEN ›</span>
          </Link>
        ))}
      </div>

      <div className="dx-inline" style={{ marginTop: 14 }}>
        <Link className="dx-pill" href="/home">⌂ TODAY</Link>
        <Link className="dx-pill" href="/more">☰ ALL DESKS</Link>
        <Link className="dx-pill" href="/compare">⇄ FULL COMPARE</Link>
      </div>

      <Sheet open={pickOpen} onClose={() => setPickOpen(false)} title="PICK SYMBOLS TO COMPARE">
        <div className="dx-searchbar">
          <span className="dx-amber">⌕</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value.toUpperCase())}
            placeholder="TYPE A SYMBOL"
            aria-label="Add symbol to compare"
          />
        </div>
        <div className="dx-inline" style={{ marginTop: 8 }}>
          {picked.map((s) => (
            <button key={s} className="dx-pill dx-on" onClick={() => toggle(s)}>
              {s.replace(/\.(NS|BO)$/, "")} ✕
            </button>
          ))}
          {!picked.length ? <span className="dx-note">NOTHING PICKED YET — UP TO 4.</span> : null}
        </div>
        <div className="dx-list" style={{ marginTop: 10 }}>
          {(lookup.data?.rows ?? []).slice(0, 8).map((r) => (
            <button key={r.symbol} className="dx-row" onClick={() => toggle(r.symbol)}>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span className="dx-sym">{r.symbol}</span>
                <span className="dx-name dx-ellipsis">{r.name}</span>
              </span>
              <span className="dx-right dx-faint" style={{ fontSize: 10 }}>
                {picked.includes(r.symbol) ? "REMOVE" : "PICK"}
              </span>
            </button>
          ))}
          {!q.trim() ? (
            <div className="dx-note">
              OR TAP A RECENT SYMBOL FROM THE ROW ABOVE.
            </div>
          ) : null}
          {q.trim().length >= 2 && !lookup.loading && !(lookup.data?.rows ?? []).length ? (
            <div className="dx-note">NO LIVE MATCH.</div>
          ) : null}
        </div>
        <button
          className="dx-btn"
          style={{ marginTop: 10 }}
          disabled={picked.length < 2}
          onClick={() => {
            setPickOpen(false);
            setQ("");
          }}
        >
          COMPARE {picked.length} SYMBOLS
        </button>
      </Sheet>
    </div>
  );
}
