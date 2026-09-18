// Per-desk task menus — powers the terminal-style gateway directory.
// Selecting a function row expands its task list; picking a task deep-links to
// /module/[id]?symbol=XXX&task=YYY (or the terminal-native route equivalent).
// Curated tasks mirror what each desk actually renders; anything not curated
// falls back to splitting the module description into actionable items.

import type { ModuleInfo } from "./types";

export interface FunctionTask {
  key: string;
  label: string;
  hint: string;
}

function t(key: string, label: string, hint: string): FunctionTask {
  return { key, label, hint };
}

// Curated menus for the desks shown in the reference screenshot (1-17) plus
// the desks with bespoke tab structures worth naming explicitly.
const CURATED: Record<string, FunctionTask[]> = {
  "1": [
    t("rsi", "RSI", "Wilder RSI 14 + zones"),
    t("macd", "MACD", "12/26/9 line + signal"),
    t("adx", "ADX", "Trend strength + DI"),
    t("stoch", "STOCHASTIC", "14/3 %K %D"),
    t("bb", "BOLLINGER", "20/2 %B + width"),
    t("atr", "ATR", "True-range stop size"),
    t("mfi", "MFI", "Money-flow 14"),
    t("willr", "WILLIAMS %R", "Overbought / sold"),
    t("confluence", "CONFLUENCE", "Multi-indicator vote"),
    t("divergence", "DIVERGENCES", "Price vs oscillator"),
    t("mtf", "MULTI-TIMEFRAME", "Daily vs weekly read"),
  ],
  "2": [
    t("price", "PRICE + BB", "Closes + Bollinger 20/2"),
    t("rsi", "RSI PANEL", "Pinned RSI 14"),
    t("macd", "MACD PANEL", "Line / signal / hist"),
    t("volume", "VOLUME", "Shares + OBV"),
    t("stoch", "STOCHASTIC", "Extra-panel study"),
    t("atr", "ATR", "Volatility stop"),
    t("adx", "ADX + DI", "Trend filter"),
    t("cci", "CCI", "Commodity channel 20"),
    t("pivots", "PIVOTS", "Floor levels"),
    t("library", "CHART LIBRARY", "14 switchable studies"),
  ],
  "3": [
    t("trailing", "TRAILING RETURNS", "1D → 10Y + CAGR"),
    t("drawdowns", "DRAWDOWNS", "Top-5 episodes"),
    t("hurst", "HURST", "Mean-reversion test"),
    t("tail", "TAIL INDEX", "Return distribution"),
    t("ewma", "EWMA VOL", "Decaying volatility"),
    t("fan", "MONTE-CARLO FAN", "Forward paths"),
    t("ai", "AI ANALYST", "Regime verdict"),
  ],
  "4": [
    t("overlay", "OVERLAY", "Oscillators on 0-100"),
    t("zscore", "Z-SCORE", "Distance from mean"),
    t("correlation", "ROLLING CORR", "Indicator agreement"),
    t("divergence", "DIVERGENCE EXPLORER", "Bull / bear splits"),
  ],
  "5": [
    t("score", "MASTER SCORE", "7-vote 0-100 gauge"),
    t("regime", "REGIME FILTER", "Trend vs chop gate"),
    t("pivots", "PIVOT MAP", "Support / resistance"),
    t("backtest", "FORWARD BACKTEST", "Signal forward return"),
    t("ai", "AI CHAT + TOOLS", "Ask the scorecard"),
  ],
  "6": [
    t("calibrate", "CALIBRATE", "GBM vs jump λ/μ/σ"),
    t("paths", "PATH SIMULATION", "500 × horizon fan"),
    t("risk", "RISK REPORT", "P1/P5/P50/ES tail"),
    t("sensitivity", "SENSITIVITY", "λ half / double"),
    t("stress", "STRESS", "Crash-quantile read"),
  ],
  "7": [
    t("features", "FEATURES", "RSI/MACD/ADX/BB lags"),
    t("ensemble", "ENSEMBLE", "GBDT ×5 + stacker"),
    t("attribution", "ATTRIBUTION", "SHAP-style drivers"),
    t("signal", "SIGNAL PANEL", "Bull / bear / flat"),
    t("critic", "AI CRITIC", "Overfit + guardrail"),
  ],
  "8": [
    t("footprint", "FOOTPRINT", "5-min signed prints"),
    t("vwap", "VWAP BANDS", "Session + ±1σ"),
    t("profile", "VOLUME PROFILE", "POC + value area"),
    t("tape", "SESSION TAPE", "Time + sales log"),
    t("signals", "INTRADAY SIGNALS", "IB + VWAP bias"),
  ],
  "9": [
    t("ensemble", "ENSEMBLE FORECAST", "Mean of forecasters"),
    t("garch", "GARCH CAL", "Vol clustering fit"),
    t("targets", "MONTE-CARLO TARGETS", "P10-P90 bands"),
    t("table", "FORECAST TABLE", "Horizon × path"),
    t("ai", "AI ANALYST", "Forecast narrative"),
  ],
  "10": [
    t("arima", "ARIMA LEG", "Classical baseline"),
    t("lstm", "LSTM LEG", "Deep sequence net"),
    t("meta", "META MIXER", "Blended forecaster"),
    t("backtest", "BACKTEST WINDOWS", "Walk-forward error"),
  ],
  "11": [
    t("overview", "OVERVIEW", "Company snapshot"),
    t("ledger", "LEDGER", "P&L / BS / CF tables"),
    t("valuation", "VALUATION", "DCF + LBO doors"),
    t("quality", "QUALITY", "Piotroski / Altman / Beneish"),
    t("peers", "PEERS", "Sector + compare"),
    t("ai", "RESEARCH AI", "Ask the filings"),
  ],
  "12": [
    t("pl", "INCOME TABLE", "Revenue → net + YoY"),
    t("bs", "BALANCE TABLE", "Assets / debt / equity"),
    t("cf", "CASH-FLOW TABLE", "OCF / FCF / capex"),
    t("yoy", "YOY + CAGR", "Growth columns"),
    t("ai", "STATEMENT AI CHAT", "Ask the ledger"),
    t("excel", "EXCEL EXPORT", "CSV download"),
  ],
  "13": [
    t("pl", "P&L CHARTS", "Revenue / margins"),
    t("bs", "BALANCE CHARTS", "Assets / leverage"),
    t("cf", "CASH-FLOW CHARTS", "OCF vs net"),
    t("growth", "GROWTH GUIDES", "YoY overlays"),
    t("compare", "YEAR COMPARE", "FY vs FY face-off"),
  ],
  "14": [
    t("5factor", "5-FACTOR ROE", "Tax × int × margin × AT × EM"),
    t("trend", "TREND", "ROE / ROA / ROCE path"),
    t("quality", "QUALITY SCORES", "Piotroski / Altman"),
    t("ai", "AI ANALYST", "Driver narrative"),
  ],
  "15": [
    t("beneish", "BENEISH M", "Manipulation score"),
    t("accruals", "ACCRUALS", "(NI − CFO) / assets"),
    t("ccc", "CASH CONVERSION", "DSO + DIO − DPO"),
    t("flags", "EARNINGS FLAGS", "Quality-of-earnings"),
  ],
  "16": [
    t("pl", "P&L ANALYSIS", "Margins + growth"),
    t("bs", "BS ANALYSIS", "Leverage + liquidity"),
    t("cf", "CF ANALYSIS", "Cash backing"),
    t("ratios", "RATIOS", "60+ computed set"),
    t("sparklines", "SPARKLINES", "Mini trends"),
  ],
  "17": [
    t("profile", "PROFILE", "Business + address"),
    t("stats", "KEY STATS", "Mkt cap / PE / yield"),
    t("peers", "PEERS", "Sector comps"),
    t("snapshot", "SNAPSHOT BOX", "One-screen brief"),
  ],
  "18": [
    t("wacc", "WACC BUILD", "Cost stack"),
    t("margins", "HIST MARGINS", "Base for projection"),
    t("project", "PROJECTIONS", "FCF forecast"),
    t("grid", "SENSITIVITY GRID", "WACC × terminal-g"),
    t("mc", "MONTE-CARLO", "Value distribution"),
    t("scenarios", "SCENARIOS", "Bull / base / bear"),
    t("excel", "EXCEL EXPORT", "Model download"),
  ],
  "19": [
    t("sources", "SOURCES & USES", "Deal funding"),
    t("tranches", "DEBT TRANCHES", "Stack + pricing"),
    t("project", "PROJECTIONS", "Operating build"),
    t("returns", "IRR / MOIC", "Return math"),
    t("bridge", "VALUE BRIDGE", "Equity creation"),
    t("grid", "SENSITIVITY", "Entry / leverage"),
  ],
  "20": [
    t("ratios", "4Y RATIOS", "Full ratio history"),
    t("growth", "GROWTH", "Sales / profit path"),
    t("dupont", "DUPONT", "ROE decomposition"),
    t("quality", "QUALITY", "Piotroski trend"),
    t("efficiency", "CAPITAL EFFICIENCY", "Turnover + CCC"),
    t("excel", "EXCEL EXPORT", "Sheet download"),
  ],
  "22": [
    t("kelly", "KELLY SIZING", "Optimal fraction"),
    t("ma", "MA-CROSSOVER STATS", "Trade expectancy"),
    t("atr", "ATR SIZING", "Vol-based stake"),
    t("dashboard", "RISK DASHBOARD", "12-point terminal"),
    t("ai", "AI CHAT", "Risk counsel"),
  ],
  "23": [
    t("sortino", "ROLLING SORTINO", "Downside-adjusted"),
    t("beta", "ROLLING BETA", "Vs Nifty term"),
    t("drawdown", "DRAWDOWN TERM", "Underwater path"),
    t("var", "VAR / CVAR", "Tail term-structure"),
    t("regime", "REGIME READ", "Heating / cooling"),
  ],
  "24": [
    t("fit", "GARCH(1,1) FIT", "Alpha + beta"),
    t("forecast", "VOL FORECAST", "Forward curve"),
    t("regime", "REGIME NOTE", "Expand / compress"),
  ],
  "26": [
    t("term", "HV TERM-STRUCTURE", "10D / 30D / 252D"),
    t("moves", "EXPECTED MOVES", "±1SD bands"),
    t("picker", "STRATEGY PICKER", "Regime-matched"),
  ],
  "32": [
    t("greeks", "BLACK-SCHOLES GREEKS", "Δ Γ Θ ν ρ"),
    t("regime", "VOL REGIME", "HV vs implied"),
    t("picker", "DELTA-40 PICKER", "Strike finder"),
    t("spreads", "SPREAD BUILDER", "2-leg payoff"),
  ],
  "33": [
    t("move", "HOW IT MOVES", "Beta/drift/accel"),
    t("capture", "CAPTURE", "Up/down vs Nifty"),
    t("bands", "EXPECTED MOVE", "ATR ±1SD bands"),
  ],
  "35": [
    t("breadth", "BREADTH", "Adv / dec + % >20D"),
    t("rs", "RS RATIO / MOMENTUM", "Sector strength"),
    t("beta", "BETA", "Sensitivity board"),
    t("rotation", "ROTATION HEATMAP", "Leadership map"),
    t("ai", "AI CHAT", "Rotation counsel"),
  ],
  "38": [
    t("fred", "FRED SERIES", "US macro tape"),
    t("countries", "COUNTRY PANELS", "Cross-market"),
    t("alerts", "ALERTS", "Threshold breaks"),
    t("heatmap", "HEATMAP", "Macro surprise"),
    t("correlation", "CORRELATION", "Asset linkage"),
    t("scorecard", "SCORECARD", "Growth / inflation"),
    t("recession", "RECESSION MONITOR", "Probability dial"),
  ],
  "52": [
    t("surface", "VOL SURFACE", "Heston / GARCH grid"),
    t("paths", "PATH SIMULATION", "Stoch-vol fan"),
    t("sensitivity", "SENSITIVITY", "Param shocks"),
    t("3d", "3D SURFACE", "Strike × tenor"),
  ],
  "62": [
    t("fit", "HMM FIT", "Hidden states"),
    t("analytics", "STATE ANALYTICS", "Dwell + transition"),
    t("dashboard", "DASHBOARD", "State tape"),
    t("ai", "AI CHAT", "Regime narrative"),
  ],
  "64": [
    t("links", "GOLDEN LINKS", "IS / BS / CF ties"),
    t("trend", "TREND DASHBOARD", "Linked history"),
    t("ratios", "RATIO DASHBOARD", "Coverage set"),
    t("dupont", "DUPONT", "ROE bridge"),
    t("wc", "WORKING CAPITAL", "Cycle drill"),
    t("qoe", "QUALITY OF EARNINGS", "Cash backing"),
    t("tutor", "THEORY TUTOR", "Learn the links"),
    t("ai", "AI CHAT", "Ask the linker"),
  ],
  "70": [
    t("bias", "BIAS DETECTOR", "Trend + vol read"),
    t("payoff", "12-STRATEGY ENGINE", "Payoff simulator"),
    t("top3", "TOP-3 PICKS", "Ranked setups"),
    t("cards", "STRATEGY CARDS", "Strike / DTE / risk"),
    t("chart", "PAYOFF CHART", "P&L diagram"),
  ],
};

function splitDescription(desc: string): string[] {
  return desc
    .replace(/[–—]/g, ",")
    .split(/[,;·•|]+/)
    .map((s) => s.trim().replace(/\.$/, ""))
    .filter((s) => s.length > 1)
    .slice(0, 8);
}

function titleize(s: string): string {
  return s.replace(/\w\S*/g, (w) => w.toUpperCase());
}

export function getFunctionTasks(mod: ModuleInfo): FunctionTask[] {
  const hit = CURATED[mod.id];
  if (hit) return hit;
  const parts = splitDescription(mod.description);
  const tasks = parts.map((p, i) =>
    t(
      `t${i + 1}`,
      titleize(p).slice(0, 28),
      p.slice(0, 64)
    )
  );
  // Every desk supports at least open + AI + export-style actions where apt.
  tasks.push(t("open", "OPEN DESK", `Full ${mod.label} workspace`));
  return tasks.slice(0, 9);
}

export function taskLink(mod: ModuleInfo, symbol: string, task: FunctionTask): string {
  const base = mod.route !== `/module/${mod.id}` ? mod.route : `/module/${mod.id}`;
  return `${base}?symbol=${encodeURIComponent(symbol)}&task=${encodeURIComponent(task.label)}`;
}

export function deskLink(mod: ModuleInfo, symbol: string): string {
  const base = mod.route !== `/module/${mod.id}` ? mod.route : `/module/${mod.id}`;
  return `${base}?symbol=${encodeURIComponent(symbol)}`;
}
