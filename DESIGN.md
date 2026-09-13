# DESIGN.md — Bloomberg Terminal skin

Methodology from VoltAgent/awesome-design-md (DESIGN.md spec); visual language
inspired by the Bloomberg Professional terminal: black canvas, amber functions,
security-yellow tickers, dense monospace grids. (Independent homage — not
affiliated with Bloomberg L.P.)

## 1. Visual Theme & Atmosphere

A professional trading terminal. Pure-black canvas, zero marketing whitespace,
everything reachable by function code. Data first, chrome invisible, latency felt
as instant. Uppercase micro-headers, square panels, tabular numerals everywhere.

## 2. Color Palette & Roles

- **Terminal Black** `#030304` — app canvas
- **Panel** `#0c0c0e` — cards, panels; **Panel 2** `#121214` — raised/hover
- **Grid** `#26262b` — 1px borders, table rules
- **Text** `#f5f5f4` — primary; **Sub** `#a1a1aa` — secondary; **Faint** `#5b5b62`
- **Amber** `#ffa028` — functions, headers, primary actions, focus rings
- **Amber Deep** `#b26a00` — hover states, dim accents
- **Security Yellow** `#ffb000` — ticker symbols (Bloomberg shows securities yellow)
- **Up Green** `#00d664` — advances, bullish (▲)
- **Down Red** `#ff453a` — declines, bearish (▼)
- Links in body copy: amber. Red/green strictly directional.

## 3. Typography Rules

- **Everything**: `"IBM Plex Mono", ui-monospace, "Cascadia Mono", Consolas, monospace`
- tabular-nums globally; uppercase 11–12px micro-headers with 0.08em tracking
- Display (security header): 28–34px, 700, ticker in Security Yellow
- Body/data: 13–14px. Never use rounded/geometric sans for data.

## 4. Component Stylings

### Command bar (top, sticky)
- Black `#030304`, bottom border amber-at-40%; prompt `>` in amber
- Input: transparent bg, no border, uppercase mono, amber caret
- Right side: live clock (mono), `FEED ● LIVE` green dot, function tag
- Enter = `<GO>`: `RELIANCE GP` → loads security + function

### Function table (module index)
- Dense rows, 13px mono; columns: `FNC | DESK | DESCRIPTION`
- Header row: 11px uppercase amber, bottom border amber-at-40%
- Row hover: `rgba(255,160,40,0.07)` + ticker-yellow function code
- Selected/active row: left 2px amber bar

### Panels
- bg `#0c0c0e`, `1px solid #26262b`, radius **3px** (terminal = square)
- Header: `▮` amber block + uppercase 12px amber title
- No shadows except active-desk glow `0 0 24px rgba(255,160,40,0.12)`

### Buttons
- Primary: bg amber `#ffa028`, black text, 3px radius, uppercase 13px 700
- Ghost: transparent, `#26262b` border, gray text; hover amber border + amber text
- Never pill, never gradient fills

### Badges
- 3px radius, mono 12px: UP green bg `rgba(0,214,100,0.14)`, DOWN red bg, FNC amber-outline

### Status bar (fixed bottom)
- 28px black bar, top border `#26262b`: `YAHOO FEED ● | 70 FUNC | SEC | CLOCK`
- 11px mono gray; body gets 36px bottom padding

## 5. Layout Principles
- Max width 1400px (terminals are wide), 12px gutters
- Left-aligned, grid-dense; stat strips of 4–6 cells, not hero cards
- Spacing: 4, 8, 12, 16, 24. Radius: 3px panels/buttons, 2px inputs.

## 6. Do's and Don'ts
- DO uppercase all headers; DO show function codes next to every desk
- DO keep every number tabular; DO right-align numeric columns
- DON'T use rounded cards, gradients, purple, or centered marketing heroes
- DON'T use red/green for anything but direction

## 7. Responsive
- <1024px: stat strips 2-col; function table keeps FNC+DESK, hides description
- Command bar collapses to prompt + input; clock hidden <640px
- Terminal workspace <1024px: force single-column stack (tiling presets collapse to 1-up); panels lose native resize; workbar hint hidden
- Terminal workspace <640px: command line shows prompt + input + GO only (clock/feed/focus-tag hidden); ticker tape shortens to 40s loop; function-key bar becomes horizontal scroll strip; panel close/max icons keep 40px hit areas

## 8. Agent Prompt Guide
- "Bloomberg terminal: bg #030304, panel #0c0c0e, amber #ffa028 functions, yellow #ffb000 securities, IBM Plex Mono, 3px radius, dense uppercase grids."

## 9. Terminal Shell (multi-panel workspace — `/terminal`)
- Full-viewport flex column (`100dvh`, internal scroll only): 36px command bar + 26px ticker tape + flex workspace + function-key bar + 26px status bar. No page scroll, no floating chrome.
- Command line: `>` amber prompt, security-yellow 13px uppercase input, right cluster = outlined fnc-tag (`ID · DESK` of focused panel) + `FEED · LIVE` green dot + clock `HH:MM:SS IST`. No logo, no GO button — Enter is `<GO>`. Live segmented echo under the caret: securities render yellow, function codes amber, `NEW` dim — typed text itself is transparent so colors show through. Successful `<GO>` flashes the bar green (action key), unknown commands flash red (cancel key). Syntax `<SYMBOL> <FNC> <GO>`; `FNC<GO>` reuses focused panel symbol; numeric IDs work too (`70<GO>`); shorthands `OCH` (option chain), `IND` (macro), `DIR`, `NOTE`; `SYMBOL<GO>` reopens last FNC for symbol else `DIR`. `MENU<GO>` = back to the function directory (the MENU key), `CANCEL<GO>` = close focused panel (the red key, confirms if last), `HELP`/`?` = this overlay (the HELP key). Plain Enter = replace focused panel; Shift+Enter or trailing `NEW` = new panel. Type `?` for the syntax overlay. History: Up/Down, 50 kept in localStorage. `` ` `` or Ctrl/Cmd+K focuses from anywhere; Esc clears + blurs.
- Autocomplete: fuzzy over watchlist symbols + every `modules.ts` function code; rows show CODE + DESK + CATEGORY; active row is solid amber with black text (menu highlight). Arrow keys + Enter/Tab to complete; mouse via onMouseDown (no blur race).
- Ticker tape: 26px, `1px solid grid` bottom rule only. 28s right-to-left loop, 11px items (symbol security-yellow, price mono, change green ▲ / red ▼). Hover pauses. Click dispatches `SYMBOL<GO>` to focused panel. Batched `/api/quote` at 60s (respects `QUOTE_TTL=60s`) — no push feed.
- Workspace grid: `1.3fr 1fr / 1fr 1fr` 4-up default, `6px` gap + padding. Layouts `1-up | 2-up | 2-H | 4-up` switch via status-bar select; `+ PANEL` adds a directory panel and focuses the command line. Hard cap of 4 panels (`MAX_PANELS` in `workspaceStore.ts`): `NEW`/Shift+Enter/MENU-new/deep links reuse the focused panel at cap; duplicate/detach/`+ PANEL` are blocked with a notice; saved/imported workspaces trim to 4.
- Panels: `#0c0c0e` bg, `1px solid #26262b`, 3px radius. Header 28px `#121214`: `▮` amber + 11px amber function name + `|` + security-yellow ticker + spacer + 16px ▢/✕ icons (24px hit areas). Double-click header = maximize; right-click = Duplicate / Change function (inline `> SYM FNC` row under header) / Detach / Close. Focused panel: amber border + `0 0 24px rgba(255,160,40,0.12)` glow. Body: `10px 12px` padding, internal scroll — desks never assume viewport (no `100vh`, no fixed elements).
- In-panel content: micro-headers 11px amber with amber-at-40% bottom rule; tables 12px with right-aligned numerics, 10px amber headers (first column left), active-row left 2px amber bar; stat strips are `#121214` cards (10px label, 16px value); badges 10px.
- Function-key bar: full-width flex row, black bg, top grid border. Each key `flex:1 min-width:96px`, stacked `F-key` 9px amber / label 10px white / code 9px sub. Click or physical F-key (ignored while command line focused; browser-reserved keys fall back gracefully).
- Status bar: 26px, 10.5px gray uppercase segments — `YAHOO FEED · LIVE | N FUNC | M PANELS OPEN | WORKSPACE: <name> (click = save/load/rename/delete/export/import layouts) | FOCUS: FNC · DESK | layout select | + PANEL | clock IST`. Active layout autosaves (key `bb.workspace.active.v2`); dirty `*` until saved. Default preset `EQUITY OVERVIEW` ships four compact summary panels (`MINI` task: strat regime + watchlist + funda + AI) that fit the viewport with no scrolling; each has `FULL DESK →` to open the complete desk in place. Full desks keep internal scroll only as an overflow fallback.
- Panels render 1:1 with internal scroll (12px body padding) — dense but readable at any size. Maximize a panel for a larger view; minis fit without scrolling.
- Keyboard: single app-level listener; never hijacks typing inside inputs/textareas except command-line keys. Every control keyboard-operable with visible amber focus rings.
- Deep links (`/module/[id]`, `/ochain`, `/macro`, `/notes`, `/settings`) keep resolving; each shows `OPEN IN WORKSPACE ▸` + `TERMINAL ▦` and shares the same `DeskRenderer` used by `Panel` — no forked desk logic. Function-directory rows open desks directly (no per-row task submenu).
- Homage framing: independent visual/functional homage; no Bloomberg trademarks, logo, or wordmark anywhere; footer/about copy states non-affiliation.
