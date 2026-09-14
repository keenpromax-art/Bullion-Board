# Bullion Board — NSE Quant Terminal

A Bloomberg-style web terminal for Indian equities: a multi-panel quant
workspace with **86 analytics desks** covering technicals, fundamentals,
options, risk, ML, screeners, macro, news and AI analysis — plus an embedded
**CFA study app** — all on free data, no API keys required to start.
Built with Next.js 14 + React 18 + TypeScript. Vercel-ready.

> **New here?** Start with [60-second quickstart](#60-second-quickstart),
> then follow the [guided tour](#your-first-5-minutes). Everything below
> assumes you are on the terminal home page (`/`, alias `/terminal`).

---

## Table of contents

1. [60-second quickstart](#60-second-quickstart)
2. [First run: the guided tour](#first-run-the-guided-tour)
3. [Your first 5 minutes](#your-first-5-minutes)
4. [The command line](#the-command-line)
5. [The ticker tape](#the-ticker-tape)
6. [Panels: your workspace](#panels-your-workspace)
7. [Changing a panel's company (with autofill)](#changing-a-panels-company-with-autofill)
8. [Function keys F1–F12](#function-keys-f1f12)
9. [The status bar: workspaces, desks, layouts](#the-status-bar-workspaces-desks-layouts)
10. [The starter dashboard](#the-starter-dashboard)
11. [Desk catalog](#desk-catalog)
12. [Macro, option chain & other live boards](#macro-option-chain--other-live-boards)
13. [Screeners, news & research](#screeners-news--research)
14. [AI chat & per-desk analysts](#ai-chat--per-desk-analysts)
15. [CFA study app (NEXUS)](#cfa-study-app-nexus)
16. [Keyboard cheat sheet](#keyboard-cheat-sheet)
17. [Data, keys & privacy](#data-keys--privacy)
18. [Run locally](#run-locally)
19. [Deploy](#deploy)
20. [API routes & code layout](#api-routes--code-layout)

---

## 60-second quickstart

1. Open the app. You land on a 4-panel terminal with a command line on top.
2. Click any panel to focus it (amber border = focused).
3. Type in the top command line:
   `RELIANCE STRAT` + `Enter`
   The focused panel loads the options-strategy desk for Reliance.
4. Press `` ` `` (backtick), type `TCS FS` + `Enter` — fundamentals for TCS.
5. Click a symbol in the scrolling ticker tape — it loads into the focused panel.
6. Press `F2` — chart suite for the focused symbol. Press `F9` — news wire.
7. Double-click a panel header to maximize it; double-click again to restore.

That's the whole interaction model: **one command line drives every panel.**

---

## First run: the guided tour

Fresh browsers get a 7-step overlay tour on first visit:

1. Welcome / what this terminal is
2. Command line (the `<GO>` key)
3. Ticker tape
4. Panels
5. Function keys F1–F12
6. Status bar (workspaces + desks)
7. Your starter dashboard

Controls: `NEXT →` / `← BACK` / `SKIP ✕`, arrow keys work too, `Esc` exits.
Replay it anytime with the `? TOUR` button in the status bar.

---

## Your first 5 minutes

Follow along — each step teaches one terminal skill.

**Step 1 — Run a command.**
Focus the bottom-left panel (click it), type `RELIANCE TI` + `Enter`.
You now see RSI, MACD, ADX, Bollinger and friends for Reliance.

**Step 2 — Reuse the symbol.**
With the same panel focused, type just `CH` + `Enter`.
No ticker needed: a bare function reuses the focused panel's symbol.

**Step 3 — Change the company with autofill.**
Click the yellow `RELIANCE.NS` text in that panel's header. An input
appears — type `HDFCB` and pick `HDFCBANK.NS` from the company dropdown
(`↑↓` + `TAB`/`ENTER`, or click). Press `Enter` to load it.

**Step 4 — Open the directory.**
Type `MENU` + `Enter` in the command line. The focused panel returns to
the Function Directory — every desk lives here. Click any row to open it.

**Step 5 — Save your layout.**
In the bottom status bar, click `WORKSPACE` → save this arrangement under
a name (e.g. `MY FIRST DESK`). It autosaves from here on; reload the page
and everything is where you left it.

---

## The command line

The amber `>` bar at the very top. Syntax is always:

```text
TICKER FNC + ENTER      replace the focused panel (e.g. RELIANCE STRAT)
FNC + ENTER             reuse the focused symbol (e.g. STRAT, 70, OCH)
TICKER + ENTER          reopen the last function used for that ticker
TICKER FNC NEW          same, but in a NEW panel (or Shift+Enter)
MENU + ENTER            focused panel back to the Function Directory
CANCEL + ENTER          close the focused panel (confirms if it's the last)
?  or  HELP             syntax overlay
```

Notes:

- Tickers are entendercase-insensitive; NSE suffixes auto-complete
  (`RELIANCE` → `RELIANCE.NS`). Indices/futures/FX/crypto work too
  (`^NSEI`, `GC=F`, `USDINR=X`, `BTC-USD`).
- Functions accept codes or numeric IDs: `STRAT` = `70`, `OCH` = option
  chain, `IND` = macro, `DIR` = directory, `NOTE` = notes.
- While typing you get a two-section dropdown — **SECURITIES** (fuzzy over
  2,260 NSE symbols + watchlist) and **FUNCTIONS** (code · desk ·
  category). `↑↓` to move, `TAB`/`ENTER` to complete, `ENTER` on an exact
  match to go. The typed text echoes back color-coded: securities yellow,
  functions amber.
- `↑↓` with an empty line walks 50 kept commands. `` ` `` or `Ctrl/⌘+K`
  focuses the line from anywhere; `Esc` clears it.
- A green flash = accepted (`<GO>`); red = unknown/cancel key.

---

## The ticker tape

The 26px strip under the command line streams your watchlist:
NSE leaders, Nifty/Sensex/Bank-Nifty, S&P/Nasdaq, gold/silver/crude,
USD-INR, BTC/ETH — price plus day change (green ▲ / red ▼).

- **Click any symbol** to load it into the focused panel.
- **Hover** pauses the scroll.
- Edit the list from any watchlist control; the tape follows it.

---

## Panels: your workspace

Up to **4 panels** share the screen (hard cap — extra "new panel"
requests reuse the focused panel instead of overflowing).

- **Focus:** click a panel. Focused = amber border + glow. Every command,
  tape click and F-key targets the focused panel.
- **Maximize:** double-click the header (or `Ctrl/⌘+M`); repeat to restore.
- **Right-click the header** for actions: back to menu, favorite,
  duplicate, change function, panel settings, detach to new panel,
  maximize, close.
- **Reorder:** drag panel headers left/right.
- **Resize:** drag the thin dividers between panels (or focus a divider
  and use arrow keys, `Shift` = big step). Splits persist per layout.
- **Close:** `✕` icon or `Ctrl/⌘+W` (confirms if it's the last panel).
- **Cycle focus:** `TAB` / `Shift+TAB` (outside inputs), `Ctrl/⌘+1..4`
  jumps straight to a panel.
- Every panel has a collapsible **⚙ settings strip** at its bottom for
  quick per-desk options (indicator lengths, model/key overrides, …).

---

## Changing a panel's company (with autofill)

Three equivalent ways, fastest first:

1. **Click the yellow ticker** in the panel header (`TECHNICAL INDICATORS
   | RELIANCE.NS`). An inline `> SYM FNC` box opens under the header.
   Start typing a company — a dropdown shows live matches with company
   names and exchanges (Yahoo search + your watchlist, so `ADA` finds
   `ADANIENT.NS` instantly even on a slow feed). `TAB`/`ENTER` fills the
   symbol, `ENTER` loads it. `ESC` closes the list first, then the box.
2. **Command line:** `HDFCBANK FS` + `Enter` (focused panel).
3. **Right-click header → Change function…** — same inline box.

---

## Function keys F1–F12

One tap loads a desk into the focused panel — click the bar or press the
physical key (outside the command line):

| Key | Desk | Key | Desk |
|-----|------|-----|------|
| F1 | Directory | F7 | Opening (pre-market) |
| F2 | Chart | F8 | Macro indicators |
| F3 | Technicals | F9 | News wire |
| F4 | Fundamentals | F10 | Risk |
| F5 | Strategy | F11 | AI chat |
| F6 | Option chain | F12 | Notes |

---

## The status bar: workspaces, desks, layouts

The 26px bottom bar (left → right):

- **Feed + clock** — data freshness and IST time.
- **`WORKSPACE:`** — named layouts: save / load / rename / delete /
  export / import. Autosaves continuously; a `*` means unsaved edits.
- **`DESKS:`** — up to 6 Linux-style virtual desktops. Each keeps its own
  panels, layout and focus. Click to switch, `+` to add, double-click to
  rename, right-click to close.
- **`FOCUS:`** — which `FNC · DESK` is currently targeted.
- **Layout switch** (`1-up | 2-up | 2-H | 3-R | 3-L | 4-up`), **+ PANEL**
  (splits the focused side), **⚙ SET** (settings desk), **? TOUR**.

---

## The starter dashboard

First visits (and every fresh desktop) open `MARKET OVERVIEW`:

| Quadrant | Desk | What it is |
|----------|------|------------|
| Top-left | Macro indicators (`IND`) | India/global macro board — INR, India 10Y, Brent/WTI, gold/silver, S&P/FTSE/Nikkei + live tape |
| Top-right | Function directory (`DIR`) | Every desk, searchable, star favorites to pin tiles |
| Bottom-left | Technicals (`TI`) | Reliance indicator suite to start clicking |
| Bottom-right | News wire (`WIRE`) | Market headlines with sentiment + AI briefs |

---

## Desk catalog

Open the Function Directory (`MENU` or `F1`) for all 86 with search.
The most-used, with codes:

**Technical** — `TI` indicators suite · `CH` master chart suite ·
`MC` historical returns + Monte Carlo · `CMP` indicator comparison lab

**Fundamental** — `FS` statements terminal · `FA` company menu ·
`DCF` valuation · `LBO` buyout model · `DUP` DuPont · `FOR` forensics ·
`SA` statement analyzer · `HI` 4-year history · screening/profiler,
ownership, dividends, filings hubs

**Options** — `STRAT` 15-strategy payoff engine (regime-aware) ·
`OC` NSE option chain (PCR, max pain, Greeks, signal) · Black-Scholes and
advanced-Greeks labs

**Risk & quant** — `RSK` risk terminal · `RR` rolling risk · VaR/CVaR,
Kelly sizing, Monte-Carlo fans, GARCH/Heston vol, HMM regimes,
Fama-French factors, pairs, efficient frontier, portfolio optimizer

**ML & backtests** — XGB/ARIMA-LSTM/transformer/neural-ODE forecasters,
RL agent, signal swarm, strategy tournament + arena

**Terminal desks** — `HOLD` portfolio blotter · `ALRT` price alerts ·
`COMP` compare · `CORR` correlation matrix · `SEAS` seasonality ·
`EVTS` history + actions · `BRTH` breadth/movers · `CALC` calculators
(SIP/CAGR/Kelly/pivots/Fibonacci/YTM) · `PRE` pre-market opening ·
`ANR` analyst consensus · `CAST` capital structure · `SET` settings

---

## Macro, option chain & other live boards

- **Macro (`F8` / `/macro`)** — FRED-powered boards: US growth, labor
  (payrolls, unemployment, participation), inflation (CPI/PCE/PPI), rates
  (Fed funds, SOFR, yields, mortgages), money supply (M1/M2), US states,
  India (CPI, call rate, 10Y, INR, GDP) and global (crude, gold, dollar
  index, FX). 9-country matrix with date stepping, ECFC forecasts with
  country selector, ECO calendar with priors/actuals + CSV, FRED search
  to pin any series (needs free FRED key in `SET`). The terminal mini
  keeps `FULL MACRO DESK →` at its top.
- **Option chain (`F6` / `/ochain`)** — live NSE chain with PCR, max pain,
  Greeks and signal; `FULL OPTION CHAIN →` sits at the panel top.
- **Opening (`F7`)** — pre-market verdict, breadth, gainers/losers.

---

## Screeners, news & research

- **Screeners** — intraday momentum, swing oracle, drawdown dips, custom
  universe builder, bulk/block deals, IPOs.
- **News** — market wire with bull/bear sentiment filters, company feed,
  custom search, Finshots + Livemint readers, NBFC scanner, editorials,
  per-article AI key-points and wire briefs.
- **Reference** — Wikipedia finance lens, Dawson-style readers, **Book Reader (`BOOK`)**: PDF library with per-book page memory (upload once, resume in any panel), chart and
  filings deep-links per security.

---

## AI chat & per-desk analysts

Optional; needs an OpenRouter key in `SET`/`/settings` (free-tier models
available, server fallback key works out of the box).

- **Desk chat (`F11` / `◈ AI`)** — streaming assistant with the focused
  security + live quote attached automatically, multi-session, export.
  Ask real questions: it answers fully (verdict → reasoning → levels →
  risks → what to watch), not in two clipped lines.
- **Per-desk `RUN AI` buttons** — every quant/funda/risk desk ships an
  analyst that reads the numbers on screen (RSI/MACD/ADX, DuPont factors,
  Beneish/Altman/Piotroski, Greeks…) with anti-hallucination guardrails:
  unknown fields print as data gaps, never invented values.
- **CFA launcher (`✎ CFA`)** — opens the Nexus study app in the focused
  panel.

---

## CFA study app (NEXUS)

Embedded study environment (`114` / command-bar `✎ CFA`): book library
with topic browser, PDF reader, tutoring chat with study modes, notes.
`OPEN FULL →` jumps to the standalone site.

---

## Keyboard cheat sheet

| Keys | Action |
|------|--------|
| `TICKER FNC` + `Enter` | Load desk into focused panel |
| `FNC` + `Enter` | Same, reuse focused symbol |
| `Shift+Enter` or `… NEW` | Open in new panel |
| `MENU` / `CANCEL` + `Enter` | Directory / close focused panel |
| `` ` `` or `Ctrl/⌘+K` | Focus command line |
| `Esc` | Close list → clear → blur |
| `↑↓` (empty line) | Command history (50) |
| `F1–F12` | Function-key desks |
| `Ctrl/⌘+M` | Maximize / restore panel |
| `Ctrl/⌘+W` | Close focused panel |
| `Ctrl/⌘+1..4` | Jump focus to panel N |
| `TAB` / `Shift+TAB` | Cycle panel focus |
| `←` `→` in tour | Tour prev / next |

---

## Data, keys & privacy

- **Market data:** Yahoo Finance (no key). **Macro:** FRED keyless feeds;
  a free FRED key (in `SET` → macro) unlocks official titles + series
  search. **AI:** OpenRouter key (in `SET` → AI).
- **Nothing is stored server-side.** Watchlists, portfolios, notes,
  workspaces, desktops and prefs live in browser localStorage —
  `SET` → backup exports/imports everything (optionally with keys) to
  move devices.

---

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

Typecheck / build (same as Vercel):

```bash
npm run typecheck
npm run build
```

### Env vars (optional, all have sane defaults)

| Var | Used for |
|---|---|
| `OPENROUTER_API_KEY` | AI chat/analyst server fallback (`/settings` key wins) |
| `OPENROUTER_MODEL` | Default model |
| `FRED_API_KEY` | Macro series search titles/units (values flow keyless) |

Never commit `.env.local` — set these in the Vercel dashboard instead.

---

## Deploy

### Push to GitHub

```bash
git init
git add package.json package-lock.json tsconfig.json next.config.js vercel.json next-env.d.ts .gitignore src README.md PORTING.md DESIGN.md
git commit -m "Bullion Board — NSE quant terminal"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

### Deploy on Vercel

1. Import the GitHub repo in Vercel.
2. Framework preset: **Next.js**. Build: `npm run build`. Output: `.next`.
3. Add env vars above.
4. Deploy. No keys ship with the app — each user adds their OpenRouter key in `/settings`.

---

## API routes & code layout

- `GET /api/quote?symbol=RELIANCE.NS`
- `GET /api/history?symbol=RELIANCE.NS&range=1y&interval=1d`
- `GET /api/analysis/[id]?symbol=RELIANCE.NS&range=1y` — desk computation
- `GET /api/lookup?q=RELIANCE` — company autofill (Yahoo + watchlist)
- `GET /api/ochain/chain?symbol=NIFTY&expiry=…&mode=Index` — live option chain
- `GET /api/macro?groups=INDIA,GLOBAL` — FRED board (optional group filter)
- `GET /api/macro/forecasts?country=india` — ECFC history (+ SEP for US)
- `GET /api/macro/matrix?asof=…` — 9-country macro snapshot
- `GET /api/market` — cross-asset board snapshot (see also `/api/breadth`)
- `GET /api/news?symbol=RELIANCE.NS&feed=wire` — RSS wire with sentiment
- `GET /api/screener?kind=momentum` — Nifty-50 scans (`momentum`, `dip`, `swing`, `all`)
- `POST /api/ai/chat` — `{ messages, model, apiKey }` → `{ text }` (streams with `stream: true`)

Layout:

- `src/app/` — routes (`/`, `/module/[id]`, `/ochain`, `/macro`, …) + API
- `src/components/` — desks (`OptionsStrategyDesk`, `ChartDesks`, `FundaDesks`, …)
- `src/lib/` — math core (`indicators`, `options`, `strategyEngine`, `ochain`, `risk`, `fundamentals`, `yahoo`, `modules`, `terminal`)
