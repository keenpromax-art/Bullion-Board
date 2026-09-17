# AGENTS.md — Bullion Board (Bloomberg-style NSE quant terminal, Next.js/React/TS)

Independent visual/functional homage to the Bloomberg Professional terminal.
No Bloomberg trademarks, logo, or wordmark anywhere in code, copy, or UI.

## Commands

- Dev: `npm run dev -- --port 3001` (open http://localhost:3001)
- Verify (run both, fix all errors): `npm run typecheck`, `npm run build`
- No linter config, no test suite — verification is typecheck + build + a live
  data-path check (`/api/history`, `/api/analysis/[id]` return real tapes).

## Architecture (where things live)

- `src/lib/modules.ts` — module registry (`MODULE_MAP`, ids 1–115). Start here.
- Desks: dedicated components in `src/components/*Desks.tsx`, wired twice —
  `src/app/module/[id]/page.tsx` (deep-link pages) and
  `src/components/terminal/DeskRenderer.tsx` (workspace panels). Both surfaces
  must stay in sync; shared pieces go in the desk component, never forked copies.
- Generic fallback: `GenericDeskContent` + `src/components/DeskOutput.tsx`,
  fed by `src/app/api/analysis/[id]/route.ts` (one endpoint backs every module).
- Pure math lives in `src/lib/` (`indicators.ts`, `options.ts`, `risk.ts`,
  `fundamentals.ts`, …) — framework-free so pages, panels, and routes share it.
- Charts: `LineChart` / `HBars` / `Histogram` / `AreaChart` / `EquityDrawdown`
  from `src/components/charts.tsx`. Command codes: `src/lib/terminal.ts`.

## Conventions (follow unless told otherwise)

- **Visual**: `DESIGN.md` is law — `#030304` canvas, amber `#ffa028` functions,
  yellow `#ffb000` securities, IBM Plex Mono, tabular numerals, dense grid,
  3px radius. No rounded cards, gradients, or purple.
- **UI copy**: terse UPPERCASE terminal voice. Prices in ₹, market cap in ₹ Cr.
- **Data honesty (hard rule)**: never invent numbers. Unknown/missing renders
  as "—" with a visible caveat (e.g. "NIFTY TAPE OFF — BETA SHOWS GAPS").
  Computations are NaN-safe; AI prompts carry the `NO_INVENT` guardrail.
- **Desk anatomy**: stat `cells` strip → `p-head` panels → verdict banner
  (`panel-glow`) → faint unit footnotes. Every desk: loading, empty, and error
  (+ retry) states; fetches run in parallel with fail-open legs; derived series
  go in `useMemo`. AI blocks use a dedicated `aiSystem.*` prompt in `src/lib/ai.ts`.
- **Code**: TypeScript strict (`tsc --noEmit` must pass), `"use client"` on
  interactive components, no new files when an existing lib/component fits,
  no dead code or dead payloads left behind after a rewire.

## Module improvement workflow (TRIGGER — run automatically)

Whenever the user asks to improve/upgrade/rebuild a module (e.g. "improve module 33",
"make this desk better", with or without a screenshot), execute this workflow without
being asked again:

1. **Find the component** via the Architecture map above (`MODULE_MAP` first).
2. **Re-read `DESIGN.md`** and follow it strictly.
3. **Go all out — rebuild whatever needs rebuilding**, don't just tweak:
   - Fix every visual issue: hierarchy, spacing, alignment, density, missing
     loading/empty/error states, weak or inconsistent styling.
   - Make the data richer: add whatever a real trader/analyst would expect on
     the desk that's currently missing (derived stats, comparisons, regimes,
     guides/footnotes — per the data-honesty rule).
   - Improve interactivity (range/symbol/tenor pills, retries, existing
     command-bar codes), keyboard use, and performance.
   - Match the desk anatomy and conventions of the other 70+ desks.
4. **Verify**: `npm run typecheck` + `npm run build`, live-check the data path.
5. Leave the tree uncommitted unless the user says push.
