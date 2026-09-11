// Opening-desk math — TypeScript port of market_data.py scoring +
// capture_score.py slot logic + backfill_history.py evaluation.
// Pure functions only (no fetch); feeds live in /api/opening*.

export const VIX_THRESHOLD = 15.0;

export const OPENING_UNIVERSE = [
  "RELIANCE.NS", "HDFCBANK.NS", "BHARTIARTL.NS", "ICICIBANK.NS", "INFY.NS", "TCS.NS",
  "SBIN.NS", "ITC.NS", "HINDUNILVR.NS", "LT.NS", "BAJFINANCE.NS", "HCLTECH.NS",
  "MARUTI.NS", "SUNPHARMA.NS", "NTPC.NS", "ONGC.NS", "KOTAKBANK.NS", "M&M.NS",
  "AXISBANK.NS", "TATAMOTORS.NS", "TITAN.NS", "ULTRACEMCO.NS", "POWERGRID.NS",
  "ADANIENT.NS", "ADANIPORTS.NS", "TATASTEEL.NS", "JSWSTEEL.NS", "COALINDIA.NS",
  "GRASIM.NS", "TECHM.NS", "WIPRO.NS", "NESTLEIND.NS", "BRITANNIA.NS", "EICHERMOT.NS",
  "HEROMOTOCO.NS", "BAJAJ-AUTO.NS", "DRREDDY.NS", "CIPLA.NS", "APOLLOHOSP.NS",
  "DIVISLAB.NS", "BAJAJFINSV.NS", "SBILIFE.NS", "HDFCLIFE.NS", "INDUSINDBK.NS",
  "SHRIRAMFIN.NS", "TATACONSUM.NS", "TRENT.NS", "BEL.NS", "BPCL.NS", "HINDALCO.NS",
];

export const CAPTURE_SLOTS = [
  "09:00", "09:30", "10:30", "11:30", "12:30",
  "13:30", "14:30", "15:30", "16:00", "21:00",
];

export type Verdict = "GREEN" | "RED" | "FLAT" | "NO_DATA";

export interface Signal {
  name: string;
  value: number | null;
  vote: 1 | -1 | 0 | null;
}

export function istNow(): Date {
  return new Date(Date.now() + (330 + new Date().getTimezoneOffset()) * 60000);
}

export function istHHMM(d: Date = istNow()): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function istStamp(d: Date = istNow()): string {
  const days = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${days[d.getDay()]}, ${String(d.getDate()).padStart(2, "0")} ${months[d.getMonth()]} ${d.getFullYear()} — ${istHHMM(d)} IST`;
}

export function nearestSlot(hhmm: string = istHHMM()): string {
  const [h, m] = hhmm.split(":").map(Number);
  const target = h * 60 + m;
  let best = CAPTURE_SLOTS[0], bestDiff = Infinity;
  for (const s of CAPTURE_SLOTS) {
    const [sh, sm] = s.split(":").map(Number);
    const diff = Math.abs(sh * 60 + sm - target);
    if (diff < bestDiff) { bestDiff = diff; best = s; }
  }
  return best;
}

export function slotSortKey(slot: string): number {
  const [h, m] = String(slot).split(":").map(Number);
  if (!isFinite(h) || !isFinite(m)) return 9999;
  return h * 60 + m;
}

// Exact port of _score_from_signals: +1 per non-negative, −1 per negative.
export function scoreFromSignals(signals: Array<1 | -1 | 0>): { score: number | null; n: number; verdict: Verdict } {
  if (!signals.length) return { score: null, n: 0, verdict: "NO_DATA" };
  const score = signals.reduce((a: number, b: 1 | -1 | 0) => a + b, 0);
  return { score, n: signals.length, verdict: score > 0 ? "GREEN" : score < 0 ? "RED" : "FLAT" };
}

export function buildSignals(args: {
  nasdaqChg: number | null;
  dowChg: number | null;
  advances: number; declines: number; breadthTotal: number;
  globalChg: number | null;
}): { signals: Signal[]; score: number | null; n: number; verdict: Verdict } {
  const signals: Signal[] = [];
  const push = (name: string, v: number | null) =>
    signals.push({ name, value: v, vote: v === null || !isFinite(v) ? null : v >= 0 ? 1 : -1 });
  push("NASDAQ", args.nasdaqChg);
  push("DOW", args.dowChg);
  if (args.breadthTotal > 0) {
    const v = args.advances > args.declines ? 1 : args.declines > args.advances ? -1 : 0;
    signals.push({ name: "BREADTH A/D", value: args.advances - args.declines, vote: v });
  }
  push("GLOBAL CUE", args.globalChg);
  const votes = signals.map((s) => s.vote).filter((v): v is 1 | -1 | 0 => v !== null);
  const { score, n, verdict } = scoreFromSignals(votes);
  return { signals, score, n, verdict };
}

// Exact port of the Streamlit evaluate_prediction().
export function evaluatePrediction(verdict: string, dayChg: number | null): string {
  if (dayChg === null || !isFinite(dayChg) || verdict === "NO_DATA") return "No Nifty Data";
  if (verdict === "GREEN" && dayChg > 0) return "✅ Bullish Hit";
  if (verdict === "RED" && dayChg < 0) return "✅ Bearish Hit";
  if (verdict === "FLAT" && Math.abs(dayChg) < 0.25) return "✅ Neutral Hit";
  if (verdict === "GREEN" && dayChg <= 0) return "❌ Bullish Miss";
  if (verdict === "RED" && dayChg >= 0) return "❌ Bearish Miss";
  return "⚪ Flat/Mixed";
}

export function vixCondition(vix: number | null): "VOLATILE" | "STABLE" | null {
  if (vix === null || !isFinite(vix)) return null;
  return vix > VIX_THRESHOLD ? "VOLATILE" : "STABLE";
}
