import { NextResponse } from "next/server";
import { yahooFetch } from "@/lib/yahoo";
import {
  DEFAULT_TARGET_KEY, OPENING_TARGETS, TARGET_SESSION_LABEL, istStamp, pctChange, targetSession,
} from "@/lib/opening";

// The market rail behind the selector: one live row per index the desk can be
// read for, so choosing a market is an informed choice rather than a guess at
// what a label means.
//
// Deliberately NOT part of /api/opening. That route's job is one deep snapshot
// of one market; this one is a shallow, fail-open board of all twelve, and
// merging them would put twelve extra chart fetches on the critical path of a
// call that is supposed to be struck at 09:00. A dead index returns ok:false
// with its last/prevClose as null rather than dropping out of the rail — the
// rail must not silently change shape when one feed is down.

export const revalidate = 30;

interface BoardRow {
  key: string;
  label: string;
  symbol: string;
  venue: string;
  group: "INDIA" | "GLOBAL";
  mode: "GAP_CALL" | "TAPE_CHECK";
  calibrated: boolean;
  alsoLeg: boolean;
  session: { state: string; label: string; istWindow: string };
  last: number | null;
  prevClose: number | null;
  chg: number | null;
  ok: boolean;
}

export async function GET() {
  const sess = new Map(OPENING_TARGETS.map((t) => [t.key, targetSession(t)]));

  const rows: BoardRow[] = await Promise.all(
    OPENING_TARGETS.map(async (t): Promise<BoardRow> => {
      const s = sess.get(t.key)!;
      const base: BoardRow = {
        key: t.key, label: t.label, symbol: t.symbol, venue: t.venue,
        group: t.group, mode: t.mode, calibrated: t.calibrated, alsoLeg: t.alsoLeg,
        session: { state: s.state, label: TARGET_SESSION_LABEL[s.state], istWindow: s.istLabel },
        last: null, prevClose: null, chg: null, ok: false,
      };
      try {
        // Same plan the live route uses (60m/5d), deliberately: on some
        // indices Yahoo pins previousClose to the live price and returns a
        // single daily bar, and only the intraday request still carries a
        // usable reference.
        const r = await yahooFetch(
          `/v8/finance/chart/${encodeURIComponent(t.symbol)}?range=5d&interval=60m`,
          { next: { revalidate: 30 } }
        );
        const res = (await r.json())?.chart?.result?.[0];
        if (!res) return base;
        const meta = res.meta ?? {};
        const closes: number[] = (res.indicators?.quote?.[0]?.close ?? []).filter(
          (v: unknown): v is number => typeof v === "number" && isFinite(v)
        );
        const live = typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : null;
        const last = live ?? (closes.length ? closes[closes.length - 1]! : null);
        // Reference candidates in order: the feed's previous close, the chart's
        // previous close, then the previous DAILY bar. Any of them can be the
        // live price on some feed, which would print a permanent 0.00%.
        const usable = (v: unknown): v is number =>
          typeof v === "number" && isFinite(v) && v > 0 && (live === null || v !== live);
        const prev = usable(meta.previousClose)
          ? meta.previousClose
          : usable(meta.chartPreviousClose)
            ? meta.chartPreviousClose
            : null;
        const chg = pctChange(last, prev);
        return {
          ...base,
          last, prevClose: prev, chg,
          ok: last !== null && chg !== null && Math.abs(chg) < 25,
        };
      } catch {
        return base;
      }
    })
  );

  return NextResponse.json({
    fetchedAtIST: istStamp(),
    defaultKey: DEFAULT_TARGET_KEY,
    rows,
  });
}