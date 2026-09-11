import { NextRequest, NextResponse } from "next/server";
import { fredKey, fredObservations } from "@/lib/fred";

// Economic Forecasts (ECFC): annual history from keyless FRED CSVs +
// forward medians from FOMC SEP (needs FRED key). Clicking a table row
// graphs that indicator (client side).

interface HistDef { key: string; label: string; unit: string; id: string; mode: "yoy" | "avg" | "avgK" }

const HIST: HistDef[] = [
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
    // meeting — keep latest value per target year.
    const fwd: Record<string, Record<string, number>> = {};
    let fwdNote = "";
    if (key) {
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
    return NextResponse.json({ from: FROM, histYears, fwdYears, lastHist, rows, fwdNote, keyed: !!key });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "forecasts failed", rows: [] }, { status: 502 });
  }
}
