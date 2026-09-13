# Bullion Board — NSE Quant Terminal

Bloomberg-style web terminal for Indian equities: a multi-panel quant
workspace with **70+ analytics desks** covering technicals, fundamentals,
options, risk, ML, screeners, macro, news and AI analysis — all free data,
no API keys required to start. Built with Next.js 14 + React 18 +
TypeScript. Vercel-ready.

## Terminal workspace (`/`, alias `/terminal`)

- Multi-panel BBG-style shell (up to 4 panels): persistent command line
  (`TICKER FNC + <GO>`, e.g. `RELIANCE STRAT`), numeric function IDs
  (`70<GO>`), shorthands (`OCH`, `IND`, `DIR`, `NOTE`), `MENU` / `CANCEL` /
  `HELP` keys, Shift+Enter for new panels, 50-command history, fuzzy
  autocomplete over 2,260 NSE symbols + every function code.
- Cross-asset ticker tape (NSE leaders, Nifty/Sensex/Bank-Nifty, S&P/Nasdaq,
  gold/silver/crude, USD-INR, BTC/ETH) with price + absolute/percentage
  change; F1–F12 function-key bar; live feed indicator + IST clock.
- Saveable workspace layouts, panel duplicate/detach/maximize, full keyboard
  operation. Ships an Equity Overview preset; every desk opens in a panel.
- Desk chat (AI) fitted into the command bar; per-desk AI analyst everywhere.

## Quant desks (70+ modules, `/module/[id]`)

- **Technical** — indicator suite (RSI/MACD/ADX/Stochastic/Bollinger/ATR/MFI),
  institutional multi-panel chart suite, comparison lab, pro scorecard with
  regime filter, pivot maps and forward backtests.
- **Fundamentals** — statements (P&L/BS/CF with YoY, CAGR, Excel export),
  statement charts + analyzer, 4-year ratios, DuPont, forensic accounting
  (Beneish, accruals, earnings quality), three-statement linker, company
  profiler, ownership holder mix, dividends/splits history, documents hub.
- **Valuation** — institutional DCF (WACC build, scenarios, Monte-Carlo,
  sensitivity) and LBO (tranches, IRR/MOIC, value bridge).
- **Options** — 15-strategy payoff engine with regime detection (trend bias,
  HV term-structure, IV regime, expected move), Greeks per leg, scenario P&L,
  DTE/IV/lot controls; Black-Scholes engine, chain Greeks, advanced Greeks
  (vanna/vomma/charm/speed), vol-trading framework.
- **NSE Option Chain** (`/ochain`) — live chain, PCR, max pain, gamma wall,
  IV smile, signal engine, payoff + theta-decay charts.
- **Risk & quant** — Monte-Carlo fans (GBM + Merton jump-diffusion),
  GARCH/Heston stochastic vol, HMM regimes, Kelly sizing, VaR/CVaR,
  drawdowns, rolling risk, Fama-French factors, pairs/stat-arb, efficient
  frontier, portfolio optimizer, asset dependency graphs.
- **ML** — XGB signal engine, ARIMA-LSTM meta forecaster, quant ensemble
  forecaster, autoencoder signals, GARCH-LSTM / transformer / neural-ODE
  forecasters, RL trading agent, 8-node federated signal swarm.
- **Backtests** — multi-strategy tournament + arena with leaderboards,
  trade logs, consensus signal and next-trade plans.

## Screeners

Intraday momentum, swing-trading oracle, drawdown dips, workflow scanner
with custom universe builder, bulk/block deals, IPOs/new listings.

## Macro & markets (`/macro`)

- FRED-powered indicator boards (growth, labor, inflation, rates) + India data.
- 9-country global matrix (US, Germany, France, Italy, UK, Japan, Canada,
  Australia, India) with as-of date stepping.
- Economic forecasts (ECFC) with **country selector** — annual history plus
  FOMC SEP median forwards for the US.
- Economic calendar with FRED release dates, priors/actuals, CSV export.

## News & research

Finshots reader, Livemint wire, multi-source market wire with sentiment,
NBFC scanner, editorials, Wikipedia + scripture terminals with AI
explain/quiz modes, sentiment scoring and AI briefs.

## Terminal desks

Portfolio blotter with live P&L, price alerts with browser notifications,
multi-security compare, correlation matrix, 10Y seasonality heatmaps, OHLC
history + corporate actions browser, breadth/movers, desk calculators (SIP,
CAGR, Kelly, pivots, Fibonacci, YTM), pre-market opening desk, analyst
ratings consensus, capital-structure/WACC desk, notes.

## AI (optional, key in `/settings`, never bundled)

Per-desk analyst + global desk chat via OpenRouter (free models available),
multi-session with export, live quote context attached automatically.

## Data & privacy

- Market data: Yahoo Finance (no key). Macro: FRED keyless feeds
  (key only unlocks series search titles). Nothing is stored server-side —
  watchlists, portfolios, notes and prefs live in your browser localStorage,
  so it runs on serverless hosting as-is.

## Run locally

```bash
npm install
npm run dev -- --port 3001
# open http://localhost:3001
```

Production mode:

```bash
npm run build
npm run start -- --port 3001
```

## Typecheck / build (same as Vercel)

```bash
npm run typecheck
npm run build
```

## Env vars (optional, all have sane defaults)

| Var | Used for |
|---|---|
| `OPENROUTER_API_KEY` | AI chat/analyst server fallback (`/settings` key wins) |
| `OPENROUTER_MODEL` | Default model |
| `FRED_API_KEY` | Macro series search titles/units (values flow keyless) |

Never commit `.env.local` — set these in the Vercel dashboard instead.

## Push to GitHub

```bash
git init
git add package.json package-lock.json tsconfig.json next.config.js vercel.json next-env.d.ts .gitignore src README.md PORTING.md DESIGN.md
git commit -m "Bullion Board — NSE quant terminal"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

## Deploy on Vercel

1. Import the GitHub repo in Vercel.
2. Framework preset: **Next.js**. Build: `npm run build`. Output: `.next`.
3. Add env vars above.
4. Deploy. No keys ship with the app — each user adds their OpenRouter key in `/settings`.

## API routes

- `GET /api/quote?symbol=RELIANCE.NS`
- `GET /api/history?symbol=RELIANCE.NS&range=1y&interval=1d`
- `GET /api/analysis/[id]?symbol=RELIANCE.NS&range=1y` — desk computation
- `GET /api/ochain/chain?symbol=NIFTY&expiry=…&mode=Index` — live option chain
- `GET /api/macro/forecasts?country=india` — ECFC history (+ SEP for US)
- `GET /api/macro/matrix?asof=…` — 9-country macro snapshot
- `POST /api/ai/chat` — `{ messages, model, apiKey }` → `{ text }` (streams with `stream: true`)

## Layout

- `src/app/` — routes (`/`, `/module/[id]`, `/ochain`, `/macro`, …) + API
- `src/components/` — desks (`OptionsStrategyDesk`, `ChartDesks`, `FundaDesks`, …)
- `src/lib/` — math core (`indicators`, `options`, `strategyEngine`, `ochain`, `risk`, `fundamentals`, `yahoo`, `modules`, `terminal`)
