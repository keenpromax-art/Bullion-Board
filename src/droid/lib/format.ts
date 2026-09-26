// Bullion Droid — formatting helpers. Everything is NaN-safe and returns "—".

import { fmtCr, fmtINR, fmtMcap, fmtMoney, fmtNum, stripYahooSuffix, tickerCurrency } from "@/lib/utils";

export const DASH = "—";

export function num(v: number | null | undefined, dec = 2): string {
  return fmtNum(v, dec);
}

export function inr(v: number | null | undefined, dec = 2): string {
  return fmtINR(v, dec);
}

export function pct(v: number | null | undefined, dec = 2, signed = false): string {
  if (v === null || v === undefined || !isFinite(v)) return DASH;
  const s = `${v.toFixed(dec)}%`;
  return signed && v > 0 ? `+${s}` : s;
}

export function money(v: number | null | undefined, cur?: string, dec = 2): string {
  return fmtMoney(v, cur ?? tickerCurrency("X"), dec);
}

export function moneyFor(sym: string, v: number | null | undefined, dec = 2): string {
  return fmtMoney(v, tickerCurrency(sym), dec);
}

export function mcap(v: number | null | undefined, cur = "INR"): string {
  return fmtMcap(v, cur);
}

export function cr(v: number | null | undefined): string {
  return fmtCr(v);
}

/** Directional class for a signed number (green/red strictly directional). */
export function dir(v: number | null | undefined): string {
  if (v === null || v === undefined || !isFinite(v) || v === 0) return "dx-faint";
  return v > 0 ? "dx-up" : "dx-down";
}

/** ▲ / ▼ glyph + signed percent, "—" when unknown. */
export function chg(v: number | null | undefined, dec = 2): string {
  if (v === null || v === undefined || !isFinite(v)) return DASH;
  const s = Math.abs(v).toFixed(dec);
  if (v === 0) return `0.${"0".repeat(dec)}%`;
  return `${v > 0 ? "▲" : "▼"} ${s}%`;
}

export function signed(v: number | null | undefined, dec = 2): string {
  if (v === null || v === undefined || !isFinite(v)) return DASH;
  return `${v > 0 ? "+" : ""}${v.toFixed(dec)}`;
}

export function baseSym(sym: string): string {
  return stripYahooSuffix(sym) || sym;
}

export function istClock(d = new Date()): string {
  return d.toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" });
}

export function istStamp(d = new Date()): string {
  return d.toLocaleString("en-IN", {
    hour12: false,
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function istDate(d = new Date()): string {
  return d.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function partOfDay(d = new Date()): string {
  const h = Number(
    d.toLocaleString("en-IN", { hour: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })
  );
  if (h < 5) return "LATE NIGHT";
  if (h < 12) return "MORNING";
  if (h < 16) return "AFTERNOON";
  if (h < 20) return "EVENING";
  return "NIGHT";
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}S AGO`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}M AGO`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}H AGO`;
  return `${Math.round(h / 24)}D AGO`;
}
