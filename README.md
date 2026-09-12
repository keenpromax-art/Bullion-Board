# Bullion Board — NSE Quant Terminal

Bloomberg-style web terminal for Indian equities: 70+ quant desks covering
technicals, fundamentals, options, risk, screeners, macro and AI analysis.
Built with Next.js 14 + React 18 + TypeScript. Vercel-ready.

## Highlights

- **Terminal workspace** (`/`, alias `/terminal`) — multi-panel BBG-style shell:
  persistent command line (`TICKER FNC + <GO>`, e.g. `RELIANCE STRAT`),
  ticker tape, F1–F12 key bar, saveable workspace layouts, full keyboard
  operation. Ships an Equity Overview preset (strat mini + watchlist +
  funda mini + AI mini, no scrolling); every desk opens in a panel.
- **Options Strategy Recommender** (`/module/70`) — regime engine (trend bias,
  HV term-structure, IV regime, expected move) driving a **15-strategy payoff
  engine**: outrights, vertical/credit spreads, straddles/strangles, butterfly,
  iron condor, Jade Lizard, backspreads — with payoff charts, Greeks per leg,
  scenario P&L, DTE/IV/lot controls and top-3 picks for the current regime.
- **NSE Option Chain** (`/ochain`) — live chain, PCR, max pain, gamma wall,
  IV smile, Greeks, signal engine, payoff + theta-decay charts.
- **Fundamentals** (`/module/11–20`) — statements, ratios, DuPont, DCF/LBO,
  forensics, 4-year history, company profiler.
- **Risk & quant** — Monte Carlo fans, GARCH, HMM regimes, Kelly sizing,
  VaR/CVaR, drawdowns, factor models, pairs/stat-arb, efficient frontier.
- **Screeners** — intraday momentum, swing oracle, drawdown dips, workflow
  scanner, large deals, IPOs.
- **Macro & news** — FRED/GDP/CPI dashboards, Finshots/Mint/wire readers,
  sentiment, AI briefs.
- **AI everywhere** — per-desk analyst + global chat via OpenRouter
  (key in `/settings`, never bundled).

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
- `POST /api/ai/chat` — `{ messages, model, apiKey }` → `{ text }` (streams with `stream: true`)

## Layout

- `src/app/` — routes (`/`, `/module/[id]`, `/ochain`, `/macro`, …) + API
- `src/components/` — desks (`OptionsStrategyDesk`, `ChartDesks`, `FundaDesks`, …)
- `src/lib/` — math core (`indicators`, `options`, `strategyEngine`, `ochain`, `risk`, `fundamentals`, `yahoo`, `modules`, `terminal`)
