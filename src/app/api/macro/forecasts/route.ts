import { NextRequest, NextResponse } from "next/server";
import { fredKey, fredObservations } from "@/lib/fred";

// Economic Forecasts (ECFC): annual history from keyless FRED CSVs +
// forward medians from FOMC SEP (needs FRED key). Clicking a table row
// graphs that indicator (client side).

interface HistDef { key: string; label: string; unit: string; id: string; mode: "yoy" | "avg" | "avgK" }

const US_HIST: HistDef[] = [
  { key: "RGDP", label: "REAL GDP YOY", unit: "%", id: "GDPC1", mode: "yoy" },
  { key: "CPI", label: "CPI YOY", unit: "%", id: "CPIAUCSL", mode: "yoy" },
  { key: "PCE", label: "PCE PRICE IDX YOY", unit: "%", id: "PCEPI", mode: "yoy" },
  { key: "UNRATE", label: "UNEMPLOYMENT", unit: "%", id: "UNRATE", mode: "avg" },
  { key: "FEDFUNDS", label: "FED FUNDS", unit: "%", id: "FEDFUNDS", mode: "avg" },
  { key: "DGS10", label: "US 10Y", unit: "%", id: "DGS10", mode: "avg" },
  { key: "HOUST", label: "HOUSING STARTS", unit: "K", id: "HOUST", mode: "avgK" },
  { key: "INDPRO", label: "IND PRODUCTION YOY", unit: "%", id: "INDPRO", mode: "yoy" },
  { key: "PAYEMS", label: "PAYROLLS YOY", unit: "%", id: "PAYEMS", mode: "yoy" },
];

const SEP: Array<{ key: string; id: string }> = [
  { key: "RGDP", id: "GDPC1MD" },
  { key: "PCE", id: "PCECTPIMD" },
  { key: "UNRATE", id: "UNRATEMD" },
  { key: "FEDFUNDS", id: "FEDTARMD" },
];

interface CountryCfg {
  slug: string;
  label: string;
  hist: HistDef[];
  sep: boolean; // FOMC SEP forwards exist for the US only
}

// Non-US series reuse the IDs already proven live by /api/macro/matrix
// (ECMX). Quarterly GDP levels + monthly CPI indices collapse to annual
// averages via the shared "yoy" mode; WB annual-% CPI prints use "avg".
const COUNTRIES: CountryCfg[] = [
  { slug: "us", label: "UNITED STATES", hist: US_HIST, sep: true },
  {
    slug: "germany", label: "GERMANY", sep: false, hist: [
      { key: "GDP", label: "REAL GDP YOY", unit: "%", id: "CLVMNACSCAB1GQDE", mode: "yoy" },
      { key: "CPI", label: "CPI YOY", unit: "%", id: "CP0000DEM086NEST", mode: "yoy" },
      { key: "UNE", label: "UNEMPLOYMENT", unit: "%", id: "LRHUTTTTDEM156S", mode: "avg" },
      { key: "RATE", label: "ECB POLICY RATE", unit: "%", id: "ECBDFR", mode: "avg" },
    ],
  },
  {
    slug: "france", label: "FRANCE", sep: false, hist: [
      { key: "GDP", label: "REAL GDP YOY", unit: "%", id: "CLVMNACSCAB1GQFR", mode: "yoy" },
      { key: "CPI", label: "CPI YOY", unit: "%", id: "CP0000FRM086NEST", mode: "yoy" },
      { key: "UNE", label: "UNEMPLOYMENT", unit: "%", id: "LRHUTTTTFRM156S", mode: "avg" },
      { key: "RATE", label: "ECB POLICY RATE", unit: "%", id: "ECBDFR", mode: "avg" },
    ],
  },
  {
    slug: "italy", label: "ITALY", sep: false, hist: [
      { key: "GDP", label: "REAL GDP YOY", unit: "%", id: "CLVMNACSCAB1GQIT", mode: "yoy" },
      { key: "CPI", label: "CPI YOY", unit: "%", id: "CP0000ITM086NEST", mode: "yoy" },
      { key: "UNE", label: "UNEMPLOYMENT", unit: "%", id: "LRHUTTTTITM156S", mode: "avg" },
      { key: "RATE", label: "ECB POLICY RATE", unit: "%", id: "ECBDFR", mode: "avg" },
    ],
  },
  {
    slug: "uk", label: "UNITED KINGDOM", sep: false, hist: [
      // No live UK CPI series on FRED (OECD vintages end Mar-2025) — GDP,
      // labor and overnight-rate proxy only.
      { key: "GDP", label: "REAL GDP YOY", unit: "%", id: "NGDPRSAXDCGBQ", mode: "yoy" },
      { key: "UNE", label: "UNEMPLOYMENT", unit: "%", id: "LRHUTTTTGBM156S", mode: "avg" },
      { key: "RATE", label: "POLICY RATE PROXY", unit: "%", id: "IRSTCI01GBM156N", mode: "avg" },
    ],
  },
  {
    slug: "japan", label: "JAPAN", sep: false, hist: [
      { key: "GDP", label: "REAL GDP YOY", unit: "%", id: "JPNRGDPEXP", mode: "yoy" },
      { key: "CPI", label: "CPI YOY", unit: "%", id: "FPCPITOTLZGJPN", mode: "avg" },
      { key: "UNE", label: "UNEMPLOYMENT", unit: "%", id: "LRHUTTTTJPM156S", mode: "avg" },
      { key: "RATE", label: "POLICY RATE", unit: "%", id: "IRSTCI01JPM156N", mode: "avg" },
    ],
  },
  {
    slug: "canada", label: "CANADA", sep: false, hist: [
      { key: "GDP", label: "REAL GDP YOY", unit: "%", id: "NGDPRSAXDCCAQ", mode: "yoy" },
      { key: "CPI", label: "CPI YOY", unit: "%", id: "FPCPITOTLZGCAN", mode: "avg" },
      { key: "UNE", label: "UNEMPLOYMENT", unit: "%", id: "LRHUTTTTCAM156S", mode: "avg" },
      { key: "RATE", label: "POLICY RATE", unit: "%", id: "IRSTCI01CAM156N", mode: "avg" },
    ],
  },
  {
    slug: "australia", label: "AUSTRALIA", sep: false, hist: [
      { key: "GDP", label: "REAL GDP YOY", unit: "%", id: "NGDPRSAXDCAUQ", mode: "yoy" },
      { key: "CPI", label: "CPI YOY", unit: "%", id: "FPCPITOTLZGAUS", mode: "avg" },
      { key: "UNE", label: "UNEMPLOYMENT", unit: "%", id: "LRHUTTTTAUM156S", mode: "avg" },
      { key: "RATE", label: "POLICY RATE", unit: "%", id: "IRSTCI01AUM156N", mode: "avg" },
    ],
  },
  {
    slug: "india", label: "INDIA", sep: false, hist: [
      // No GDP / unemployment series on FRED — inflation + call rate only.
      { key: "CPI", label: "CPI YOY", unit: "%", id: "FPCPITOTLZGIND", mode: "avg" },
      { key: "RATE", label: "CALL MONEY RATE", unit: "%", id: "IRSTCI01INM156N", mode: "avg" },
    ],
  },
];

interface Obs { date: string; v: number }

async function fetchCSV(id: string): Promise<Obs[]> {
  const r = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    next: { revalidate: 43200 },
  });
  if (!r.ok) throw new Error(`fred ${id} ${r.status}`);
  const text = await r.text();
  const obs: Obs[] = [];
  for (const line of text.split("\n").slice(1)) {
    const [d, v] = line.trim().split(",");
    if (!d || v === undefined) continue;
    const n = Number(v);
    if (d.length >= 8 && isFinite(n)) obs.push({ date: d.slice(0, 10), v: n });
  }
  return obs;
}

export async function GET(req: NextRequest) {
  const key = fredKey(req.nextUrl.searchParams.get("fkey"));
  const slug = (req.nextUrl.searchParams.get("country") || "us").trim().toLowerCase();
  const country = COUNTRIES.find((c) => c.slug === slug) ?? COUNTRIES[0];
  const HIST = country.hist;
  const FROM = 2015;
  try {
    const hists = await Promise.all(
      HIST.map(async (h) => {
        try {
          const obs = await fetchCSV(h.id);
          const byYear = new Map<number, number[]>();
          for (const o of obs) {
            const y = Number(o.date.slice(0, 4));
            if (y < FROM - 1) continue;
            if (!byYear.has(y)) byYear.set(y, []);
            byYear.get(y)!.push(o.v);
          }
          const avg = (y: number): number | null => {
            const a = byYear.get(y);
            return a?.length ? a.reduce((x, z) => x + z, 0) / a.length : null;
          };
          const hist: Record<string, number> = {};
          for (let y = FROM; y <= 2030; y++) {
            const a = avg(y);
            if (a === null) continue;
            if (h.mode === "avg") hist[y] = Math.round(a * 100) / 100;
            else if (h.mode === "avgK") hist[y] = Math.round(a);
            else {
              const p = avg(y - 1);
              if (p) hist[y] = Math.round(((a - p) / Math.abs(p)) * 10000) / 100;
            }
          }
          return { key: h.key, hist };
        } catch {
          return { key: h.key, hist: {} as Record<string, number> };
        }
      })
    );

    // SEP medians: observations dated by TARGET year (Jan 1), revised each
    // meeting — keep latest value per target year. US only.
    const fwd: Record<string, Record<string, number>> = {};
    let fwdNote = "";
    if (!country.sep) {
      fwdNote = "HISTORY ONLY — SEP IS US-ONLY";
    } else if (key) {
      await Promise.all(
        SEP.map(async (s) => {
          try {
            const obs = await fredObservations(s.id, key, 40);
            const perYear = new Map<number, number>();
            for (const o of obs) {
              const y = Number(o.date.slice(0, 4));
              if (y >= 2000 && y <= 2100 && !perYear.has(y)) perYear.set(y, o.value);
            }
            // desc obs → first hit per year = latest vintage. Re-sort asc.
            fwd[s.key] = {};
            [...perYear.entries()].sort((a, b) => a[0] - b[0]).forEach(([y, v]) => {
              fwd[s.key][y] = Math.round(v * 100) / 100;
            });
          } catch { /* series skipped */ }
        })
      );
      fwdNote = "FWD = FOMC SEP MEDIAN (LATEST VINTAGE)";
    } else {
      fwdNote = "FWD NEEDS FRED KEY — HISTORY ONLY";
    }

    const histYears = Array.from(new Set(hists.flatMap((h) => Object.keys(h.hist).map(Number)))).sort((a, b) => a - b);
    const lastHist = histYears.length ? histYears[histYears.length - 1] : FROM;
    const fwdYears = Array.from(new Set(Object.values(fwd).flatMap((m) => Object.keys(m).map(Number)))).filter((y) => y > lastHist).sort((a, b) => a - b);
    const rows = HIST.map((h) => ({
      label: h.label, unit: h.unit,
      hist: hists.find((x) => x.key === h.key)?.hist ?? {},
      fwd: fwd[h.key] ?? {},
    }));
    const foot = country.sep
      ? "HIST = ANNUAL AVG OF FRED OBS (YOY WHERE MARKED). F = FOMC SEP MEDIAN, LATEST VINTAGE — NOT A CONSENSUS SURVEY."
      : "HIST = ANNUAL AVG OF FRED OBS (YOY WHERE MARKED). NO FWD — FOMC SEP IS US-ONLY.";
    return NextResponse.json({
      country: country.slug, countryLabel: country.label,
      countries: COUNTRIES.map((c) => ({ slug: c.slug, label: c.label })),
      from: FROM, histYears, fwdYears, lastHist, rows, fwdNote, foot, keyed: !!key,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "forecasts failed", rows: [] }, { status: 502 });
  }
}
