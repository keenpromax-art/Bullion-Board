import { NextRequest, NextResponse } from "next/server";
import { yahooFetch } from "@/lib/yahoo";
import {
  TARGET_SESSION_LABEL, openingTarget, round2, targetSession,
} from "@/lib/opening";
import {
  PATH_MARKS, PATH_MIN_SAMPLE, buildPath, buildSessions, modalBarCount, zonedDate,
} from "@/lib/intradayPath";
import type { HourBar, PathSession } from "@/lib/intradayPath";

// Intraday path projection for module 109 / FNC PRE — `?market=` picks the index,
// exactly as /api/opening does, so the track and the call are always about the
// same tape.
//
// TWO FETCHES, ON PURPOSE, BECAUSE THEY CACHE ON DIFFERENT CLOCKS.
//   730d/1h  Two years of hourly bars. This is the SAMPLE: every conditional
//            distribution and the out-of-sample grade come from it. It changes
//            once a day, so it is cached for the hour.
//   5d/60m   Today's session at the venue's own bar size, plus meta for the live
//            level. This changes every minute, so it is cached for 60s.
// Reusing the 2y fetch for the live price would have made the track up to an
// hour stale while the call beside it updated every 30s — two desks disagreeing
// about the same index inside one panel.
//
// THE SESSION CLOCK IS THE ROUTE'S, NOT THE LIBRARY'S. Whether the market has
// opened, how many hourly bars have SETTLED, and what "the close" is called in
// both IST and venue time all come from `targetSession`, so the track's end
// point is the same clock the rest of the desk is on. A partially printed bar is
// never counted: an hourly bar stamped t covers [t, t+3600), and until it has
// fully settled its close is a live price, not an hour boundary.

export const revalidate = 120;

interface RawChart {
  meta: Record<string, any>;
  ts: number[];
  o: Array<number | null>;
  h: Array<number | null>;
  l: Array<number | null>;
  c: Array<number | null>;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && isFinite(v) ? v : null;

async function chart(symbol: string, range: string, interval: "60m" | "1h", revalidateSec: number): Promise<RawChart | null> {
  try {
    const r = await yahooFetch(
      `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`,
      { next: { revalidate: revalidateSec } }
    );
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    if (!res) return null;
    const q = res.indicators?.quote?.[0] ?? {};
    return { meta: res.meta ?? {}, ts: res.timestamp ?? [], o: q.open ?? [], h: q.high ?? [], l: q.low ?? [], c: q.close ?? [] };
  } catch {
    return null;
  }
}

function bars(raw: RawChart): HourBar[] {
  const out: HourBar[] = [];
  for (let i = 0; i < raw.ts.length; i++) {
    const close = num(raw.c[i]);
    if (close === null || close <= 0) continue;
    out.push({
      ts: raw.ts[i]!,
      close,
      open: num(raw.o[i]) ?? close,
      high: num(raw.h[i]) ?? close,
      low: num(raw.l[i]) ?? close,
    });
  }
  return out;
}

export async function GET(req: NextRequest) {
  const asked = (req.nextUrl.searchParams.get("market") ?? req.nextUrl.searchParams.get("target") ?? "").trim().toUpperCase();
  const t = openingTarget(asked);
  const unknownMarket = !!asked && t.key !== asked;
  const nowSec = Math.floor(Date.now() / 1000);
  const sess = targetSession(t);

  const caveats: string[] = [];
  if (unknownMarket) caveats.push(`UNKNOWN MARKET "${asked}" — ${t.label} SERVED INSTEAD`);

  const [histRaw, liveRaw] = await Promise.all([
    chart(t.symbol, "730d", "1h", 3600),
    chart(t.symbol, "5d", "60m", 60),
  ]);

  if (!histRaw) {
    return NextResponse.json(
      { error: `${t.symbol} HOURLY HISTORY UNAVAILABLE — THE PATH NEEDS TWO YEARS OF INTRADAY BARS TO HAVE A SAMPLE AT ALL` },
      { status: 502 }
    );
  }

  // Reconstruct on the venue's own calendar, from history alone first so the
  // modal slot count is not dragged down by today's partial session.
  const history = buildSessions(bars(histRaw), t.tz, t.openHHMM, t.closeHHMM);
  const capacity = modalBarCount(history);
  if (capacity < 2) {
    return NextResponse.json(
      { error: `${t.symbol} HOURLY BARS DID NOT RECONSTRUCT INTO A SINGLE FULL SESSION ON THE ${t.tz} CLOCK (${t.openHHMM}-${t.closeHHMM}) — NO SAMPLE` },
      { status: 502 }
    );
  }

  // The LAST session on the 5d feed is only "today" if it is today ON THE
  // VENUE'S CALENDAR. Off-hours — and for the US, Tokyo and Hong Kong targets,
  // most of the Indian trading day — the newest session is yesterday's, and
  // treating it as live would report yesterday's settled bar count as this
  // session's, shifting every mark an hour forward and claiming a track for a
  // market that has not rung yet. No session today means elapsed 0 and a
  // prior-close anchor, which is exactly what the pre-open model is for.
  const todayBars = liveRaw ? bars(liveRaw) : [];
  const liveSessions = todayBars.length ? buildSessions(todayBars, t.tz, t.openHHMM, t.closeHHMM) : [];
  const newest = liveSessions.length ? liveSessions[liveSessions.length - 1]! : null;
  const todayKey = zonedDate(nowSec, t.tz);
  const live = newest && newest.date === todayKey ? newest : null;
  const liveDate = live?.date ?? null;
  const staleSession = newest && !live ? newest.date : null;

  // Today's session, counted in SETTLED hourly bars. The live 60m feed prints at
  // the same hourly boundaries for these venues; where it does not, the last
  // settled bar is simply one interval behind, which is stated below rather than
  // papered over by pretending the forming bar is complete.
  // A bar stamped t covers [t, t+3600), so it has only settled once t+3600 has
  // passed. The forming bar is the live price, not an hour boundary, and must
  // not be counted — otherwise the whole track shifts forward an hour and the
  // anchor sits inside a bar that history never had.
  const settled = live ? live.bars.filter((b) => b.ts + 3600 <= nowSec) : [];
  const forming = live ? live.bars.length - settled.length : 0;
  const elapsed = settled.length;

  const meta = liveRaw?.meta ?? {};
  const last = num(meta.regularMarketPrice) ?? (live ? live.bars[live.bars.length - 1]!.close : null);
  const prevClose = num(meta.previousClose) ?? (history.length ? history[history.length - 1]!.priorClose : null);
  const todayOpen = live?.open ?? settled[0]?.open ?? null;
  const gapPct = todayOpen !== null && prevClose ? ((todayOpen / prevClose) - 1) * 100 : null;

  if (forming > 0) {
    caveats.push(`${forming} HOURLY BAR${forming === 1 ? "" : "S"} STILL FORMING ON ${t.symbol} — THE TRACK IS PROJECTED FROM THE LAST SETTLED HOUR, NOT MID-BAR.`);
  }
  if (!live) {
    caveats.push(
      staleSession
        ? `${t.label} HAS NOT PRINTED A SESSION ON THIS CLOCK — SESSION ${sess.state}. THE NEWEST SESSION ON THE FEED IS ${staleSession} AND IS NOT USED AS A LIVE TAPE. THE TRACK IS THE HISTORICAL SHAPE FROM THE PRIOR CLOSE.`
        : `${t.label} HAS NOT PRINTED A SESSION ON THIS CLOCK — SESSION ${sess.state}. THE TRACK IS THE HISTORICAL SHAPE FROM THE PRIOR CLOSE.`
    );
  }

  // The sample: history plus today's session, with today dropped inside
  // `buildPath` so it can never be fitted on itself.
  const sessions: PathSession[] = live
    ? [...history.filter((s) => s.date !== live.date), live].sort((a, b) => (a.date < b.date ? -1 : 1))
    : history;

  const pool = sessions.filter((s) => s.date !== liveDate && s.bars.length >= 2 && s.priorClose !== null).length;
  const path = buildPath({
    sessions,
    todayDate: liveDate ?? "__none__",
    capacity,
    elapsed,
    // Pre-open the anchor is the PRIOR CLOSE, not an indicative overnight level:
    // history is anchored the same way at elapsed 0, so the forward return being
    // averaged starts from the same point on both sides. Once the bell has rung
    // the anchor is the live level, which is where we actually are.
    anchorLevel: sess.state === "OPEN" || sess.state === "CLOSED" ? last : prevClose,
    prevClose,
    todayGapPct: gapPct,
    tz: t.tz,
    closeIST: sess.istLabel.split("–")[1]?.split(" ")[0] ?? t.closeHHMM,
    closeLocal: t.closeHHMM,
  });

  caveats.push(...path.caveats);

  const realised = (live?.bars ?? []).map((b) => {
    const d = new Date((b.ts + 19800) * 1000);
    return {
      ist: `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`,
      local: new Intl.DateTimeFormat("en-GB", { timeZone: t.tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(b.ts * 1000)),
      close: round2(b.close),
      settled: b.ts + 3600 <= nowSec,
    };
  });

  const projected = path.marks.filter((m) => m.level !== null);
  return NextResponse.json({
    fetchedAtIST: new Date((nowSec + 19800) * 1000).toISOString().slice(0, 16).replace("T", " ") + " IST",
    market: {
      key: t.key, label: t.label, symbol: t.symbol, venue: t.venue,
      tz: t.tz, openHHMM: t.openHHMM, closeHHMM: t.closeHHMM,
    },
    session: {
      state: sess.state, label: TARGET_SESSION_LABEL[sess.state], istWindow: sess.istLabel,
      localWindow: `${t.openHHMM}–${t.closeHHMM} ${t.tz}`,
      toOpenMin: sess.toOpen,
    },
    anchor: {
      level: round2(last ?? prevClose ?? NaN),
      prevClose: round2(prevClose ?? NaN),
      open: todayOpen === null ? null : round2(todayOpen),
      gapPct: gapPct === null ? null : round2(gapPct),
      barsSettled: elapsed,
      barsForming: forming,
      capacity,
    },
    marks: path.marks,
    bucket: path.bucket,
    grade: path.grade,
    sample: {
      sessions: pool,
      capacity,
      windowFrom: history.length ? history[0]!.date : null,
      windowTo: history.length ? history[history.length - 1]!.date : null,
      floor: PATH_MIN_SAMPLE,
    },
    realised,
    summary: {
      marksPublished: projected.length,
      markHours: PATH_MARKS,
      first: projected[0] ?? null,
      last: projected.length ? projected[projected.length - 1]! : null,
      verdict: path.grade?.verdict ?? "NOT GRADED",
    },
    caveats,
  });
}
