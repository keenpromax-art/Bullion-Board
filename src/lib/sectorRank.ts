"use client";

// Sector rotation ranker engine — live NSE sector indices vs Nifty 50:
// multi-timeframe ROC excess, RS ratio + momentum, 200D trend filter,
// composite score + rank. Pure compute; UI lives in AskDesks.

export interface SectorLeg {
  key: string;
  label: string;
  sym: string;
}

export const SECTOR_LEGS: SectorLeg[] = [
  { key: "BANK", label: "BANK", sym: "^NSEBANK" },
  { key: "IT", label: "IT", sym: "^CNXIT" },
  { key: "AUTO", label: "AUTO", sym: "^CNXAUTO" },
  { key: "PHARMA", label: "PHARMA", sym: "^CNXPHARMA" },
  { key: "FMCG", label: "FMCG", sym: "^CNXFMCG" },
  { key: "METAL", label: "METAL", sym: "^CNXMETAL" },
  { key: "ENERGY", label: "ENERGY", sym: "^CNXENERGY" },
  { key: "REALTY", label: "REALTY", sym: "^CNXREALTY" },
];

export const NIFTY_LEG: SectorLeg = { key: "NIFTY", label: "NIFTY 50", sym: "^NSEI" };

export interface RankRow {
  key: string;
  label: string;
  roc21: number | null;
  roc63: number | null;
  roc126: number | null;
  roc252: number | null;
  exc21: number | null;
  exc63: number | null;
  exc252: number | null;
  rsRatio: number | null; // 63D sector/nifty rebased ×100
  rsMom: number | null; // 21D slope of RS ratio, pp
  above200: boolean | null;
  score: number | null;
  rank: number;
  curve: number[]; // RS ratio curve (rebased), downsampled ≤40
}

export interface RankResult {
  asof: string;
  nifty: { roc21: number | null; roc63: number | null; roc252: number | null };
  rows: RankRow[];
  failed: string[];
}

const roc = (c: number[], days: number): number | null => {
  if (c.length <= days) return null;
  const a = c[c.length - 1 - days], b = c[c.length - 1];
  if (!(a > 0) || !(b > 0)) return null;
  return ((b - a) / a) * 100;
};

const sma = (c: number[], w: number): number | null => {
  if (c.length < w) return null;
  const s = c.slice(-w);
  return s.reduce((a, b) => a + b, 0) / s.length;
};

async function closes(sym: string): Promise<number[]> {
  const r = await fetch(`/api/history?symbol=${encodeURIComponent(sym)}&range=1y&interval=1d`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `history ${r.status}`);
  const c: number[] = ((j.bars ?? []) as any[])
    .map((b) => b.close)
    .filter((v: any) => typeof v === "number" && isFinite(v) && v > 0);
  if (c.length < 230) throw new Error(`SHORT ${sym}`);
  return c;
}

export async function runSectorRank(onStep?: (msg: string) => void): Promise<RankResult> {
  const legs = [NIFTY_LEG, ...SECTOR_LEGS];
  const failed: string[] = [];
  const data = new Map<string, number[]>();
  let done = 0;
  await Promise.all(legs.map(async (leg) => {
    try {
      data.set(leg.key, await closes(leg.sym));
    } catch {
      failed.push(leg.label);
    }
    done++;
    onStep?.(`SCANNING SECTOR FEEDS… ${done}/${legs.length}`);
  }));
  const nifty = data.get("NIFTY");
  if (!nifty) throw new Error("NIFTY FEED FAILED — CANNOT BENCHMARK");
  const nRoc = { roc21: roc(nifty, 21), roc63: roc(nifty, 63), roc252: roc(nifty, 252) };
  const rows: RankRow[] = [];
  for (const leg of SECTOR_LEGS) {
    const c = data.get(leg.key);
    if (!c) continue;
    const n = Math.min(c.length, nifty.length);
    const s = c.slice(-n), b = nifty.slice(-n);
    const r21 = roc(s, 21), r63 = roc(s, 63), r126 = roc(s, 126), r252 = roc(s, 252);
    // RS ratio curve: sector/nifty rebased to 100 at window start (63D).
    const W = Math.min(63, n - 1);
    const s0 = s[s.length - 1 - W], b0 = b[b.length - 1 - W];
    const curve = s.slice(-W - 1).map((v, i) => ((v / s0) / (b[b.length - 1 - W + i] / b0)) * 100);
    const rsRatio = curve[curve.length - 1] ?? null;
    const rsMom = curve.length > 21 ? curve[curve.length - 1] - curve[curve.length - 22] : null;
    const ma200 = sma(s, 200);
    const above200 = ma200 !== null ? s[s.length - 1] > ma200 : null;
    const e21 = r21 !== null && nRoc.roc21 !== null ? r21 - nRoc.roc21 : null;
    const e63 = r63 !== null && nRoc.roc63 !== null ? r63 - nRoc.roc63 : null;
    const e252 = r252 !== null && nRoc.roc252 !== null ? r252 - nRoc.roc252 : null;
    const score = e21 !== null && e63 !== null && e252 !== null
      ? e21 * 0.2 + e63 * 0.3 + e252 * 0.4 + (above200 === null ? 0 : above200 ? 2 : -2)
      : null;
    const step = Math.max(1, Math.floor(curve.length / 40));
    const slim = curve.filter((_, i) => i % step === 0);
    rows.push({
      key: leg.key, label: leg.label,
      roc21: r21, roc63: r63, roc126: r126, roc252: r252,
      exc21: e21, exc63: e63, exc252: e252,
      rsRatio, rsMom, above200, score, rank: 0, curve: slim,
    });
  }
  if (!rows.length) throw new Error("ALL SECTOR FEEDS FAILED");
  rows.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return {
    asof: new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase(),
    nifty: nRoc, rows, failed,
  };
}

export function rankerDigest(res: RankResult): string {
  const lines = res.rows.map((r) =>
    `#${r.rank} ${r.label}: SCORE ${r.score === null ? "?" : r.score.toFixed(1)} ` +
    `RS ${r.rsRatio === null ? "?" : r.rsRatio.toFixed(1)} MOM ${r.rsMom === null ? "?" : `${r.rsMom >= 0 ? "+" : ""}${r.rsMom.toFixed(1)}`} ` +
    `ROC21/63/252 ${r.roc21 === null ? "?" : r.roc21.toFixed(1)}/${r.roc63 === null ? "?" : r.roc63.toFixed(1)}/${r.roc252 === null ? "?" : r.roc252.toFixed(1)} ` +
    `EXC63 ${r.exc63 === null ? "?" : `${r.exc63 >= 0 ? "+" : ""}${r.exc63.toFixed(1)}`} ` +
    `>200D ${r.above200 === null ? "?" : r.above200 ? "YES" : "NO"}`
  );
  return `SECTOR ROTATION RANKER — NIFTY ROC21/63/252 ` +
    `${res.nifty.roc21 === null ? "?" : res.nifty.roc21.toFixed(1)}/${res.nifty.roc63 === null ? "?" : res.nifty.roc63.toFixed(1)}/${res.nifty.roc252 === null ? "?" : res.nifty.roc252.toFixed(1)} ` +
    `AS OF ${res.asof}${res.failed.length ? ` · FEEDS DOWN: ${res.failed.join(", ")}` : ""}\n` + lines.join("\n");
}
