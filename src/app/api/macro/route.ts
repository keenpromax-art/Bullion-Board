import { NextRequest, NextResponse } from "next/server";
import { fredKey, fredMeta } from "@/lib/fred";

// Macro indicators desk backend — FRED graph CSVs need NO api key.
// Each series: latest, prior-period change, ~1Y change, 24-obs spark.

interface SeriesDef {
  id: string;
  label: string;
  group: string;
  unit: string;
  pp?: boolean; // change quoted in percentage points, not %
  dp?: number; // decimals
}

const SERIES: SeriesDef[] = [
  { id: "GDP", label: "GDP SAAR", group: "US GROWTH", unit: "$B" },
  { id: "GACDISA066MSFRBNY", label: "EMPIRE MFG IDX", group: "US GROWTH", unit: "DI", pp: true },
  { id: "RSAFS", label: "RETAIL SALES", group: "US GROWTH", unit: "$M" },
  { id: "INDPRO", label: "IND PRODUCTION", group: "US GROWTH", unit: "IDX" },
  { id: "PAYEMS", label: "PAYROLLS", group: "US LABOR", unit: "K" },
  { id: "UNRATE", label: "UNEMP RATE", group: "US LABOR", unit: "%", pp: true },
  { id: "ICSA", label: "JOBLESS CLAIMS", group: "US LABOR", unit: "K" },
  { id: "CPIAUCSL", label: "CPI", group: "US INFLATION", unit: "IDX" },
  { id: "PCEPILFE", label: "CORE PCE", group: "US INFLATION", unit: "IDX" },
  { id: "PPIACO", label: "PPI", group: "US INFLATION", unit: "IDX" },
  { id: "FEDFUNDS", label: "FED FUNDS", group: "US RATES", unit: "%", pp: true },
  { id: "DGS2", label: "US 2Y", group: "US RATES", unit: "%", pp: true },
  { id: "DGS10", label: "US 10Y", group: "US RATES", unit: "%", pp: true },
  { id: "T10Y2Y", label: "10Y−2Y", group: "US RATES", unit: "PP", pp: true },
  { id: "BOPGSTB", label: "TRADE BAL", group: "US EXTERNAL", unit: "$M" },
  { id: "UMCSENT", label: "MICHIGAN SENT", group: "US SENTIMENT", unit: "IDX" },
  { id: "CPALTT01INM659N", label: "INDIA CPI", group: "INDIA", unit: "IDX" },
  { id: "IRSTCI01INM156N", label: "INDIA CALL RATE", group: "INDIA", unit: "%", pp: true },
];

interface Obs { date: string; v: number }

async function fetchSeries(def: SeriesDef) {
  const r = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${def.id}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    next: { revalidate: 43200 },
  });
  if (!r.ok) throw new Error(`fred ${def.id} ${r.status}`);
  const text = await r.text();
  const obs: Obs[] = [];
  for (const line of text.split("\n").slice(1)) {
    const [d, v] = line.trim().split(",");
    if (!d || v === undefined) continue;
    const n = Number(v);
    if (d.length >= 8 && isFinite(n)) obs.push({ date: d.slice(0, 10), v: n });
  }
  if (obs.length < 2) throw new Error(`fred ${def.id} empty`);
  const last = obs[obs.length - 1];
  const prev = obs[obs.length - 2];
  const chg = last.v - prev.v;
  // ~1Y-ago observation: latest obs dated on/before last − 365d
  const cutoff = new Date(last.date + "T00:00:00").getTime() - 365 * 86400000;
  let yoyObs: Obs | null = null;
  for (let i = obs.length - 1; i >= 0; i--) {
    if (new Date(obs[i].date + "T00:00:00").getTime() <= cutoff) { yoyObs = obs[i]; break; }
  }
  const dp = def.dp ?? (Math.abs(last.v) < 20 ? 2 : Math.abs(last.v) < 2000 ? 1 : 0);
  const fmt = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: dp, minimumFractionDigits: dp });
  const chgStr = def.pp
    ? `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}pp`
    : `${chg >= 0 ? "+" : ""}${((chg / (prev.v || 1)) * 100).toFixed(2)}%`;
  const yoyStr = yoyObs
    ? def.pp
      ? `${(last.v - yoyObs.v >= 0 ? "+" : "")}${(last.v - yoyObs.v).toFixed(2)}pp`
      : `${(((last.v - yoyObs.v) / (yoyObs.v || 1)) * 100 >= 0 ? "+" : "")}${(((last.v - yoyObs.v) / (yoyObs.v || 1)) * 100).toFixed(2)}%`
    : "—";
  return {
    id: def.id, label: def.label, group: def.group, unit: def.unit,
    latest: fmt(last.v), date: last.date,
    chg: chgStr, chgSign: chg > 0 ? 1 : chg < 0 ? -1 : 0,
    yoy: yoyStr, yoyDate: yoyObs?.date ?? null,
    spark: obs.slice(-24).map((o) => o.v),
    ok: true as const,
  };
}

export async function GET(req: NextRequest) {
  const key = fredKey(req.nextUrl.searchParams.get("fkey"));
  const extra = (req.nextUrl.searchParams.get("extra") || "")
    .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 8)
    .filter((id) => !SERIES.some((d) => d.id === id))
    .map((id) => ({ id, label: id, group: "CUSTOM", unit: "" }));
  const defs = [...SERIES, ...extra];
  const rows = await Promise.all(
    defs.map(async (def) => {
      try {
        return await fetchSeries(def);
      } catch {
        return { id: def.id, label: def.label, group: def.group, unit: def.unit, ok: false as const };
      }
    })
  );
  let enriched = rows;
  if (key) {
    // Official titles/units/frequency on top of keyless values.
    const metas = await Promise.all(
      defs.map(async (def) => {
        try {
          return await fredMeta(def.id, key);
        } catch {
          return null;
        }
      })
    );
    enriched = rows.map((row, i) => {
      const meta = metas[i];
      if (!row.ok || !meta) return row;
      return {
        ...row,
        title: meta.title.toUpperCase().slice(0, 44),
        unit: meta.units ? meta.units.toUpperCase().slice(0, 18) : row.unit,
        freq: meta.frequency,
        seasonal: meta.seasonal,
      };
    });
  }
  const live = enriched.filter((r) => r.ok);
  return NextResponse.json({ count: live.length, of: defs.length, rows: enriched, keyed: !!key });
}
