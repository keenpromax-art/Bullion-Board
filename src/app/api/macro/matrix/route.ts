import { NextRequest, NextResponse } from "next/server";

// Global Economic Matrix (ECMX): one row per country, one Value+Date pair
// per indicator, evaluated AS OF a selected date. Keyless FRED CSVs —
// YoY is computed from levels (except US GDP, which FRED publishes as YoY).

interface Cfg {
  c: string;
  gdp: { id: string; yoy?: boolean } | null;
  cpi: string | null; cpiPct?: boolean; une: string | null; rate: string | null;
}

const COUNTRIES: Cfg[] = [
  // CPI uses live OECD MEI indices (the older 659N vintages are discontinued
  // on FRED and print garbage). UK rate = overnight call proxy — no live
  // BoE policy series exists on FRED.
  { c: "United States", gdp: { id: "A191RL1Q225SBEA", yoy: true }, cpi: "CPIAUCSL", une: "UNRATE", rate: "FEDFUNDS" },
  { c: "Germany", gdp: { id: "CLVMNACSCAB1GQDE" }, cpi: "CP0000DEM086NEST", une: "LRHUTTTTDEM156S", rate: "ECBDFR" },
  { c: "France", gdp: { id: "CLVMNACSCAB1GQFR" }, cpi: "CP0000FRM086NEST", une: "LRHUTTTTFRM156S", rate: "ECBDFR" },
  { c: "Italy", gdp: { id: "CLVMNACSCAB1GQIT" }, cpi: "CP0000ITM086NEST", une: "LRHUTTTTITM156S", rate: "ECBDFR" },
  { c: "United Kingdom", gdp: { id: "NGDPRSAXDCGBQ" }, cpi: null, une: "LRHUTTTTGBM156S", rate: "IRSTCI01GBM156N" },
  { c: "Japan", gdp: { id: "JPNRGDPEXP" }, cpi: "FPCPITOTLZGJPN", cpiPct: true, une: "LRHUTTTTJPM156S", rate: "IRSTCI01JPM156N" },
  { c: "Canada", gdp: { id: "NGDPRSAXDCCAQ" }, cpi: "FPCPITOTLZGCAN", cpiPct: true, une: "LRHUTTTTCAM156S", rate: "IRSTCI01CAM156N" },
  { c: "Australia", gdp: { id: "NGDPRSAXDCAUQ" }, cpi: "FPCPITOTLZGAUS", cpiPct: true, une: "LRHUTTTTAUM156S", rate: "IRSTCI01AUM156N" },
  { c: "India", gdp: null, cpi: "FPCPITOTLZGIND", cpiPct: true, une: null, rate: "IRSTCI01INM156N" },
];

interface Obs { date: string; v: number }

async function fetchObs(id: string): Promise<Obs[]> {
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

const minusMonths = (dateStr: string, m: number): string => {
  const d = new Date(dateStr + "T12:00:00");
  d.setMonth(d.getMonth() - m);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("asof") || "").trim();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const asof = /^\d{4}-\d{2}-\d{2}$/.test(q) && q <= today ? q : today;

  // Dedupe shared series (ECBDFR × 3) within the request.
  const cache = new Map<string, Promise<Obs[]>>();
  const get = (id: string): Promise<Obs[]> => {
    let p = cache.get(id);
    if (!p) { p = fetchObs(id).catch(() => [] as Obs[]); cache.set(id, p); }
    return p;
  };

  const rows = await Promise.all(
    COUNTRIES.map(async (c) => {
      const cell = async (
        id: string | null, mode: "level" | "yoy12" | "yoyQ" | "pct",
      ): Promise<{ v: number | null; d: string | null }> => {
        if (!id) return { v: null, d: null };
        const obs = await get(id);
        // Latest observation on/before as-of.
        let i = obs.length - 1;
        while (i >= 0 && obs[i].date > asof) i--;
        if (i < 0) return { v: null, d: null };
        if (mode === "level" || mode === "pct") return { v: Math.round(obs[i].v * 100) / 100, d: obs[i].date };
        // YoY, frequency-agnostic: observation ~12 months earlier (4Q for
        // quarterly GDP, 12M for monthly CPI, 4Q for quarterly AU CPI).
        const cut = minusMonths(obs[i].date, 12);
        let j = i;
        while (j >= 0 && obs[j].date > cut) j--;
        if (j < 0 || !obs[j].v) return { v: null, d: obs[i].date };
        return { v: Math.round(((obs[i].v - obs[j].v) / Math.abs(obs[j].v)) * 10000) / 100, d: obs[i].date };
      };
      const [gdp, cpi, une, rate] = await Promise.all([
        c.gdp ? (c.gdp.yoy
          ? cell(c.gdp.id, "level").then((r) => r)
          : cell(c.gdp.id, "yoyQ")) : Promise.resolve({ v: null, d: null }),
        cell(c.cpi, c.cpiPct ? "pct" : "yoy12"),
        cell(c.une, "level"),
        cell(c.rate, "level"),
      ]);
      return { c: c.c, gdp, cpi, une, rate };
    })
  );
  return NextResponse.json({ asof, count: rows.length, rows });
}
