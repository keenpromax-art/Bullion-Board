import { NextRequest, NextResponse } from "next/server";
import { fetchHistory } from "@/lib/yahoo";

const DEFAULTS = ["RELIANCE.NS","HDFCBANK.NS","ICICIBANK.NS","INFY.NS","TCS.NS","SBIN.NS","ITC.NS","LT.NS","TATAMOTORS.NS","SUNPHARMA.NS"];

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 20) return NaN;
  const x = a.slice(-n), y = b.slice(-n);
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : NaN;
}

// Correlation matrix of log returns (1Y daily).
export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("syms") || "").trim();
  const syms = (raw ? raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : DEFAULTS).slice(0, 12);
  try {
    const series = await Promise.all(
      syms.map(async (s) => {
        try {
          const bars = await fetchHistory(s, "1y", "1d");
          const c = bars.map((b) => b.close);
          const lr: number[] = [];
          for (let i = 1; i < c.length; i++) lr.push(c[i] > 0 && c[i - 1] > 0 ? Math.log(c[i] / c[i - 1]) : 0);
          return { s, lr };
        } catch {
          return { s, lr: [] as number[] };
        }
      })
    );
    const ok = series.filter((x) => x.lr.length >= 60);
    const labels = ok.map((x) => x.s);
    const matrix = ok.map((a) =>
      ok.map((b) => {
        const v = pearson(a.lr, b.lr);
        return isFinite(v) ? Math.round(v * 100) / 100 : null;
      })
    );
    return NextResponse.json({ labels, matrix, n: ok.length ? Math.min(...ok.map((x) => x.lr.length)) : 0 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "corr failed" }, { status: 502 });
  }
}
