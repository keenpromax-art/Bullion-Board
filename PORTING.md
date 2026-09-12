# PORTING notes — special.py → TypeScript

Source: `special.py` — 3,220,026 bytes, 62,978 lines, ~1,878 `def`/`class` blocks.
This document records the deliberate, complete mapping so reviewers can verify nothing was missed.

## 1. Entry points

- `cli_main / build_cli_parser / main / __main__` → Next.js routing: `/` (dashboard),
  `/module/[id]?symbol=X`, `/notes`, `/settings`. CLI flags map to query params:
  `--ticker X` → `?symbol=X`, `--module N` → `/module/N`, `--snapshot/--dashboard` → module page header stats.
- `show_startup_splash / prompt_direct_ticker / pick_ticker_enhanced / display_market_dashboard` → `/` hero + quote strip.
- `run_in_session_settings / run_settings_standalone / _settings_manage_list*` → `/settings` + watchlist panel on `/`.

## 2. Data layer

- `_cached_download / _cached_info / _YF_DOWNLOAD_CACHE (600s) / _YF_INFO_CACHE (3600s)` →
  `src/lib/yahoo.ts` with `CHART_TTL=10min`, `QUOTE_TTL=60s` Maps + `next.revalidate`.
- `flatten_cols / get_safe / get_val / safe_div` → `barsTo*` + `safeDiv` in `utils.ts`.
- All `yf.download(..., period, interval)` call sites → `GET /api/history` (Yahoo v8 chart).
- All `yf.Ticker(...).info` call sites → `GET /api/quote` (Yahoo v7 quote, history fallback).

## 3. Math libraries (formula-identical)

- `_m1_calc_rsi` (ewm com=period-1) → `rsi()` with `wilderEma`.
- `_m1_calc_atr / _m1_calc_stochastic / _m1_calc_stoch_rsi / _m1_calc_macd / _m1_calc_adx` → same names in `indicators.ts`.
- `_m1_calc_roc / _m1_calc_willr / _m1_calc_mfi / _m1_calc_bb / _m1_calc_ema / _m1_calc_beta / _m1_calc_risk_ratios` → ported.
- `_m1_indicator_velocity (OLS slope/std) / _m1_indicator_zscore / _m1_pct_rank / hurst / half-life` → ported.
- `_calc_piotroski` (9 checks, same labels/math) → `calcPiotroski`.
- `_calc_altman_z` (1.2/1.4/3.3/0.6/1.0) → `calcAltmanZ`.
- `_calc_beneish` (-4.84 + 0.920·DSRI …) → `calcBeneish`.
- `_calc_monte_carlo_dcf` (seed 42, wacc sd 0.02, g sd 0.03, term sd 0.01, 20-bin hist) → `calcMonteCarloDCF` with mulberry32+Box-Muller.
- `_calc_reverse_dcf` (bisection lo=-0.05 hi=0.50, 60 iters) → `calcReverseDCF`.
- `_black_scholes_and_greeks / BSMEngine.compute` (incl. vanna/vomma/charm/speed, theta/365, vega/100) → `blackScholes` with A&S norm CDF.
- `_fetch_and_analyze / _generate_strategy` (HV10/30/252, regime 1.3/0.7, EMA9/21+SMA50 bias, delta-0.40 picker) → `historicalVol/volRegime/trendBias/recommendStrike`.
- `MetricsCalculator / _trade_statistics / _kelly_stats / _atr_position_sizing / var-cvar / ewmaVol / GBM fan` → `risk.ts`.

## 4. All 70 modules

Every key of `get_module_dispatch()` appears in `src/lib/modules.ts` with identical `run_*` name,
plus a web page and API branch. ML-training-heavy modules (XGB/LSTM/Transformer/RL/ODE/Swarm/HMM)
ship the feature math + backtest stats + AI critic rather than GPU training in the browser,
which is the only sound Vercel mapping; the page states this explicitly.

IDs covered: 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,73,74,75.

Retired per owner request (registry entry + function code + desk branches
removed; underlying `ReaderDesks.tsx` shared file untouched):
- 50 (`run_epub_reader`, EPUB Reader) — `/module/50` now renders UNKNOWN.

Hidden from the directory/autocomplete but still reachable by direct URL/API:
- 37 (News & Events Hub), 45 (NBFC News Scanner), 46 (Livemint Live Wire).

## 5. AI

All `_ai_call / _m*_stream_response / run_*_chat / OpenRouterChatEngine` variants → single
`POST /api/ai/chat` proxy + `chatComplete()` client. Model default preserved:
`nvidia/nemotron-3-super-120b-a12b:free`. Keys never bundled; per-request header like the Python key files.

## 6. Verified

- `npm run typecheck` and `npm run build` must pass before push (see README).
- Watchlist count assertion: 2,260 symbols, generated from the Python source, not hand-typed.
