"use client";

// SECURITY screen (spec §S5) — /s/[symbol]. Header + touch chart + quick
// stats + signal grid, then eight swipeable tabs. All data comes from the
// existing /api surface; every metric with no data renders as "—".

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { store } from "@/lib/store";
import { RANGES, useCompany, useHistory, useQuotes } from "../lib/quotes";
import { droidStore } from "../lib/droidStore";
import { baseSym, chg, cr, dir, istStamp, num, pct } from "../lib/format";
import type { TechSnapshot } from "../lib/signals";
import { fundamentalVerdict, momentumVerdict, riskVerdict, rsiVerdict, techSnapshot, trendVerdict } from "../lib/signals";
import { Badge, EmptyState, ErrorState, H, Note, Skeleton } from "../ui/Pills";
import { SignalRow, StatStrip, Verdict } from "../ui/Cards";
import TouchChart from "../ui/TouchChart";
import SwipeTabs, { type TabDef } from "../ui/SwipeTabs";
import FAB from "../ui/FAB";
import AlertSheet from "../ui/AlertSheet";
import AIChatPanel from "../ui/AIChatPanel";
import ExplainChip from "../ui/ExplainChip";
import { QUICK_ACTIONS, type QuickAction } from "../lib/categories";
import { FundamentalsSection, NewsSection, OptionsSection, TechSection, ValuationSection } from "./securitySections";

const TABS: TabDef[] = [
  { id: "overview", label: "OVERVIEW" },
  { id: "chart", label: "CHART" },
  { id: "tech", label: "TECHNICALS" },
  { id: "fund", label: "FUNDAMENTALS" },
  { id: "val", label: "VALUATION" },
  { id: "opt", label: "OPTIONS" },
  { id: "news", label: "NEWS" },
  { id: "ai", label: "AI" },
];

// Search intents and the quick-action row speak in full words; the tab strip
// speaks in short ids. Map one to the other so deep links land on the right tab.
const TAB_ALIAS: Record<string, string> = {
  fundamentals: "fund",
  technicals: "tech",
  valuation: "val",
  options: "opt",
  option: "opt",
  chain: "opt",
  overview: "overview",
};
const aliasTab = (t?: string) => (t ? (TAB_ALIAS[t] ?? t) : undefined);

export default function Security({ symbol, initialTab }: { symbol: string; initialTab?: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<string>(() => {
    const t = aliasTab(initialTab);
    return t && TABS.some((x) => x.id === t) ? t : "overview";
  });
  const [rangeIdx, setRangeIdx] = useState(3);
  const [fabOpen, setFabOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);

  const company = useCompany(symbol);
  const chart = useHistory(symbol, RANGES[rangeIdx].range, RANGES[rangeIdx].interval);
  const sig = useHistory(symbol, "1y", "1d");
  const qt = useQuotes([symbol]);

  const q = qt.data?.[symbol] ?? company.data?.quote ?? null;
  const profile = company.data?.profile ?? null;
  const d = company.data?.derived;

  const [star, setStar] = useState(() => droidStore.inAnyList(symbol));
  const toggleStar = () => {
    droidStore.toggleSymbol("wl-main", symbol);
    setStar(droidStore.inAnyList(symbol));
  };

  const runQuick = (a: QuickAction) => {
    if (a.tab) {
      setTab(aliasTab(a.tab) ?? "overview");
      return;
    }
    if (a.sheet === "ai") return setTab("ai");
    if (a.sheet === "alert") return setAlertOpen(true);
    if (a.sheet === "watch") return toggleStar();
    if (a.sheet === "compare") return router.push(`/research?compare=${encodeURIComponent(symbol)}`);
    if (a.funcId) return router.push(`/d/${a.funcId}?symbol=${encodeURIComponent(symbol)}`);
    if (a.href) return router.push(a.href);
  };

  const snap: TechSnapshot | null = useMemo(
    () => (sig.data?.bars?.length ? techSnapshot(sig.data.bars) : null),
    [sig.data]
  );

  const name = profile?.name || q?.shortName || baseSym(symbol);
  const px = q?.regularMarketPrice ?? profile?.price?.px ?? null;
  const chgPct = q?.regularMarketChangePercent ?? null;
  const ctx = useMemo(
    () => ({
      symbol,
      desk: "SECURITY",
      periods: ["1Y DAILY"],
      values: snap
        ? [snap.rsi14, snap.sma50, snap.sma200, snap.ret1M, snap.vol1Y, d?.trailPE ?? null]
        : [],
      extra: {
        source: "1Y daily tape + /api/company",
        rsi: snap?.rsi14 ?? null,
        trend: snap ? trendVerdict(snap).value : null,
      },
    }),
    [symbol, snap, d?.trailPE]
  );

  const aiContext = useMemo(() => {
    const parts = [`${name} (${symbol})`, `SPOT ${num(px, 2)}`, `1D ${chg(chgPct)}`];
    if (snap) {
      parts.push(`RSI ${num(snap.rsi14, 1)}`, `1M ${pct(snap.ret1M, 1, true)}`, `TREND ${trendVerdict(snap).value}`);
    }
    if (d?.trailPE) parts.push(`P/E ${num(d.trailPE, 1)}`);
    if (profile?.sector) parts.push(`SECTOR ${profile.sector}`);
    parts.push(`AS OF ${istStamp()}`);
    return parts.join(" · ");
  }, [name, symbol, px, chgPct, snap, d?.trailPE, profile?.sector]);

  // ---- states -------------------------------------------------------
  if (company.loading && !company.data && !q) {
    return (
      <div>
        <Skeleton rows={2} height={70} />
        <div style={{ height: 10 }} />
        <Skeleton rows={1} height={210} />
        <div style={{ height: 10 }} />
        <Skeleton rows={3} height={56} />
      </div>
    );
  }

  if (company.error && !company.data && !q) {
    return <ErrorState what={`QUOTE FOR ${symbol}`} retry={() => { company.refresh(); qt.refresh(); }} detail={company.error} />;
  }

  const hi52 = profile?.price?.hi52 ?? null;
  const lo52 = profile?.price?.lo52 ?? null;
  const beta = profile?.price?.beta ?? null;

  const chartBlock = (
    <div className="dx-card" style={{ padding: 10 }}>
      <div className="dx-range" role="tablist" aria-label="Chart range">
        {RANGES.map((r, i) => (
          <button
            key={r.label}
            role="tab"
            aria-selected={i === rangeIdx}
            className={`dx-pill${i === rangeIdx ? " dx-on" : ""}`}
            onClick={() => setRangeIdx(i)}
          >
            {r.label}
          </button>
        ))}
      </div>
      {chart.loading && !chart.data ? (
        <Skeleton rows={1} height={210} />
      ) : chart.error && !chart.data ? (
        <ErrorState what="CHART TAPE" retry={chart.refresh} detail={chart.error} />
      ) : chart.data?.bars?.length ? (
        <TouchChart bars={chart.data.bars} label={`${baseSym(symbol)} · ${RANGES[rangeIdx].label}`} lite />
      ) : (
        <EmptyState title="NO BARS" desc="THE TAPE RETURNED NO CANDLES FOR THIS RANGE." />
      )}
      <div className="dx-note">
        {chart.data?.count ? `${chart.data.count} BARS · ${RANGES[rangeIdx].interval} · ` : ""}
        UPDATED {istStamp()} — PAN / PINCH / LONG-PRESS THE CHART.
      </div>
    </div>
  );

  const statCells = [
    { label: "52W HIGH", value: num(hi52, 2) },
    { label: "52W LOW", value: num(lo52, 2) },
    { label: "OFF 52W HIGH", value: d?.offHighPct != null ? `${d.offHighPct.toFixed(1)}%` : "—" },
    { label: "SESSION RANGE", value: `${num(profile?.price?.low, 1)} – ${num(profile?.price?.high, 1)}` },
    { label: "VOLUME", value: num(q?.regularMarketVolume ?? null, 0) },
    { label: "BETA (YF)", value: num(beta, 2), term: "BETA", ctx: { symbol, desk: "SECURITY" } },
    { label: "MA 50", value: num(profile?.price?.ma50, 2) },
    { label: "MA 200", value: num(profile?.price?.ma200, 2) },
    { label: "MKT CAP", value: d?.mktCap != null ? `₹${cr(d.mktCap)}` : "—" },
    { label: "P/E (TRAIL)", value: num(d?.trailPE ?? profile?.valuation?.trailPE, 1), term: "P/E RATIO" },
    { label: "DIV YIELD", value: d?.yieldPct != null ? `${d.yieldPct.toFixed(2)}%` : "—" },
    { label: "PREV CLOSE", value: num(profile?.price?.prevClose ?? q?.regularMarketPrice ?? null, 2) },
  ];

  const vTrend = snap ? trendVerdict(snap) : null;
  const vRsi = snap ? rsiVerdict(snap) : null;
  const vMom = snap ? momentumVerdict(snap) : null;
  const vRisk = snap ? riskVerdict(snap, beta) : null;
  const vFund = fundamentalVerdict(profile);
  const tn = (v: { tone: string } | null) => (!v ? null : v.tone === "up" ? 1 : v.tone === "down" ? -1 : 0);

  const signalCard = (
    <div className="dx-card">
      <SignalRow label="TREND" value={vTrend?.value ?? "—"} tone={tn(vTrend)} detail={vTrend?.detail ?? "TAPE NOT LOADED YET"} />
      <SignalRow
        label="RSI(14)"
        value={snap?.rsi14 != null ? snap.rsi14.toFixed(1) : "—"}
        tone={tn(vRsi)}
        detail={vRsi?.detail ?? "NEED 15+ DAILY BARS"}
      />
      <SignalRow
        label="MOMENTUM 1M"
        value={snap?.ret1M != null ? pct(snap.ret1M, 1, true) : "—"}
        tone={tn(vMom)}
        detail={vMom?.detail ?? "NEED 22+ DAILY BARS"}
      />
      <SignalRow label="RISK" value={vRisk?.value ?? "—"} tone={tn(vRisk)} detail={vRisk?.detail ?? "NEED 20+ DAILY BARS"} />
      <SignalRow label="FUNDAMENTALS" value={vFund.value} tone={tn(vFund)} detail={vFund.detail} />
    </div>
  );

  const overview = (
    <div className="dx-col" style={{ gap: 10 }}>
      {chartBlock}
      <H right={<ExplainChip term="52-WEEK RANGE" ctx={ctx} />}>QUICK STATS</H>
      <StatStrip cells={statCells} />
      <H right={<ExplainChip term="TECHNICAL SIGNAL" ctx={ctx} />}>SIGNALS</H>
      {signalCard}
      <Verdict icon="!">{snap ? `COMPUTED FROM ${snap.bars} DAILY BARS — NOT ADVICE` : "TAPE NOT LOADED — SIGNALS SHOW GAPS"}</Verdict>
      {profile?.summary ? (
        <>
          <H>ABOUT</H>
          <div className="dx-card">
            <div style={{ fontSize: 12.5, lineHeight: 1.65, color: "var(--dx-sub)" }}>{profile.summary}</div>
            <div className="dx-note" style={{ marginTop: 8 }}>
              {profile.sector ?? "—"} · {profile.industry ?? "—"}
            </div>
          </div>
        </>
      ) : null}
      <div className="dx-inline">
        {company.data?.links?.screener ? (
          <a className="dx-btn dx-ghost" href={company.data.links.screener} target="_blank" rel="noreferrer">SCREENER ↗</a>
        ) : null}
        {company.data?.links?.tradingview ? (
          <a className="dx-btn dx-ghost" href={company.data.links.tradingview} target="_blank" rel="noreferrer">TRADINGVIEW ↗</a>
        ) : null}
        <button className="dx-btn dx-ghost" onClick={() => { store.setTicker(symbol); router.push("/terminal"); }}>
          OPEN IN TERMINAL
        </button>
      </div>
      <Note>
        PARTIAL FEED{company.data?.partial ? " — SOME FIELDS UNAVAILABLE" : ""}: PRICE AND STATS FROM
        /api/company · SIGNALS FROM THE 1Y DAILY TAPE. EVERY GAP SHOWS {`—`}, NEVER A GUESS.
      </Note>
    </div>
  );

  const pane = (
    <>
      {tab === "overview" ? overview : null}
      {tab === "chart" ? (
        <div className="dx-col" style={{ gap: 10 }}>
          {chartBlock}
          <StatStrip cells={statCells.slice(0, 6)} />
          <Note>PAN TO SCROLL TIME · PINCH TO ZOOM · LONG-PRESS FOR THE CROSSHAIR · DOUBLE-TAP TO RESET.</Note>
        </div>
      ) : null}
      {tab === "tech" ? (snap ? <TechSection snap={snap} beta={beta} /> : <Skeleton rows={5} height={64} />) : null}
      {tab === "fund" ? <FundamentalsSection symbol={symbol} /> : null}
      {tab === "val" ? <ValuationSection company={company.data} symbol={symbol} /> : null}
      {tab === "opt" ? <OptionsSection symbol={symbol} price={px} /> : null}
      {tab === "news" ? <NewsSection symbol={symbol} /> : null}
      {tab === "ai" ? (
        <AIChatPanel context={aiContext} desk="SECURITY RESEARCH" symbol={symbol} placeholder={`ASK ABOUT ${baseSym(symbol)}…`} />
      ) : null}
    </>
  );

  return (
    <div>
      <div className="dx-sec-top">
        <div className="dx-sec-head">
          <span className="dx-sec-name">{name}</span>
          <span className="dx-sec-px dx-mono-num">{num(px, 2)}</span>
          <span className={`dx-sec-chg ${dir(chgPct)}`}>{chg(chgPct)}</span>
          <span className="dx-sec-meta">
            {baseSym(symbol)} · {profile?.exchange ?? "NSE"} · {qt.ts ? `UPD ${istStamp(new Date(qt.ts))}` : "LOADING…"}
          </span>
        </div>
        <div className="dx-col" style={{ gap: 6, alignItems: "flex-end" }}>
          <button className="dx-btn dx-ghost" style={{ minHeight: 34, fontSize: 14 }} onClick={toggleStar} aria-label="Toggle watchlist">
            {star ? "★ SAVED" : "☆ SAVE"}
          </button>
          <button className="dx-btn dx-ghost" style={{ minHeight: 30, fontSize: 11 }} onClick={() => router.back()}>
            ‹ BACK
          </button>
        </div>
      </div>

      <div className="dx-inline" style={{ marginTop: 8 }}>
        <Badge kind={chgPct !== null && chgPct >= 0 ? "up" : "down"}>{chgPct !== null && chgPct >= 0 ? "UP" : "DOWN"} 1D</Badge>
        <Badge kind="mute">{profile?.sector ?? "SECTOR —"}</Badge>
        {company.data?.partial ? <Badge kind="fnc">PARTIAL</Badge> : null}
        <span className="dx-spacer" />
        <span className="dx-note" style={{ marginTop: 0 }}>
          {qt.ts ? `LIVE ${istStamp(new Date(qt.ts))}` : "TAPE …"}
        </span>
      </div>

      {/* spec §17 quick actions — one scrollable row, every security gets them */}
      <div className="dx-pills" style={{ marginTop: 8 }} role="toolbar" aria-label="Quick actions">
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.key}
            className={`dx-pill${a.sheet === "watch" && star ? " dx-on" : ""}${a.tab && aliasTab(a.tab) === tab ? " dx-on" : ""}`}
            onClick={() => runQuick(a)}
          >
            <span aria-hidden>{a.icon}</span> {a.label}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 12 }}>
        <SwipeTabs tabs={TABS} value={tab} onChange={setTab}>
          {pane}
        </SwipeTabs>
      </div>

      <FAB
        open={fabOpen}
        onToggle={setFabOpen}
        items={[
          { key: "alert", label: "PRICE ALERT", icon: "⏰", onClick: () => setAlertOpen(true) },
          { key: "star", label: star ? "UNWATCH" : "WATCH", icon: star ? "★" : "☆", onClick: toggleStar },
          { key: "ai", label: "ASK AI", icon: "✦", onClick: () => setTab("ai") },
          { key: "news", label: "NEWS", icon: "📰", onClick: () => setTab("news") },
          {
            key: "chain",
            label: "OPEN TERMINAL",
            icon: "▣",
            onClick: () => {
              store.setTicker(symbol);
              router.push("/terminal");
            },
          },
        ]}
      />

      <AlertSheet open={alertOpen} onClose={() => setAlertOpen(false)} symbol={symbol} current={px} />
    </div>
  );
}
