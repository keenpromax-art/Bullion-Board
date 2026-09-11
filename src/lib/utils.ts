// Small utilities — ports of safe_div, formatters, seeded RNG from special.py

export function safeDiv(a: number, b: number, fallback = 0): number {
  if (!isFinite(a) || !isFinite(b) || b === 0) return fallback;
  return a / b;
}

export function fmtINR(v: number | null | undefined, dec = 2): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return `₹${v.toLocaleString("en-IN", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

export function fmtNum(v: number | null | undefined, dec = 2): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return v.toLocaleString("en-IN", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function fmtPct(v: number | null | undefined, mult = false, dec = 2): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  const x = mult ? v * 100 : v;
  return `${x.toFixed(dec)}%`;
}

export function fmtCr(v: number | null | undefined): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return fmtINR(v);
}

export function normalizeTicker(raw: string, fallback = "RELIANCE.NS"): string {
  // Exact port of normalize_cli_ticker()
  let t = (raw || fallback || "RELIANCE.NS").trim().toUpperCase();
  if (!t) return "RELIANCE.NS";
  if (t.startsWith("^") || t.includes(".") || t.includes("=")) return t;
  // Yahoo crypto pairs (BTC-USD) pass through; hyphenated NSE names
  // (BAJAJ-AUTO) still get .NS — hence the anchored $-USD test.
  if (/-USD$/.test(t)) return t;
  return `${t}.NS`;
}

export function truncate(s: string, maxLen = 50): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + "…";
}

export function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${dd}-${months[d.getMonth()]}-${d.getFullYear()} ${hh}:${mm}`;
  } catch {
    return iso;
  }
}

// Deterministic PRNG (mulberry32) — replaces np.random.seed(42) usage so
// Monte-Carlo DCF is reproducible like the Python version.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller normal sampler using a uniform RNG
export function randnFactory(uniform: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) { const v = spare; spare = null; return v; }
    let u = 0, v = 0;
    while (u === 0) u = uniform();
    while (v === 0) v = uniform();
    const mag = Math.sqrt(-2.0 * Math.log(u));
    spare = mag * Math.sin(2.0 * Math.PI * v);
    return mag * Math.cos(2.0 * Math.PI * v);
  };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
