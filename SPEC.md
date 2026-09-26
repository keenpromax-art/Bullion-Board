# SPEC.md — Bullion Droid (mobile-first successor surface)

Master implementation specification. Companion to `AGENTS.md` (process law) and
`DESIGN.md` (visual law). This document is the single source of truth for the
mobile/tablet surface; it is kept in sync with the code at every phase gate.

**Product positioning:** Bullion Board's analytical engine (86 desks, 40 API
routes, pure-math `src/lib`) is preserved intact. This spec adds a second,
touch-first **experience layer** — *Bullion Droid* — over the same engine.

```
                    DATA LAYER  (src/lib/yahoo, news, nse, ochain, fred, …)
                        │
              ┌─────────┴─────────┐
              │                   │
         ANALYTICS ENGINE     AI ENGINE      (src/lib/{indicators,options,risk,
              │                   │            fundamentals,ai}.tsx + /api/*)
              └─────────┬─────────┘
                        │
              EXISTING API SURFACE          (/api/* — unchanged, no new endpoints)
                        │
          ┌─────────────┼──────────────┐
          │             │              │
       PHONE         TABLET        DESKTOP
    Bullion Droid  Droid split    Terminal (untouched:
    (simple)       view (pro)     / , /terminal)
```

---

## 1. Locked decisions

| Decision | Value |
|---|---|
| Android delivery | **PWA first** (manifest + service worker + install prompt); Capacitor/APK is a later, separate wrapper around the same URL |
| Naming | **Mobile surface only** = `BULLION DROID`. Desktop terminal, README header and `DESIGN.md` keep `Bullion Board`. One README line links them |
| Dependencies | Hand-rolled by default (zero new runtime deps). Allowlist authorized but only used when a hand-rolled path fails: `framer-motion`, `idb-keyval`, `next-pwa` — any addition must pass `typecheck` + `build` |
| Desktop regression | Forbidden. `/`, `/terminal`, panels, command line, F-keys, tour, `workspaceStore` behavior unchanged |
| Data honesty | Unknown/missing = `"—"` + visible caveat; NaN-safe math; `NO_INVENT` guardrail on every AI path; timestamps shown on every tape |
| Verification | `npm run typecheck` + `npm run build` + live `/api/*` spot-check after **every** phase |

---

## 2. Breakpoints — different IA per tier (never a shrunk desktop)

| Tier | Range | Information architecture |
|---|---|---|
| **PHONE** | `≤767px` | Single column. TopBar (title + search + bell) / content / BottomNav (5 tabs). Bottom sheets for detail. Horizontal swipe tabs on the security page. Contextual FAB. |
| **TABLET** | `768–1199px` | **Split view**: `30%` left rail (nav + watchlist) / `70%` right content. Security page gets a **vertical left tab rail**. Compare + research cards run 1–2–3 columns. Still no Bloomberg panels. |
| **DESKTOP** | `≥1200px` | Droid chrome does not render (children pass through). Primary experience = existing terminal. Droid URLs still resolve so links never 404. |

Detection: `useMediaQuery(query)` (matchMedia + change listener, SSR-safe).
Media queries in `droid.css` mirror these exact numbers: `--dx-bp-tablet: 768px`.

---

## 3. Modes & routing

### 3.1 Modes

Storage `bb.droid.mode.v1` = `simple | pro | terminal`
Storage `bb.droid.lite.v1` = boolean, `bb.droid.prefs.v1` = JSON.

* **simple** — 5-tab Droid, curated quick actions, terminal codes hidden.
* **pro** — simple + extra section pills (Chart/Fundamentals/Options/Risk/Screeners),
  full desk categories unhidden, denser stat cells.
* **terminal** — the existing Bloomberg-style shell (unchanged).

### 3.2 Route table (all additive — no existing route moved or renamed)

| URL | Screen | Notes |
|---|---|---|
| `/` | terminal + **ModeGate** | client hook: phone & mode≠terminal → `router.replace("/home")`. Desktop: no-op |
| `/home` | TODAY | greeting, market snapshot, watchlist, what-changed, AI brief |
| `/markets` | MARKET PULSE | indices, adv/dec, 52W hi/lo, FII/DII (`—` if absent), movers, sectors |
| `/watchlist` | WATCHLIST | multi-list, chips, swipe actions, long-press menu |
| `/s/[symbol]` | SECURITY | price · TouchChart · quick stats · signals · 8 swipe tabs (`?tab=`) |
| `/research/[symbol]` | RESEARCH MODE | 12 swipeable research cards + progress rail |
| `/research` | RESEARCH HUB | saved research, compare launcher, screeners |
| `/ai` | AI | chat sharing `iss.ai.sessions`, context chip from route |
| `/brief` | MORNING BRIEF | snap-scroll sections, AI summary on tap |
| `/notifications` | NOTIFICATIONS | alerts/events/news, unread dot |
| `/more` | MORE | 86 desks in 7 categories, favorites, Lite, Terminal Mode, Settings |
| `/search` | SEARCH | universal search (also opens as overlay sheet) |
| `/d/[funcId]` | DESK BRIDGE | full-screen host: `Panel`-free `DeskRenderer` over `?symbol=` |

Deep-link parity: `/s/RELIANCE.NS`, `/d/12?symbol=TCS.NS`, `/research/INFY.NS`.

### 3.3 Navigation states

* **BottomNav** (phone): `HOME · MARKETS · WATCHLIST · RESEARCH · AI`
  — active = amber icon+label, inactive = `--faint`, `≥44px` targets,
  `env(safe-area-inset-bottom)` padding, badge on `/notifications` via bell in TopBar.
* **TopBar**: back-stack aware (title slot), magnifier → `/search`,
  bell → `/notifications`, mode chip (`SIMPLE/PRO`).
* **MoreDrawer**: opened from `/more` route (full screen on phone, right drawer
  on tablet) — no hover, no right-click anywhere.
* **Sheet stack**: one sheet at a time, `Esc`/backdrop/back-button closes;
  history depth guarded so Android back closes the sheet before leaving the route.
* **Tablet rail**: left `30%` = nav list + watchlist preview; selection pushes
  into the right pane (`?panel=` keeps deep-linkability).

---

## 4. Folder architecture (all new; existing trees untouched)

```
src/droid/
  shell/    DroidShell.tsx · TopBar.tsx · BottomNav.tsx · ModeGate.tsx
            InstallPrompt.tsx · RegisterSW.tsx
  ui/       Sheet.tsx · SwipeTabs.tsx · TouchChart.tsx · MetricCard.tsx
            StatStrip.tsx · ListRow.tsx · DataTable.tsx · NewsCard.tsx
            SignalRow.tsx · Pills.tsx · FAB.tsx · Skeleton.tsx
            EmptyState.tsx · ErrorState.tsx · AICard.tsx · ExplainChip.tsx
            SheetActions.tsx (long-press menu)
  screens/  Home.tsx · Markets.tsx · Watchlist.tsx · Security.tsx
            ResearchMode.tsx · ResearchHub.tsx · AIScreen.tsx · Search.tsx
            Brief.tsx · Notifications.tsx · More.tsx · DeskBridge.tsx
  lib/      droidStore.ts · format.ts · quotes.ts · search.ts · gestures.ts
            categories.ts · brief.ts · research.ts · notify.ts · pwa.ts
            types.ts
  styles/   droid.css            ← imported once in root layout, all rules `.dx` scoped
src/app/(droid)/
  layout.tsx                     ← <DroidShell> + metadata title "Bullion Droid"
  home|markets|watchlist|research|ai|brief|notifications|more|search/page.tsx
  s/[symbol]/page.tsx · research/[symbol]/page.tsx · d/[funcId]/page.tsx
src/app/manifest.ts
public/sw.js · public/icons/icon-{192,512,maskable-512,apple-180}.png
```

**Not built (deliberately):** no parallel `features/engine/data` tree — `src/lib`
math + `/api/*` **are** the engine (per "one financial engine, three experiences").
No desk is forked: native screens call lib math directly; everything else goes
through the Desk Bridge.

### Additive edits to existing files (exhaustive)

1. `src/app/layout.tsx` — +1 import (`./droid.css`).
2. `src/app/page.tsx` — mounts `<ModeGate/>` (desktop no-op).
3. `src/components/terminal/StatusBar.tsx` — +1 `◧ DROID` button → `/home`.
4. `README.md`, `AGENTS.md` — additive sections only.
Nothing else in `src/components/terminal/**`, `src/lib/terminal/**` is touched.

---

## 5. Design tokens & component contracts (`droid.css`, `.dx` prefix only)

Palette/typography from `DESIGN.md` unchanged (`#030304`, `#ffa028`, `#ffb000`,
IBM Plex Mono, tabular-nums, 3px radius). Added:

```css
--dx-safe-t / --dx-safe-b     env(safe-area-inset-*)
--dx-top: 52px                TopBar height
--dx-nav: 56px                BottomNav height (excl. safe area)
--dx-touch: 44px              minimum hit box
--dx-num-xl: 30px/700         ₹1,482.30   (dominates)
--dx-num-md: 17px/600         +1.42%      (secondary)
--dx-meta: 11px               NSE · UPDATED 12S (tertiary)
--dx-gap: 8px                 8-point spacing grid: 4/8/12/16/24
--dx-sheet-radius: 6px 6px 3px 3px
data-lite="1"                 kills transitions, 60s polls, ≤300 bars
```

Core contracts:

```ts
Sheet:      { open, onClose, title?, snap?: "half"|"full", children }
            — drag handle, backdrop tap, swipe-down ≥120px dismiss, focus trap
SwipeTabs:  { tabs: {id,label}[], value, onChange, children }  // horizontal pan,
            // 60px threshold, rubber-band, inner-scroller chaining
TouchChart: { bars: OHLCBar[], height, showVolume?, lite? }
            // pan / pinch / long-press crosshair (560ms) / double-tap reset /
            // range pills 1D 1W 1M 6M 1Y 5Y → /api/history?range&interval
MetricCard: { label, value, sub?, term?, ctx?, onClick? }   // term → ExplainChip
ErrorState: { what, retry? }   // "TAPE OFF — RETRY" pattern (AGENTS desk anatomy)
Skeleton:   shimmer rows matching the loading layout it replaces
```

Desk anatomy preserved on mobile: `StatStrip` (cells) → panels → verdict
banner (`panel-glow`) → faint unit footnotes. Every async surface ships
**loading / empty / error(+retry)** states; fetches run parallel with
fail-open legs; derived series in `useMemo`.

---

## 6. Screen specs

**S1 `/home` (TODAY)** — greeting by IST part-of-day; index snapshot strip
(`/api/market` first 3); watchlist preview (6 rows, `/api/quote` 60s);
WHAT CHANGED tiles (computed: >3% movers from `/api/breadth`, events from
`/api/events`, news count from `/api/news`, triggered alerts from store — each
leg fail-opens to `—`); AI MARKET BRIEF card → **generates on tap** into
`/brief`, cached `bb.droid.brief.v1` + `GENERATED 09:12 IST` stamp (never
pre-written prose); quick-action chips.

**S2 `/markets`** — index board (tap → `/s/:sym`), adv/dec/unch bars,
52W hi/lo counts, FII/DII (absent → `—` + `FII/DII TAPE OFF — BETA SHOWS GAPS`),
sector heat strip (`/api/sector`), movers tabs (gainers/losers/volume from
`/api/breadth`), all rows tappable.

**S3 `/watchlist`** — multi-list `bb.droid.watchlists.v1`
(`{id,name,symbols[]}[]`, first run migrates `store.getWatchlist()` into
`MY WATCHLIST`); chips `ALL GAINERS LOSERS EVENTS`; row = symbol · price ·
change · spark; **swipe-left** reveals `CHART NEWS ALERT REMOVE`; **long-press
450ms** → `COMPARE ANALYZE SET ALERT ADD NOTE OPTIONS`; add-symbol sheet uses
`/api/lookup`; empty/error states.

**S4 `/s/[symbol]` (SECURITY — the core object)** — header: name, price
(`--dx-num-xl`), Δ, `NSE · UPDATED 12S`, ⭐ toggle (store watchlist);
TouchChart + range pills; QuickStats cells (52W range, mkt cap, P/E, ROCE/margins,
div yield, beta — from `/api/company` + `/api/statements`) each wrapped with
ⓘ `ExplainChip` (existing `useExplain()`); SignalGrid (Technical / Fundamental /
Momentum / Risk — computed client-side from `indicators.ts` + `ratios.ts` over
`/api/history`, each with an honest confidence caveat); quick-actions row
(WATCH · ALERT · COMPARE · ASK AI · MORE DESKS); **SwipeTabs** deep-linked
via `?tab=`: `OVERVIEW CHART TECHNICALS FUNDAMENTALS VALUATION OPTIONS NEWS AI`.

**S5 `/research/[symbol]`** — 12 cards `01 OVERVIEW … 12 AI ANALYSIS`,
horizontal snap cards + progress rail; data from existing endpoints only
(`/api/company`, `/api/statements`, `/api/estimates`, `/api/events`,
`/api/ownership`, `/api/dividends`, `/api/news`, `/api/history`); every card
has `ASK AI` carrying its context; gaps render `—`.

**S6 `/ai`** — full-screen chat, sessions shared with desktop
(`iss.ai.sessions`), `streamChat()` + `aiSystem.*` + `NO_INVENT`, context chip
auto-attached (`RELIANCE · TECHNICALS`), suggested prompts, input pinned above
BottomNav.

**S7 `/search`** — layered intent router (no server call for determinism):
`normalize → local symbol index (2,260 WATCHLIST + recents) → FUNC_CODES/label
alias → NL patterns ("show X fundamentals", "compare A and B", "what can I
analyze for X") → /api/lookup live → AI fallback via /api/ai/chat`.
Results show SECURITY rows (quote + 8 quick actions) and DESK rows (label +
category; function code shown only in terminal mode).

**S8 `/brief`** — snap-scroll sections: NIFTY · GLOBAL · FII/DII ·
COMMODITIES · TOP MOVERS · EVENTS · WATCHLIST · AI SUMMARY; each carries
source + time + caveat; AI SUMMARY generated on demand, cached per day.

**S9 `/notifications`** — groups ALERTS / EVENTS / NEWS; created by
`notify.ts` (Web Notifications API, permission opt-in); swipe-dismiss rows;
honest footer `FIRES WHILE THE APP IS OPEN` (serverless = no push worker);
badge dot on TopBar.

**S10 `/more`** — 86 desks grouped by `categories.ts`
(`PRICE · FUNDAMENTALS · VALUATION · DERIVATIVES · RISK · RESEARCH · AI & TOOLS`),
in-drawer search, ★ favorites (existing `store.getFavorites()`), mode switch
(SIMPLE/PRO/TERMINAL), Lite toggle, Settings link, About + non-affiliation line.

**S11 `/d/[funcId]` (DESK BRIDGE)** — `next/dynamic` → `DeskRenderer` inside a
full-screen mobile host (back · desk title · ticker · overflow: OPEN IN
TERMINAL / ASK AI). Covers **all 86 desks** incl. terminal-native 101–115
(FrameDesk iframes for portfolio/alerts render inside the host). No capability
lost on mobile; native screens cover the high-frequency 20%.

**S12 Compare (`/research`)** — pick ≤4 symbols → metric-grouped rows
(P/E, ROE, ROCE, Revenue CAGR, 1Y, Vol); phone = stacked groups, tablet =
columnar matrix.

**S13 Alert sheet** — condition types `PRICE · % · VOLUME · RSI · 52W-HI ·
52W-LO · P/E · EVENT`; writes existing `store.Alert` shape (compatible with
desktop `/alerts`); confirmation sheet shows target, current, and condition.

**S14 FAB** — contextual, hidden while a sheet/input is open:
`AI · CHART · ALERT · COMPARE`.

---

## 7. Gesture table

| Surface | Gesture | Result |
|---|---|---|
| Sheet | drag handle down ≥120px / backdrop tap / Android back | dismiss |
| SwipeTabs | horizontal pan >60px | next/prev tab (rubber-banded, chains to inner scroller) |
| TouchChart | 1-finger drag | pan time window |
| TouchChart | pinch | zoom bar width (2–400 visible bars) |
| TouchChart | 2-finger drag | widen/narrow time range |
| TouchChart | long-press 560ms | crosshair + OHLC/date tooltip |
| TouchChart | double-tap | reset to fit |
| TouchChart | swipe-up from chart | indicator drawer (RSI/MACD/Volume, `+ INDICATOR`) |
| Watchlist row | swipe-left | CHART/NEWS/ALERT/REMOVE (72px reveal) |
| Watchlist row | long-press 450ms | action sheet |
| Research/Brief | vertical snap-scroll | section paging |
| All | keyboard | ←/→ tabs, Esc closes sheet, Enter activates; visible amber focus ring |

Touch rules: every target `≥44px`, `touch-action` set per region (no scroll
traps), no hover-only affordances, no right-click, `prefers-reduced-motion`
removes all animation.

---

## 8. Data contracts (existing APIs — zero new endpoints)

| Consumer | Endpoint | Fields used |
|---|---|---|
| Quote strips, watchlist | `GET /api/quote?symbol=` | `Quote` (price, change, %, mktCap, PE, 52W) |
| TouchChart, signals, research | `GET /api/history?symbol&range&interval` | `{bars: OHLCBar[]}` |
| Security header/stats | `GET /api/company?symbol=` | `quote`, `profile{name,sector,price,valuation,dividends,financials,margins,holders}`, `derived{mktCap,trailPE,offHighPct,avgVol20,yieldPct}`, `links` |
| Fundamentals tab/research | `GET /api/statements?symbol=` | `pl/bs/cf{periods,rows}, rat, unit, marketCapCr` |
| Home/Markets | `GET /api/market`, `/api/breadth`, `/api/sector` | rows, adv/dec, movers, heat |
| News tab | `GET /api/news?symbol&feed=` | `NewsItem{id,title,link,source,ago,label,desc}` |
| Estimates/events/ownership/dividends | `/api/estimates`, `/api/events`, `/api/ownership`, `/api/dividends` | as-is |
| Search | `GET /api/lookup?q=` | `LookupRow{symbol,name,exch,type}` |
| Options tab | `/api/ochain/chain`, `/expiry`, `/symbols` | as-is |
| AI (all contexts) | `POST /api/ai/chat` (`stream:true`) | `{messages,model,apiKey}` → SSE `{text}` |
| Desk bridge | `GET /api/analysis/[id]` | desk-specific (existing) |

Rules: legs fetched in parallel, fail-open (one dead leg never blanks the
screen), derived series memoized, all numeric rendering goes through
`format.ts` (`fmtINR/fmtNum/fmtPct/fmtMcap`) which returns `"—"` on NaN/null.

**Storage keys (additive):** `bb.droid.mode.v1`, `.lite.v1`, `.prefs.v1`,
`.watchlists.v1`, `.recents.v1`, `.brief.v1`, `.notif.v1`, `.offline.v1`.
Existing keys (`bb.workspace.*`, `iss.ai.sessions`, `store` K-map) are read
and reused, never renamed.

---

## 9. PWA

* `src/app/manifest.ts` — `name: "Bullion Droid"`, `short_name: "Droid"`,
  `display: standalone`, `theme_color: #030304`, `background_color: #030304`,
  `scope: "/"`, shortcuts (Watchlist/Search/Brief), icons 192/512/maskable-512
  + apple-touch-180 (generated locally via PowerShell `System.Drawing` —
  black canvas, amber glyph; **no npm image deps**).
* `public/sw.js` — precache shell + `droid.css`; **stale-while-revalidate**
  for `/api/history|analysis|statements` (10 min), **network-first w/ 60s TTL**
  for `/api/quote|market|breadth`, navigation fallback → `/home`; versioned
  cache cleanup. Registered in `RegisterSW` (dev-tolerant, no-op in dev errors).
* Offline honesty: cached payloads render with `SAVED 09:12 IST · OFFLINE —
  LAST TAPE`; live legs still fail-open to `—`.
* `InstallPrompt` — `beforeinstallprompt` card, dismiss remembered.

---

## 10. Performance

* Shell first: droid pages never import `DeskRenderer`/desk files — those load
  only on `/d/[funcId]` via `next/dynamic` (`loading.tsx` skeleton).
* Each screen `dynamic`-imports its heavy section (ML/Monte-Carlo/options math
  arrive only inside their desk route).
* Quotes batched once per 60s (respects `QUOTE_TTL`), tab-visibility guarded;
  lite mode 60s + reduced density.
* Charts cap bars: 300 (lite) / 800 (default).
* `loading.tsx` skeletons per route group; images/fonts self-hosted fallback.

---

## 11. Phase-by-phase coding order (each gate = typecheck + build + live check)

| Phase | Work | Extra gate check |
|---|---|---|
| **0** | This spec | matches implementation intent |
| **1** | `droid.css` tokens + `ui/` primitives + `(droid)/layout` + `DroidShell` + `ModeGate` | desktop `/` unchanged |
| **2** | `lib/{droidStore,format,quotes,search}` + **Search** + **Security page** (TouchChart, QuickStats, signals, tabs) | live `/api/quote`, `/api/history` |
| **3** | **Home, Markets, Watchlist, Notifications, More, FAB, Desk Bridge** | open 5 diverse desks on phone viewport |
| **4** | **Research mode + hub + Compare + Brief** | |
| **5** | **AI layer** (screen, contextual sheets, ExplainChip wiring, intent fallback) | |
| **6** | **Tablet split view + Lite + polish** (safe areas, reduced motion, keyboard) | |
| **7** | **PWA** (manifest, icons, sw, install prompt) | sw sanity on dev server |
| **8** | StatusBar `◧ DROID` + README/AGENTS additive docs | terminal tour + workspace regression |
| **9** | Final spec↔code sync + full build | ✅ |

**Regression checklist (every gate):** `/` still renders the terminal on
desktop; `npm run build` route manifest still contains every pre-existing
route; no `.dx` rule applies outside `[data-dx]` roots; no dead files/payloads;
tree left uncommitted unless the user says push.
