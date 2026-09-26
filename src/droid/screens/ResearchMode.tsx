"use client";

// RESEARCH MODE (spec §S5) — 12 horizontal snap cards + progress rail.
// Heavy legs (statements / estimates / ownership / dividends / events / news)
// fetch only when their card comes within ±1 of the visible index.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApi, useCompany, useHistory, useQuotes } from "../lib/quotes";
import { chg, cr, dir, istStamp, num, pct } from "../lib/format";
import { macdVerdict, momentumVerdict, riskVerdict, rsiVerdict, techSnapshot, trendVerdict } from "../lib/signals";
import { Badge, ErrorState, H, Note, Skeleton, EmptyState } from "../ui/Pills";
import { MetricList, SignalRow, StatStrip } from "../ui/Cards";
import AIChatPanel from "../ui/AIChatPanel";
import TouchChart from "../ui/TouchChart";

const CARDS = [
  "OVERVIEW",
  "TECHNICALS",
  "FUNDAMENTALS",
  "VALUATION",
  "ESTIMATES",
  "OWNERSHIP",
  "DIVIDENDS",
  "EVENTS",
  "NEWS",
  "RISK",
  "PRICE PATH",
  "AI ANALYSIS",
] as const;

interface TableLike {
  periods?: string[];
  rows?: Array<{ label: string; values: (number | null)[] }>;
}

export default function ResearchMode({ symbol }: { symbol: string }) {
  const router = useRouter();
  const [idx, setIdx] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  const company = useCompany(symbol);
  const hist = useHistory(symbol, "1y", "1d");
  const qt = useQuotes([symbol]);

  const near = (i: number) => Math.abs(i - idx) <= 1;
  const q = qt.data?.[symbol] ?? company.data?.quote ?? null;
  const profile = company.data?.profile ?? null;

  const st = useApi<{ pl?: TableLike | null; bs?: TableLike | null; cf?: TableLike | null; unit?: string; marketCapCr?: number | null }>(
    `/api/statements?symbol=${encodeURIComponent(symbol)}`,
    near(2)
  );
  const est = useApi<{
    recommendation?: Record<string, number | null> | null;
    nextEarnings?: string | null;
    earningsTrend?: Array<{ period?: string; growth?: number | null; epsTrend?: { current?: number | null; low?: number | null; high?: number | null } }>;
  }>(`/api/estimates?symbol=${encodeURIComponent(symbol)}`, near(4));
  const own = useApi<{ holders?: Array<{ name?: string; pct?: number }>; summary?: { insider?: number | null; institution?: number | null; promoter?: number | null } }>(
    `/api/ownership?symbol=${encodeURIComponent(symbol)}`,
    near(5)
  );
  const div = useApi<{ dividendYield?: number | null; ttmTotal?: number | null; history?: Array<{ date?: string; amount?: number }>; payoutsTTM?: number | null }>(
    `/api/dividends?symbol=${encodeURIComponent(symbol)}`,
    near(6)
  );
  const ev = useApi<{ dividends?: Array<{ date: string; amount?: number }>; splits?: Array<{ date: string; ratio?: string }> }>(
    `/api/events?symbol=${encodeURIComponent(symbol)}`,
    near(7)
  );
  const news = useApi<{ items?: Array<{ id?: string | number; title: string; link?: string; source?: string; ago?: string; label?: "BULL" | "BEAR" | "NEUT" }>; count?: number; bull?: number; bear?: number }>(
    `/api/news?symbol=${encodeURIComponent(symbol)}&feed=company`,
    near(8)
  );

  const snap = useMemo(() => (hist.data?.bars?.length ? techSnapshot(hist.data.bars) : null), [hist.data]);

  const onScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const card = el.clientWidth * 0.86 + 10;
    const i = Math.min(CARDS.length - 1, Math.max(0, Math.round(el.scrollLeft / card)));
    setIdx((prev) => (prev === i ? prev : i));
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [onScroll]);

  const name = profile?.name || q?.shortName || symbol;
  const px = q?.regularMarketPrice ?? null;

  const card = (i: number, title: string, body: React.ReactNode, caveat?: string) => (
    <article className="dx-rcard" key={title} aria-label={`${i + 1} of ${CARDS.length}`}>
      <div className="dx-card" style={{ minHeight: 260 }}>
        <div className="p-head">
          {String(i + 1).padStart(2, "0")} {title} <span className="faint">- {name}</span>
        </div>
        {body}
        {caveat ? <div className="dx-note" style={{ marginTop: 8 }}>{caveat}</div> : null}
      </div>
    </article>
  );

  return (
    <div>
      <H
        right={
          <span className="dx-inline">
            <Link href={`/s/${encodeURIComponent(symbol)}`} style={{ fontSize: 10 }}>SECURITY →</Link>
            <button className="dx-btn dx-ghost" style={{ minHeight: 28, fontSize: 10 }} onClick={() => company.refresh()}>
              ⟳
            </button>
          </span>
        }
      >
        RESEARCH MODE
      </H>

      <div className="dx-sec-top">
        <div className="dx-sec-head">
          <span className="dx-sec-name">{name}</span>
          <span className="dx-sec-px dx-mono-num">{num(px, 2)}</span>
          <span className={`dx-sec-chg ${dir(q?.regularMarketChangePercent)}`}>{chg(q?.regularMarketChangePercent)}</span>
        </div>
        <span className="dx-sec-meta">{symbol} · {profile?.exchange ?? "NSE"} · {istStamp()}</span>
      </div>

      <div className="dx-rprog" aria-hidden>
        {CARDS.map((c, i) => (
          <span key={c} className={i === idx ? "dx-on" : undefined} />
        ))}
      </div>

      <div className="dx-inline" style={{ marginBottom: 8 }}>
        <Badge kind="fnc">{String(idx + 1).padStart(2, "0")} / {CARDS.length}</Badge>
        <Badge kind="mute">{CARDS[idx]}</Badge>
        <span className="dx-spacer" />
        <button
          className="dx-btn dx-ghost"
          style={{ minHeight: 30, fontSize: 11 }}
          disabled={idx === 0}
          onClick={() => {
            const el = trackRef.current;
            if (el) el.scrollTo({ left: (el.clientWidth * 0.86 + 10) * (idx - 1) });
          }}
        >
          ‹
        </button>
        <button
          className="dx-btn dx-ghost"
          style={{ minHeight: 30, fontSize: 11 }}
          disabled={idx === CARDS.length - 1}
          onClick={() => {
            const el = trackRef.current;
            if (el) el.scrollTo({ left: (el.clientWidth * 0.86 + 10) * (idx + 1) });
          }}
        >
          ›
        </button>
      </div>

      <div className="dx-rcard-track" ref={trackRef}>
        {/* 01 OVERVIEW */}
        {card(0, "OVERVIEW", (
          <>
            <StatStrip
              cells={[
                { label: "52W HIGH", value: num(profile?.price?.hi52, 2) },
                { label: "52W LOW", value: num(profile?.price?.lo52, 2) },
                { label: "MKT CAP", value: company.data?.derived?.mktCap != null ? `₹${cr(company.data.derived.mktCap)}` : "—" },
                { label: "P/E", value: num(company.data?.derived?.trailPE, 1) },
                { label: "BETA", value: num(profile?.price?.beta, 2) },
                { label: "DIV YIELD", value: company.data?.derived?.yieldPct != null ? `${company.data.derived.yieldPct.toFixed(2)}%` : "—" },
              ]}
            />
            <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--dx-sub)", marginTop: 8 }}>
              {profile?.summary ?? "NO BUSINESS SUMMARY REPORTED FOR THIS SYMBOL."}
            </div>
          </>
        ), "SOURCE /api/company. MISSING FIELDS RENDER AS —.")}

        {/* 02 TECHNICALS */}
        {card(1, "TECHNICALS", snap ? (
          <>
            <SignalRow label="TREND" value={trendVerdict(snap).value} tone={trendVerdict(snap).tone === "up" ? 1 : trendVerdict(snap).tone === "down" ? -1 : 0} detail={trendVerdict(snap).detail} />
            <SignalRow label="RSI(14)" value={num(snap.rsi14, 1)} tone={rsiVerdict(snap).tone === "up" ? 1 : rsiVerdict(snap).tone === "down" ? -1 : 0} detail={rsiVerdict(snap).detail} />
            <SignalRow label="MACD" value={macdVerdict(snap).value} tone={macdVerdict(snap).tone === "up" ? 1 : macdVerdict(snap).tone === "down" ? -1 : 0} detail={macdVerdict(snap).detail} />
            <SignalRow label="MOMENTUM 1M" value={snap.ret1M !== null ? pct(snap.ret1M, 1, true) : "—"} tone={momentumVerdict(snap).tone === "up" ? 1 : momentumVerdict(snap).tone === "down" ? -1 : 0} detail={momentumVerdict(snap).detail} />
            <SignalRow label="RISK" value={riskVerdict(snap, profile?.price?.beta).value} tone={riskVerdict(snap, profile?.price?.beta).tone === "up" ? 1 : riskVerdict(snap, profile?.price?.beta).tone === "down" ? -1 : 0} detail={riskVerdict(snap, profile?.price?.beta).detail} />
          </>
        ) : (
          <Skeleton rows={4} height={44} />
        ), "COMPUTED FROM THE 1Y DAILY TAPE ON DEVICE — NOT ADVICE.")}

        {/* 03 FUNDAMENTALS */}
        {card(2, "FUNDAMENTALS", st.loading && !st.data ? (
          <Skeleton rows={5} height={44} />
        ) : st.error && !st.data ? (
          <ErrorState what="STATEMENTS" retry={st.refresh} detail={st.error} />
        ) : (
          <MetricList
            rows={[
              { label: "REVENUE (LATEST)", value: (() => { const r = st.data?.pl?.rows?.find((x) => /revenue|total revenue|sales/i.test(x.label)); const v = r?.values[r.values.length - 1]; return v == null ? "—" : num(v, 1); })() },
              { label: "NET INCOME (LATEST)", value: (() => { const r = st.data?.pl?.rows?.find((x) => /net income|profit after tax/i.test(x.label)); const v = r?.values[r.values.length - 1]; return v == null ? "—" : num(v, 1); })() },
              { label: "UNIT", value: st.data?.unit ?? "—" },
              { label: "LATEST PERIOD", value: st.data?.pl?.periods?.[st.data.pl.periods.length - 1] ?? "—" },
              { label: "MARGIN (NET)", value: profile?.margins?.net != null ? `${profile.margins.net.toFixed(1)}%` : "—" },
              { label: "ROE", value: profile?.margins?.roe != null ? `${profile.margins.roe.toFixed(1)}%` : "—" },
            ]}
          />
        ), "AS REPORTED BY THE FUNDAMENTALS FEED — NO RESTATEMENT.")}

        {/* 04 VALUATION */}
        {card(3, "VALUATION", (
          <MetricList
            rows={[
              { label: "P/E (TRAIL)", value: num(company.data?.derived?.trailPE, 1) },
              { label: "P/E (FWD)", value: num(profile?.valuation?.fwdPE, 1) },
              { label: "PEG", value: num(profile?.valuation?.peg, 2) },
              { label: "P/B", value: num(profile?.valuation?.pb, 2) },
              { label: "EV/EBITDA", value: num(profile?.valuation?.evEbitda, 1) },
              { label: "EPS (TRAIL)", value: num(profile?.valuation?.trailEps, 2) },
            ]}
          />
        ), "DIRECT READS FROM /api/company — NO TARGET PRICE IS COMPUTED.")}

        {/* 05 ESTIMATES */}
        {card(4, "ESTIMATES", est.loading && !est.data ? (
          <Skeleton rows={4} height={44} />
        ) : est.error && !est.data ? (
          <ErrorState what="ESTIMATES" retry={est.refresh} detail={est.error} />
        ) : (
          <MetricList
            rows={[
              { label: "NEXT EARNINGS", value: est.data?.nextEarnings ?? "—" },
              { label: "STRONG BUY", value: num(est.data?.recommendation?.strongBuy, 0) },
              { label: "BUY", value: num(est.data?.recommendation?.buy, 0) },
              { label: "HOLD", value: num(est.data?.recommendation?.hold, 0) },
              { label: "SELL", value: num(est.data?.recommendation?.sell, 0) },
              { label: "EPS EST. GROWTH", value: est.data?.earningsTrend?.[0]?.growth != null ? pct(est.data.earningsTrend[0].growth * 100, 1, true) : "—" },
            ]}
          />
        ), "BROKER COUNTS AS REPORTED — WE DO NOT AVERAGE THEM INTO A TARGET.")}

        {/* 06 OWNERSHIP */}
        {card(5, "OWNERSHIP", own.loading && !own.data ? (
          <Skeleton rows={4} height={44} />
        ) : own.error && !own.data ? (
          <ErrorState what="OWNERSHIP" retry={own.refresh} detail={own.error} />
        ) : (
          <MetricList
            rows={[
              { label: "INSIDER / PROMOTER", value: own.data?.summary?.promoter != null ? `${own.data.summary.promoter.toFixed(2)}%` : own.data?.summary?.insider != null ? `${own.data.summary.insider.toFixed(2)}%` : "—" },
              { label: "INSTITUTIONAL", value: own.data?.summary?.institution != null ? `${own.data.summary.institution.toFixed(2)}%` : "—" },
              ...(own.data?.holders ?? []).slice(0, 6).map((h) => ({
                label: (h.name ?? "HOLDER").toUpperCase().slice(0, 22),
                value: h.pct != null ? `${h.pct.toFixed(2)}%` : "—",
              })),
            ]}
          />
        ), "HOLDINGS AS REPORTED — GAPS STAY GAPS.")}

        {/* 07 DIVIDENDS */}
        {card(6, "DIVIDENDS", div.loading && !div.data ? (
          <Skeleton rows={4} height={44} />
        ) : div.error && !div.data ? (
          <ErrorState what="DIVIDENDS" retry={div.refresh} detail={div.error} />
        ) : (
          <MetricList
            rows={[
              { label: "DIVIDEND YIELD", value: div.data?.dividendYield != null ? `${div.data.dividendYield.toFixed(2)}%` : company.data?.derived?.yieldPct != null ? `${company.data.derived.yieldPct.toFixed(2)}%` : "—" },
              { label: "TTM PAYOUT", value: div.data?.ttmTotal != null ? `₹${num(div.data.ttmTotal, 2)}` : "—" },
              { label: "PAYOUTS (TTM)", value: num(div.data?.payoutsTTM, 0) },
              ...(div.data?.history ?? []).slice(0, 5).map((d) => ({ label: d.date ?? "—", value: `₹${num(d.amount, 2)}` })),
            ]}
          />
        ), "FROM THE CHART FEED'S DIVIDEND EVENTS.")}

        {/* 08 EVENTS */}
        {card(7, "EVENTS", ev.loading && !ev.data ? (
          <Skeleton rows={4} height={44} />
        ) : ev.error && !ev.data ? (
          <ErrorState what="EVENTS" retry={ev.refresh} detail={ev.error} />
        ) : (
          <MetricList
            rows={[
              ...(ev.data?.dividends ?? []).slice(0, 5).map((d) => ({ label: `DIVIDEND · ${d.date}`, value: `₹${num(d.amount, 2)}` })),
              ...(ev.data?.splits ?? []).slice(0, 3).map((s) => ({ label: `SPLIT · ${s.date}`, value: String(s.ratio ?? "—") })),
              ...(ev.data?.dividends?.length || ev.data?.splits?.length
                ? []
                : [{ label: "RECORDED EVENTS", value: "—" }]),
            ]}
          />
        ), "LAST 5 YEARS OF RECORDED CORPORATE ACTIONS.")}

        {/* 09 NEWS */}
        {card(8, "NEWS", news.loading && !news.data ? (
          <Skeleton rows={4} height={56} />
        ) : news.error && !news.data ? (
          <ErrorState what="WIRE" retry={news.refresh} detail={news.error} />
        ) : (
          <div className="dx-col" style={{ gap: 8 }}>
            <div className="dx-inline">
              <Badge kind="up">BULL {news.data?.bull ?? 0}</Badge>
              <Badge kind="down">BEAR {news.data?.bear ?? 0}</Badge>
              <Badge kind="mute">TOTAL {news.data?.count ?? 0}</Badge>
            </div>
            {(news.data?.items ?? []).slice(0, 6).map((n, i) => (
              <a key={n.id ?? i} className="dx-news" href={n.link} target="_blank" rel="noreferrer">
                <span className="dx-nt">{n.title}</span>
                <span className="dx-nm">
                  <span>{n.source ?? "WIRE"}</span>
                  <span>{n.ago ?? ""}</span>
                </span>
              </a>
            ))}
            {!(news.data?.items ?? []).length ? (
              <EmptyState title="NO STORIES" desc="THE WIRE RETURNED NOTHING FOR THIS SYMBOL." />
            ) : null}
          </div>
        ), "LABELS FROM THE EXISTING NEWS CLASSIFIER.")}

        {/* 10 RISK */}
        {card(9, "RISK", snap ? (
          <StatStrip
            cells={[
              { label: "ANNUALISED VOL", value: snap.vol1Y !== null ? `${snap.vol1Y.toFixed(1)}%` : "—" },
              { label: "MAX DD (1Y)", value: snap.maxDD !== null ? `${snap.maxDD.toFixed(1)}%` : "—" },
              { label: "ATR %", value: num(snap.atrPct, 2) },
              { label: "BETA", value: num(profile?.price?.beta, 2) },
              { label: "RETURN 1Y", value: snap.ret1Y !== null ? pct(snap.ret1Y, 1, true) : "—" },
              { label: "BARS", value: String(snap.bars) },
            ]}
          />
        ) : (
          <Skeleton rows={2} height={56} />
        ), "RISK IS MEASURED, NOT PREDICTED. PAST VOLATILITY ≠ FUTURE.")}

        {/* 11 PRICE PATH */}
        {card(10, "PRICE PATH", hist.loading && !hist.data ? (
          <Skeleton rows={1} height={210} />
        ) : hist.error && !hist.data ? (
          <ErrorState what="1Y TAPE" retry={hist.refresh} detail={hist.error} />
        ) : hist.data?.bars?.length ? (
          <TouchChart bars={hist.data.bars} label={`${symbol} · 1Y`} lite />
        ) : (
          <EmptyState title="NO BARS" desc="THE 1Y TAPE RETURNED NOTHING." />
        ), "PAN / PINCH / LONG-PRESS. SOURCE /api/history?range=1y&interval=1d.")}

        {/* 12 AI */}
        {card(11, "AI ANALYSIS", (
          <AIChatPanel
            context={`${name} (${symbol}) · RSI ${num(snap?.rsi14, 1)} · 1Y ${snap?.ret1Y != null ? pct(snap.ret1Y, 1, true) : "—"} · P/E ${num(company.data?.derived?.trailPE, 1)} · ${profile?.sector ?? "SECTOR —"}`}
            desk="RESEARCH MODE"
            symbol={symbol}
            placeholder={`ASK ABOUT ${symbol.replace(/\.(NS|BO)$/, "")}…`}
          />
        ), "THE MODEL SEES THIS CARD'S CONTEXT AND CANNOT INVENT NUMBERS.")}
      </div>

      <Note>
        SWIPE THE CARDS HORIZONTALLY — THE RAIL ABOVE TRACKS YOUR PLACE. HEAVY FIELDS LOAD ONLY WHEN
        THEIR CARD COMES INTO VIEW. {hist.ts ? `TAPE ${istStamp(new Date(hist.ts))}.` : ""}
      </Note>

      <div className="dx-inline" style={{ marginTop: 10 }}>
        <button className="dx-pill" onClick={() => router.push(`/s/${encodeURIComponent(symbol)}`)}>◈ SECURITY</button>
        <button className="dx-pill" onClick={() => router.push(`/d/1?symbol=${encodeURIComponent(symbol)}`)}>TECHNICALS DESK</button>
        <button className="dx-pill" onClick={() => router.push(`/d/18?symbol=${encodeURIComponent(symbol)}`)}>DCF</button>
        <button className="dx-pill" onClick={() => router.push(`/research?compare=${encodeURIComponent(symbol)}`)}>⇄ COMPARE</button>
      </div>
    </div>
  );
}
