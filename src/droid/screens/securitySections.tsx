"use client";

// Security page tab sections (spec §S5): technicals, fundamentals, valuation,
// options, news. Each section owns its own fetch so heavy legs (statements,
// option chain) only load when their tab is actually opened.

import { useEffect, useMemo, useState } from "react";
import type { CompanyResp } from "../lib/quotes";
import { useApi, useApiPoll } from "../lib/quotes";
import { cr, istDate, moneyFor, num, pct } from "../lib/format";
import type { TechSnapshot, Verdict } from "../lib/signals";
import { macdVerdict, momentumVerdict, riskVerdict, rsiVerdict, trendVerdict } from "../lib/signals";
import { Badge, ErrorState, Note, Skeleton } from "../ui/Pills";
import { MetricList, SignalRow, StatStrip } from "../ui/Cards";
import DataTable from "../ui/DataTable";
import { HBars } from "@/components/charts";

// ---------------------------------------------------------------- types

interface YFTableLike {
  periods: string[];
  rows: Array<{ label: string; values: (number | null)[]; raw?: string[] }>;
}

interface StmtResp {
  symbol: string;
  name?: string;
  unit?: string;
  currency?: string;
  currencySymbol?: string;
  source?: string;
  marketCapCr?: number | null;
  pl?: YFTableLike | null;
  bs?: YFTableLike | null;
  cf?: YFTableLike | null;
  sh?: YFTableLike | null;
  qtr?: YFTableLike | null;
  rat?: YFTableLike | null;
}

interface EstResp {
  symbol: string;
  source?: string;
  earningsTrend?: Array<{
    period?: string;
    endDate?: string | null;
    growth?: number | null;
    epsTrend?: { current?: number | null; low?: number | null; high?: number | null };
    epsRevisions?: { up7d?: number | null; down7d?: number | null; up30d?: number | null; down30d?: number | null };
    revenueEstimate?: { avg?: number | null; low?: number | null; high?: number | null };
  }>;
  surprise?: Array<{ quarter?: string; epsActual?: number | null; epsEstimate?: number | null }>;
  recommendation?: Record<string, number | null> | null;
  nextEarnings?: string | null;
}

interface NewsResp {
  symbol?: string;
  count?: number;
  bull?: number;
  bear?: number;
  items?: Array<{
    id?: string | number;
    title: string;
    link?: string;
    source?: string;
    ago?: string;
    label?: "BULL" | "BEAR" | "NEUT";
    desc?: string;
  }>;
}

interface ExpiryResp {
  symbol: string;
  expiries?: string[];
  error?: string;
}

interface ChainResp {
  symbol: string;
  expiry?: string;
  underlying?: number;
  timestamp?: string;
  count?: number;
  rows?: Array<{ strike: number; ceOI: number; peOI: number; ceLTP: number; peLTP: number; ceIV: number; peIV: number }>;
  error?: string;
}

const dash = "—";

function pick(rows: YFTableLike["rows"] | null | undefined, re: RegExp) {
  return rows?.find((r) => re.test(r.label)) ?? null;
}

function lastNum(r: YFTableLike["rows"][number] | null): number | null {
  if (!r) return null;
  const v = r.values[r.values.length - 1];
  return typeof v === "number" && isFinite(v) ? v : null;
}

/** Yahoo reports earnings dates in seconds (occasionally ms) — never guess. */
function fmtEarn(v: number | null | undefined): string {
  if (typeof v !== "number" || !isFinite(v) || v <= 0) return dash;
  return istDate(new Date(v > 1e12 ? v : v * 1000));
}

// ------------------------------------------------------------ TECHNICALS

export function TechSection({ snap, beta }: { snap: TechSnapshot; beta?: number | null }) {
  const verdicts: Verdict[] = [
    trendVerdict(snap),
    rsiVerdict(snap),
    macdVerdict(snap),
    momentumVerdict(snap),
    riskVerdict(snap, beta),
  ];
  return (
    <div>
      <div className="dx-card">
        {verdicts.map((v) => (
          <SignalRow key={v.label} label={v.label} value={v.value} tone={v.tone === "up" ? 1 : v.tone === "down" ? -1 : v.tone === "flat" ? 0 : null} detail={v.detail} />
        ))}
      </div>

      <MetricList
        title="RAW READINGS"
        rows={[
          { label: "RSI (14)", value: num(snap.rsi14, 1), term: "RSI" },
          { label: "MACD LINE", value: num(snap.macdLine, 2) },
          { label: "MACD SIGNAL", value: num(snap.macdSignal, 2) },
          { label: "MACD HISTOGRAM", value: num(snap.macdHist, 2), tone: snap.macdHist ?? undefined },
          { label: "BOLLINGER %B", value: num(snap.pctB, 2), term: "BOLLINGER BANDS" },
          { label: "BOLLINGER UPPER", value: num(snap.bbUpper, 2) },
          { label: "BOLLINGER LOWER", value: num(snap.bbLower, 2) },
          { label: "ADX (14)", value: num(snap.adx14, 1), term: "ADX" },
          { label: "+DI / −DI", value: `${num(snap.pdi, 1)} / ${num(snap.mdi, 1)}` },
          { label: "STOCH %K / %D", value: `${num(snap.stochK, 1)} / ${num(snap.stochD, 1)}` },
          { label: "SMA 50", value: num(snap.sma50, 2) },
          { label: "SMA 200", value: num(snap.sma200, 2) },
          { label: "ATR (% OF PRICE)", value: num(snap.atrPct, 2) },
          { label: "ANNUALISED VOL", value: snap.vol1Y !== null ? `${snap.vol1Y.toFixed(1)}%` : dash, term: "VOLATILITY" },
          { label: "MAX DRAWDOWN (1Y)", value: snap.maxDD !== null ? `${snap.maxDD.toFixed(1)}%` : dash, term: "DRAWDOWN" },
          { label: "RETURN 1M", value: snap.ret1M !== null ? pct(snap.ret1M, 1, true) : dash, tone: snap.ret1M ?? undefined },
          { label: "RETURN 1Y", value: snap.ret1Y !== null ? pct(snap.ret1Y, 1, true) : dash, tone: snap.ret1Y ?? undefined },
        ]}
      />

      <Note>
        COMPUTED ON YOUR DEVICE FROM {snap.bars} DAILY BARS (1Y WINDOW). INDICATORS ARE LAGGING —
        NOT ADVICE. IF THE TAPE FAILED TO LOAD EVERY ROW SHOWS {dash}.
      </Note>
    </div>
  );
}

// ---------------------------------------------------------- FUNDAMENTALS

export function FundamentalsSection({ symbol }: { symbol: string }) {
  const st = useApi<StmtResp>(`/api/statements?symbol=${encodeURIComponent(symbol)}`);

  const p = st.data;
  const cur = p?.currencySymbol ?? p?.currency ?? "₹";

  const growth = useMemo(() => {
    if (!p?.pl?.rows) return [];
    const rev = pick(p.pl.rows, /revenue|total revenue|sales/i);
    const net = pick(p.pl.rows, /net income|profit after tax|^profit/i);
    const op = pick(p.pl.rows, /operating income|operating profit|ebit$/i);
    const out: Array<{ label: string; value: number | null; term?: string }> = [];
    const yoy = (r: YFTableLike["rows"][number] | null) => {
      if (!r) return null;
      const v = r.values.filter((x): x is number => typeof x === "number" && isFinite(x));
      if (v.length < 2 || !v[v.length - 2]) return null;
      return ((v[v.length - 1] - v[v.length - 2]) / Math.abs(v[v.length - 2])) * 100;
    };
    out.push({ label: "REVENUE GROWTH (YoY)", value: yoy(rev), term: "REVENUE GROWTH" });
    out.push({ label: "OPERATING PROFIT GROWTH (YoY)", value: yoy(op) });
    out.push({ label: "NET PROFIT GROWTH (YoY)", value: yoy(net), term: "EARNINGS GROWTH" });
    return out;
  }, [p]);

  const plRows = useMemo(() => {
    if (!p?.pl?.rows) return [];
    const wanted = [
      /revenue|total revenue|sales/i,
      /total expenses|cost of revenue|cost of goods/i,
      /operating income|operating profit/i,
      /interest expense/i,
      /pretax income|profit before tax/i,
      /net income|profit after tax|^profit$/i,
      /basic eps|diluted eps/i,
      /ebitda/i,
    ];
    const out: YFTableLike["rows"] = [];
    for (const re of wanted) {
      const r = pick(p.pl.rows, re);
      if (r && !out.includes(r)) out.push(r);
    }
    return out;
  }, [p]);

  const shRows = p?.sh?.rows ?? [];
  const shPeriods = p?.sh?.periods ?? [];

  if (st.loading && !st.data) return <Skeleton rows={5} height={64} />;
  if (st.error && !st.data)
    return <ErrorState what="STATEMENTS" retry={st.refresh} detail={st.error} />;
  if (!p || (!p.pl && !p.sh))
    return <ErrorState what="STATEMENTS" retry={st.refresh} detail="NO INCOME STATEMENT FOR THIS SYMBOL — NOTHING IS INVENTED." />;

  return (
    <div>
      <StatStrip
        cells={[
          { label: "MARKET CAP", value: p.marketCapCr != null ? `₹${cr(p.marketCapCr)}` : dash },
          { label: "UNIT", value: (p.unit ?? "").replace("₹ ", "₹") || dash, sub: "FINANCIALS" },
          { label: "LATEST FY", value: p.pl?.periods?.[p.pl.periods.length - 1] ?? dash },
        ]}
      />

      {growth.length ? (
        <MetricList
          title="GROWTH (LATEST vs PRIOR)"
          rows={growth.map((g) => ({
            label: g.label,
            value: g.value !== null ? pct(g.value, 1, true) : dash,
            term: g.term,
            tone: g.value ?? undefined,
          }))}
        />
      ) : null}

      {plRows.length ? (
        <DataTable
          caption={`P&L · ${p.unit ?? "REPORTED UNITS"}`}
          head={["METRIC", ...(p.pl?.periods ?? [])]}
          rows={plRows.map((r) => [r.label, ...r.values])}
          stacked={plRows.map((r) => ({ label: r.label, value: lastNum(r) !== null ? `${cur} ${num(lastNum(r), 1)}` : dash }))}
          note={`SOURCE: ${p.source ?? "FUNDAMENTALS FEED"} · PERIODS AS REPORTED. ${dash} = NOT REPORTED.`}
        />
      ) : null}

      {p.bs ? (
        <DataTable
          caption="BALANCE SHEET"
          head={["METRIC", ...(p.bs.periods ?? [])]}
          rows={(p.bs.rows ?? []).slice(0, 12).map((r) => [r.label, ...r.values])}
          note={`UNIT: ${p.unit ?? "AS REPORTED"}`}
        />
      ) : null}

      {p.cf ? (
        <DataTable
          caption="CASH FLOW"
          head={["METRIC", ...(p.cf.periods ?? [])]}
          rows={(p.cf.rows ?? []).slice(0, 10).map((r) => [r.label, ...r.values])}
          note={`UNIT: ${p.unit ?? "AS REPORTED"}`}
        />
      ) : null}

      {shRows.length ? (
        <DataTable
          caption="SHAREHOLDING"
          head={["HOLDER", ...shPeriods]}
          rows={shRows.map((r) => [r.label, ...r.values.map((v) => (typeof v === "number" ? `${v.toFixed(2)}%` : v))])}
          note="SOURCE: SCREENER.IN HOLDINGS — INDIAN LISTINGS ONLY."
        />
      ) : null}

      <Note>
        FINANCIALS ARE AS REPORTED BY THE FUNDAMENTALS FEED · {p.symbol}. GROWTH IS PLAIN
        YEAR-OVER-YEAR ARITHMETIC ON REPORTED FIGURES. NOT ADVICE.
      </Note>
    </div>
  );
}

// ----------------------------------------------------------- VALUATION

export function ValuationSection({ company, symbol }: { company: CompanyResp | null; symbol: string }) {
  const est = useApi<EstResp>(`/api/estimates?symbol=${encodeURIComponent(symbol)}`);
  const v = company?.profile?.valuation;
  const d = company?.derived;
  const div = company?.profile?.dividends;
  const fin = company?.profile?.financials;

  const valRows = [
    { label: "MARKET CAP", value: d?.mktCap != null ? `₹${cr(d.mktCap)}` : v?.mktCap != null ? num(v.mktCap, 0) : dash, term: "MARKET CAP" },
    { label: "TRAILING P/E", value: num(d?.trailPE ?? v?.trailPE, 1), term: "P/E RATIO" },
    { label: "FORWARD P/E", value: num(v?.fwdPE, 1), term: "FORWARD P/E" },
    { label: "PEG RATIO", value: num(v?.peg, 2), term: "PEG RATIO" },
    { label: "PRICE / BOOK", value: num(v?.pb, 2), term: "P/B RATIO" },
    { label: "PRICE / SALES", value: num(v?.ps, 2), term: "P/S RATIO" },
    { label: "EV / EBITDA", value: num(v?.evEbitda, 1), term: "EV/EBITDA" },
    { label: "TRAILING EPS", value: num(v?.trailEps, 2) },
    { label: "FORWARD EPS", value: num(v?.fwdEps, 2) },
    { label: "BOOK VALUE / SHARE", value: num(v?.book, 2) },
    { label: "DIVIDEND YIELD", value: d?.yieldPct != null ? `${d.yieldPct.toFixed(2)}%` : div?.yield != null ? `${div.yield.toFixed(2)}%` : dash, term: "DIVIDEND YIELD" },
    { label: "REVENUE (TTM)", value: fin?.revenue != null ? moneyFor(symbol, fin.revenue, 0) : dash },
    { label: "NET INCOME (TTM)", value: fin?.net != null ? moneyFor(symbol, fin.net, 0) : dash },
  ];

  const e = est.data;
  const rec = e?.recommendation;
  const recRows = rec
    ? [
        { label: "STRONG BUY", value: rec.strongBuy ?? 0 },
        { label: "BUY", value: rec.buy ?? 0 },
        { label: "HOLD", value: rec.hold ?? 0 },
        { label: "SELL", value: rec.sell ?? 0 },
        { label: "STRONG SELL", value: rec.strongSell ?? 0 },
      ]
    : [];

  const fwd = e?.earningsTrend?.find((t) => /next|1y|forward/i.test(t.period ?? "")) ?? e?.earningsTrend?.[0];

  return (
    <div>
      <MetricList title="VALUATION" rows={valRows} />

      <div className="dx-card">
        <div className="p-head">ANALYST VIEWS {est.loading && !est.data ? <span className="faint">·LOADING…</span> : null}</div>
        {est.error && !est.data ? (
          <ErrorState what="ESTIMATES" retry={est.refresh} detail={est.error} />
        ) : recRows.length ? (
          <>
            <HBars rows={recRows.map((r) => ({ label: r.label, value: r.value, display: String(r.value ?? 0), color: r.label.includes("BUY") ? "#00d664" : r.label.includes("SELL") ? "#ff453a" : "#7a7a80" }))} />
            <div className="dx-note">BROKER BREAKDOWN (COUNTS) — {e?.source ?? "ESTIMATES FEED"}.</div>
          </>
        ) : (
          <div className="dx-note">NO BROKER BREAKDOWN REPORTED FOR THIS SYMBOL.</div>
        )}
        <MetricList
          rows={[
            { label: "NEXT EARNINGS", value: e?.nextEarnings ?? fmtEarn(company?.profile?.events?.earnDate) },
            { label: "EPS ESTIMATE (CUR)", value: num(fwd?.epsTrend?.current, 2) },
            { label: "EPS LOW / HIGH", value: `${num(fwd?.epsTrend?.low, 2)} / ${num(fwd?.epsTrend?.high, 2)}` },
            { label: "EPS REVISIONS 7D (UP/DOWN)", value: `${num(fwd?.epsRevisions?.up7d, 0)} / ${num(fwd?.epsRevisions?.down7d, 0)}` },
            { label: "REVENUE ESTIMATE", value: fwd?.revenueEstimate?.avg != null ? moneyFor(symbol, fwd.revenueEstimate.avg, 0) : dash },
            { label: "EPS GROWTH EST.", value: fwd?.growth != null ? pct(fwd.growth * 100, 1, true) : dash, tone: fwd?.growth != null ? fwd.growth * 100 : undefined },
          ]}
        />
        {e?.surprise?.length ? (
          <DataTable
            caption="EARNINGS SURPRISE"
            head={["QUARTER", "ACTUAL", "ESTIMATE"]}
            rows={e.surprise.slice(0, 6).map((s) => [s.quarter ?? "—", s.epsActual ?? null, s.epsEstimate ?? null])}
          />
        ) : null}
      </div>

      <Note>
        BROKER COUNTS AND EPS ESTIMATES ARE THE FEED&apos;S OWN PUBLISHED NUMBERS — WE DO NOT
        RECOMPUTE OR ROUND THEM INTO A TARGET PRICE. NO CONSENSUS PRICE IS INVENTED.
      </Note>
    </div>
  );
}

// ------------------------------------------------------------- OPTIONS

function maxPain(rows: ChainResp["rows"]): number | null {
  if (!rows || !rows.length) return null;
  let best: number | null = null;
  let bestLoss = Infinity;
  for (const s of rows) {
    let loss = 0;
    for (const r of rows) {
      if (s.strike > r.strike) loss += (s.strike - r.strike) * r.ceOI;
      if (s.strike < r.strike) loss += (r.strike - s.strike) * r.peOI;
    }
    if (loss < bestLoss) {
      bestLoss = loss;
      best = s.strike;
    }
  }
  return best;
}

export function OptionsSection({ symbol, price }: { symbol: string; price: number | null }) {
  const exp = useApi<ExpiryResp>(`/api/ochain/expiry?symbol=${encodeURIComponent(symbol.toUpperCase().replace(/\.(NS|BO)$/, ""))}`);
  const [expiry, setExpiry] = useState<string | null>(null);
  const expiries = exp.data?.expiries ?? [];

  useEffect(() => {
    setExpiry(expiries.length ? expiries[0] : null);
  }, [expiries.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const chain = useApi<ChainResp>(
    expiry ? `/api/ochain/chain?symbol=${encodeURIComponent(symbol.toUpperCase().replace(/\.(NS|BO)$/, ""))}&expiry=${encodeURIComponent(expiry)}` : "",
    !!expiry
  );

  const rows = chain.data?.rows ?? [];
  const stats = useMemo(() => {
    if (!rows.length) return null;
    const ceOI = rows.reduce((s, r) => s + r.ceOI, 0);
    const peOI = rows.reduce((s, r) => s + r.peOI, 0);
    const pcr = peOI > 0 ? ceOI / peOI : null;
    const underlying = chain.data?.underlying ?? (price && isFinite(price) ? price : null);
    const atm = underlying
      ? rows.reduce((a, b) => (Math.abs(b.strike - underlying) < Math.abs(a.strike - underlying) ? b : a))
      : rows[Math.floor(rows.length / 2)];
    const straddle = atm ? atm.ceLTP + atm.peLTP : null;
    return {
      pcr,
      maxPain: maxPain(rows),
      atmStrike: atm?.strike ?? null,
      ceIV: atm?.ceIV ?? null,
      peIV: atm?.peIV ?? null,
      straddle,
      chainAtm: straddle !== null && underlying ? (straddle / underlying) * 100 : null,
      underlying,
      count: rows.length,
    };
  }, [rows, chain.data?.underlying, price]);

  const isIndian = /\.NS$/i.test(symbol) || !/\./.test(symbol);

  if (!isIndian) {
    return (
      <div className="dx-state">
        <div className="dx-state-t">OPTION CHAIN — NSE ONLY</div>
        <div className="dx-state-d">
          {symbol} IS NOT AN NSE CONTRACT, SO NO CHAIN EXISTS FOR IT. THE F&O STRATEGY DESKS
          STILL WORK.
        </div>
        <button className="dx-btn" onClick={() => (window.location.href = "/d/110")}>OPEN OPTION CHAIN DESK</button>
      </div>
    );
  }

  if (exp.loading && !exp.data) return <Skeleton rows={4} height={54} />;
  if (exp.error && !exp.data && !expiries.length)
    return (
      <ErrorState
        what="EXPIRY LIST"
        retry={exp.refresh}
        detail={`${exp.error} — NSE MAY BE BLOCKING THIS HOST. THE OPTION DESK FALLS BACK TO THE SAME FEED.`}
      />
    );

  return (
    <div>
      <div className="dx-pills" role="tablist" aria-label="Expiry">
        {expiries.slice(0, 6).map((x) => (
          <button key={x} className={`dx-pill${x === expiry ? " dx-on" : ""}`} onClick={() => setExpiry(x)}>
            {x.slice(0, 6).toUpperCase()}
          </button>
        ))}
        {!expiries.length ? <span className="dx-note">NO EXPIRIES REPORTED.</span> : null}
      </div>

      {chain.loading && !chain.data ? <Skeleton rows={4} height={54} /> : null}
      {chain.error && !chain.data ? <ErrorState what="CHAIN" retry={chain.refresh} detail={chain.error} /> : null}

      {stats ? (
        <StatStrip
          cells={[
            { label: "PCR (OI)", value: num(stats.pcr, 2), term: "PUT-CALL RATIO" },
            { label: "MAX PAIN", value: num(stats.maxPain, 0) },
            { label: "ATM STRIKE", value: num(stats.atmStrike, 0) },
            { label: "ATM IV CE/PE", value: `${num(stats.ceIV, 1)} / ${num(stats.peIV, 1)}` },
            { label: "ATM STRADDLE", value: num(stats.straddle, 2), sub: stats.chainAtm !== null ? `${stats.chainAtm.toFixed(2)}% OF SPOT` : undefined },
            { label: "SPOT USED", value: num(stats.underlying, 2) },
          ]}
        />
      ) : null}

      {stats ? (
        <MetricList
          title="CHAIN ARITHMETIC"
          rows={[
            { label: "TOTAL CALL OI", value: num(rows.reduce((s, r) => s + r.ceOI, 0), 0), term: "OPEN INTEREST" },
            { label: "TOTAL PUT OI", value: num(rows.reduce((s, r) => s + r.peOI, 0), 0), term: "OPEN INTEREST" },
            { label: "PCR (OI)", value: num(stats.pcr, 2), term: "PUT-CALL RATIO" },
            { label: "STRIKES IN EXPIRY", value: String(stats.count) },
            {
              label: "SPOT vs MAX PAIN",
              value: stats.underlying && stats.maxPain ? pct(((stats.maxPain - stats.underlying) / stats.underlying) * 100, 2, true) : dash,
              tone: stats.underlying && stats.maxPain ? stats.maxPain - stats.underlying : undefined,
            },
          ]}
        />
      ) : null}

      <div className="dx-inline" style={{ marginTop: 10 }}>
        <button className="dx-btn" onClick={() => (window.location.href = `/d/110?symbol=${encodeURIComponent(symbol)}`)}>
          FULL CHAIN DESK →
        </button>
        <button className="dx-btn dx-ghost" onClick={() => (window.location.href = "/d/113")}>GAMMA EXPOSURE</button>
      </div>

      <Note>
        OI / PCR / MAX PAIN ARE ARITHMETIC ON NSE&apos;S REPORTED OPEN INTEREST FOR THE SELECTED
        EXPIRY. IF NSE BLOCKS THE HOST YOU WILL SEE THE ERROR ABOVE RATHER THAN A GUESSED NUMBER.
      </Note>
    </div>
  );
}

// ----------------------------------------------------------------- NEWS

export function NewsSection({ symbol }: { symbol: string }) {
  const news = useApiPoll<NewsResp>(`/api/news?symbol=${encodeURIComponent(symbol)}&feed=company`);
  const items = news.data?.items ?? [];

  return (
    <div>
      <div className="dx-inline" style={{ marginBottom: 10 }}>
        <Badge kind="up">BULL {news.data?.bull ?? 0}</Badge>
        <Badge kind="down">BEAR {news.data?.bear ?? 0}</Badge>
        <Badge kind="mute">TOTAL {news.data?.count ?? 0}</Badge>
        <span className="dx-spacer" />
        <button className="dx-btn dx-ghost" style={{ minHeight: 28, fontSize: 10 }} onClick={news.refresh}>
          ⟳ REFRESH
        </button>
      </div>

      {news.loading && !news.data ? (
        <Skeleton rows={5} height={78} />
      ) : news.error && !news.data ? (
        <ErrorState what="NEWS WIRE" retry={news.refresh} detail={news.error} />
      ) : !items.length ? (
        <div className="dx-state">
          <div className="dx-state-t">NO STORIES YET</div>
          <div className="dx-state-d">THE WIRE RETURNED NOTHING FOR {symbol} RIGHT NOW.</div>
        </div>
      ) : (
        <div className="dx-col" style={{ gap: 8 }}>
          {items.slice(0, 30).map((n, i) => (
            <div key={n.id ?? i} className="dx-news">
              <span className="dx-nt">{n.title}</span>
              {n.desc ? <span className="dx-name" style={{ fontSize: 11.5, lineHeight: 1.5 }}>{n.desc}</span> : null}
              <span className="dx-nm">
                <span>{n.source ?? "WIRE"}</span>
                <span>{n.ago ?? ""}</span>
                <span className={n.label === "BULL" ? "dx-up" : n.label === "BEAR" ? "dx-down" : "dx-faint"}>
                  {n.label ?? "NEUT"}
                </span>
                {n.link ? (
                  <a href={n.link} target="_blank" rel="noreferrer" className="dx-amber">
                    OPEN ↗
                  </a>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      )}

      <Note>WIRE LABELS (BULL / BEAR / NEUT) COME FROM THE EXISTING NEWS DESK CLASSIFIER.</Note>
    </div>
  );
}
