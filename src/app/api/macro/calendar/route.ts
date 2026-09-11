import { NextRequest, NextResponse } from "next/server";
import { fredKey, fredObservations, fredReleaseDates, fredSeriesRelease } from "@/lib/fred";

// Bloomberg ECO-style economic calendar, powered by the FRED key:
// official release schedules (fred/release/dates) + latest observations
// for Prior/Actual. FRED publishes no consensus survey and no intraday
// times — typical ET times are attached statically and flagged as such.

interface CalEvent {
  series?: string; via?: string;
  event: string; group: string; imp: "HIGH" | "MED" | "LOW";
  time: string; // "08:30 ET" style; IST derived
  freq: "M" | "Q" | "W";
  unit: "K" | "PERS" | "%" | "IDX" | "$B" | "$M" | "DI" | "PP" | "$";
  pp?: boolean;
  dp?: number;
}

const EVENTS: CalEvent[] = [
  { series: "PAYEMS", event: "NFP PAYROLLS", group: "US LABOR", imp: "HIGH", time: "08:30 ET", freq: "M", unit: "K" },
  { series: "UNRATE", via: "PAYEMS", event: "UNEMPLOYMENT RATE", group: "US LABOR", imp: "HIGH", time: "08:30 ET", freq: "M", unit: "%", pp: true },
  { series: "CPIAUCSL", event: "CPI", group: "US INFLATION", imp: "HIGH", time: "08:30 ET", freq: "M", unit: "IDX" },
  { series: "PCEPILFE", event: "CORE PCE", group: "US INFLATION", imp: "HIGH", time: "08:30 ET", freq: "M", unit: "IDX" },
  { series: "PPIACO", event: "PPI", group: "US INFLATION", imp: "MED", time: "08:30 ET", freq: "M", unit: "IDX" },
  { series: "PPIFIS", event: "PPI FINAL DEMAND", group: "US INFLATION", imp: "MED", time: "08:30 ET", freq: "M", unit: "IDX" },
  { series: "CPILFESL", via: "CPIAUCSL", event: "CORE CPI IDX", group: "US INFLATION", imp: "HIGH", time: "08:30 ET", freq: "M", unit: "IDX" },
  { series: "CPIAUCNS", via: "CPIAUCSL", event: "CPI NSA IDX", group: "US INFLATION", imp: "LOW", time: "08:30 ET", freq: "M", unit: "IDX" },
  { series: "PCEPI", via: "PCEPILFE", event: "PCE DEFLATOR", group: "US INFLATION", imp: "MED", time: "08:30 ET", freq: "M", unit: "IDX" },
  { series: "GDPCTPI", via: "GDP", event: "GDP PRICE IDX", group: "US INFLATION", imp: "LOW", time: "08:30 ET", freq: "Q", unit: "IDX" },
  { series: "CES0500000003", via: "PAYEMS", event: "AVG HOURLY EARNINGS", group: "US LABOR", imp: "MED", time: "08:30 ET", freq: "M", unit: "$" },
  { series: "ICSA", event: "JOBLESS CLAIMS", group: "US LABOR", imp: "MED", time: "08:30 ET", freq: "W", unit: "PERS" },
  { series: "RSAFS", event: "RETAIL SALES", group: "US GROWTH", imp: "MED", time: "08:30 ET", freq: "M", unit: "$M" },
  { series: "INDPRO", event: "IND PRODUCTION", group: "US GROWTH", imp: "LOW", time: "09:15 ET", freq: "M", unit: "IDX" },
  { series: "GACDISA066MSFRBNY", event: "EMPIRE MFG IDX", group: "US GROWTH", imp: "LOW", time: "08:30 ET", freq: "M", unit: "DI", pp: true },
  { series: "GDP", event: "GDP SAAR", group: "US GROWTH", imp: "MED", time: "08:30 ET", freq: "Q", unit: "$B" },
  { series: "BOPGSTB", event: "TRADE BALANCE", group: "US EXTERNAL", imp: "LOW", time: "08:30 ET", freq: "M", unit: "$M" },
  { series: "UMCSENT", event: "MICHIGAN SENTIMENT", group: "US SENTIMENT", imp: "LOW", time: "10:00 ET", freq: "M", unit: "IDX" },
  { series: "CPALTT01INM659N", event: "INDIA CPI", group: "INDIA", imp: "MED", time: "17:30 IST", freq: "M", unit: "IDX" },
  { series: "IRSTCI01INM156N", event: "INDIA CALL RATE", group: "INDIA", imp: "LOW", time: "17:30 IST", freq: "M", unit: "%", pp: true },
];

// 2026 FOMC decision dates (2nd day of each meeting, Fed-published schedule).
const FOMC_2026 = ["2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09"];

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function periodLabel(dateStr: string, freq: "M" | "Q" | "W"): string {
  const d = new Date(dateStr + "T12:00:00");
  if (freq === "W") return `W/E ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  if (freq === "Q") {
    const q = Math.floor(d.getMonth() / 3); // quarter containing release
    const pq = (q + 3) % 4; // reported quarter ≈ previous
    return `Q${pq + 1}`;
  }
  const pm = (d.getMonth() + 11) % 12;
  return MONTHS[pm];
}

// US Eastern → IST. DST 2026: Mar 8 – Nov 1 (EDT = +9:30, else +10:30).
function etToIst(dateStr: string, hhmm: string): string {
  const m = hhmm.match(/(\d+):(\d+)/);
  if (!m) return "—";
  const t = new Date(dateStr + "T12:00:00").getTime();
  const dstStart = new Date("2026-03-08T12:00:00").getTime();
  const dstEnd = new Date("2026-11-01T12:00:00").getTime();
  const offMin = t >= dstStart && t < dstEnd ? 570 : 630;
  let mins = Number(m[1]) * 60 + Number(m[2]) + offMin;
  mins = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

function fmtVal(v: number, unit: CalEvent["unit"], dp?: number): string {
  if (unit === "$") return `$${v.toFixed(2)}`;
  if (unit === "K") return `${(v / 1000).toFixed(1)}M`;
  if (unit === "PERS") return `${(v / 1000).toFixed(1)}K`;
  if (unit === "$M") return `${v >= 0 ? "" : "-"}${(Math.abs(v) / 1000).toFixed(1)}B`;
  if (unit === "$B") return `${(v / 1000).toFixed(2)}T`;
  if (unit === "%" || unit === "PP" || unit === "DI") return `${v.toFixed(2)}${unit === "%" ? "%" : ""}`;
  const d = dp ?? (Math.abs(v) < 20 ? 2 : Math.abs(v) < 2000 ? 1 : 0);
  return v.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
}

async function pool<T, R>(arr: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(arr.length);
  let i = 0;
  async function w() {
    while (i < arr.length) {
      const k = i++;
      out[k] = await fn(arr[k]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, arr.length) }, w));
  return out;
}

interface CalRow {
  date: string; inDays: number; timeET: string; timeIST: string;
  event: string; group: string; imp: string; period: string;
  prior: string; actual: string; series: string; release: string; statik?: boolean;
}

export async function GET(req: NextRequest) {
  const key = fredKey(req.nextUrl.searchParams.get("fkey"));
  if (!key) {
    return NextResponse.json(
      { error: "FRED key missing — add FRED_API_KEY env or ?fkey= (free at fred.stlouisfed.org)", upcoming: [], recent: [] },
      { status: 401 }
    );
  }
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const dayMs = 86400000;
  const t0 = new Date(todayStr + "T12:00:00").getTime();
  try {
    const rows = await pool(EVENTS, 6, async (ev): Promise<CalRow[]> => {
      const lookup = ev.via ?? ev.series!;
      try {
        const rel = await fredSeriesRelease(lookup, key);
        const [dates, obs] = await Promise.all([
          fredReleaseDates(rel.id, key).catch(() => [] as string[]),
          fredObservations(ev.series!, key, 4).catch(() => [] as { date: string; value: number }[]),
        ]);
        const L0 = obs[0], L1 = obs[1];
        const out: CalRow[] = [];
        for (const D of dates) {
          const dd = new Date(D + "T12:00:00").getTime();
          const inDays = Math.round((dd - t0) / dayMs);
          if (inDays < -14 || inDays > 45) continue;
          let actual = "—", prior = "—";
          if (inDays > 0) {
            prior = L0 ? fmtVal(L0.value, ev.unit, ev.dp) : "—";
          } else if (L0) {
            if (L0.date <= D) {
              actual = fmtVal(L0.value, ev.unit, ev.dp);
              prior = L1 ? fmtVal(L1.value, ev.unit, ev.dp) : "—";
            } else {
              prior = fmtVal(L0.value, ev.unit, ev.dp);
            }
          }
          const et = ev.time.includes("ET") ? ev.time.replace(" ET", "") : "—";
          out.push({
            date: D, inDays,
            timeET: ev.time,
            timeIST: ev.time.includes("ET") ? `${etToIst(D, et)} IST` : ev.time,
            event: ev.event, group: ev.group, imp: ev.imp,
            period: periodLabel(D, ev.freq),
            prior, actual, series: ev.series!, release: rel.name,
          });
        }
        return out;
      } catch {
        return [];
      }
    });

    // Static FOMC decisions (flagged — not a FRED release).
    const statik: CalRow[] = FOMC_2026.map((D) => {
      const dd = new Date(D + "T12:00:00").getTime();
      return {
        date: D, inDays: Math.round((dd - t0) / dayMs),
        timeET: "14:00 ET", timeIST: `${etToIst(D, "14:00")} IST`,
        event: "FOMC DECISION", group: "US RATES", imp: "HIGH", period: "MTG",
        prior: "—", actual: "—", series: "FEDFUNDS", release: "", statik: true,
      };
    }).filter((r) => r.inDays >= -14 && r.inDays <= 45);

    const all = [...rows.flat(), ...statik];
    const upcoming = all.filter((r) => r.inDays >= 0).sort((a, b) => a.date.localeCompare(b.date) || a.timeET.localeCompare(b.timeET));
    const recent = all.filter((r) => r.inDays < 0).sort((a, b) => b.date.localeCompare(a.date));
    return NextResponse.json({ asOf: todayStr, count: all.length, upcoming, recent, keyed: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "calendar failed", upcoming: [], recent: [] }, { status: 502 });
  }
}
