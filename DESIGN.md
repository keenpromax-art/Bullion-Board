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
- Chrome mounts once: `CommandLine` + `TickerTape` + `PanelWorkspace` + `FunctionKeyBar` + `StatusBar`. Never nest chrome inside a panel.
- Command line: sticky top, black `#030304`, amber-at-40% bottom border, `>` amber prompt, transparent uppercase input, amber caret. Syntax `<SYMBOL> <FNC> <GO>`; `FNC<GO>` reuses focused panel symbol; `SYMBOL<GO>` reopens last FNC for symbol else `DIR`. Plain Enter = replace focused panel; Shift+Enter or trailing `NEW` = new panel. `?` overlay documents this. History: Up/Down, 50 kept in localStorage. `` ` `` or Ctrl/Cmd+K focuses from anywhere; Esc clears + blurs.
- Autocomplete: fuzzy over watchlist symbols + every `modules.ts` function code; rows show CODE + DESK + CATEGORY; Arrow keys + Enter/Tab to complete; mouse via onMouseDown (no blur race).
- Ticker tape: directly under command line, black bg, amber-at-40% top/bottom rules. Right-to-left marquee (80s loop, 40s <640px), symbol in security-yellow, price tabular mono, change green ▲ / red ▼. Hover pauses. Click dispatches `SYMBOL<GO>` to focused panel. Polls `/api/quote` batched at 60s (respects `QUOTE_TTL=60s`) — no separate push feed.
- Panels: `#0c0c0e` bg, `1px solid #26262b`, 3px radius. Header: `▮` amber + panel number + uppercase 12px amber title + security-yellow ticker + `FNC` badge; mini command (`SYM FNC` + GO) hidden until ✎; close ✕ / maximize ▢ 40px targets right. Right-click header = Duplicate / Change function / Detach to new panel / Close. Focused panel: amber border + `0 0 24px rgba(255,160,40,0.12)` glow + amber number chip. Body: 12px padding, internal scroll, `.desk-fill` min-height 0 — desks never assume viewport (no `100vh`, no fixed elements).
- Tiling: grid presets `1-up | 2-up-v | 2-up-h | 4-up` (hand-rolled CSS grid, no dock lib — see `PanelWorkspace.tsx` rationale). Native `resize: both` corner handle per panel = free resize beyond presets; header drag = reorder; double-click header = maximize. Maximize hides siblings, keeps all chrome visible. `Ctrl+1..9` flashes big index badges (expose numbering).
- Function-key bar: fixed above status bar (bottom 28px), horizontal scroll on small screens. `F1 DIR · F2 CH CHART · F3 TI TECH · F4 FS FUND · F5 STRAT · F6 OC OPTIONS · F7 SWING · F8 IND MACRO · F9 WIRE NEWS · F10 RSK RISK · F11 AI CHAT · F12 NOTES`. Amber top-rule = core equity/options; green = screener/risk; yellow = macro/news/AI. Click or physical F-key (ignored while command line focused; browser-reserved keys fall back gracefully).
- Status bar: extends §4 28px bar — `YAHOO FEED ● | N FUNC | M PANELS | WORKSPACE[*] | FOCUS ▸ FNC | SEC | CLOCK`. 11px mono gray. Body bottom padding accounts for status (28px) + fkey bar (~48px).
- Workspace switcher: `▤ NAME ▾` dropdown — save-as named layout, load/rename/delete, export/import JSON. Active layout autosaves to localStorage on every change; dirty `*` until saved. Default preset `EQUITY OVERVIEW` (DIR + CH chart + FS fundamentals + STRAT) so first run is populated.
- Keyboard: single app-level listener; never hijacks typing inside inputs/textareas except command-line keys. Every control (panels, fkeys, autocomplete, menus) keyboard-operable with visible amber focus rings.
- Deep links (`/module/[id]`, `/ochain`, `/macro`, `/notes`, `/settings`) keep resolving; each shows `OPEN IN WORKSPACE ▸` + `TERMINAL ▦` and shares the same `DeskRenderer` used by `Panel` — no forked desk logic.
- Homage framing: independent visual/functional homage; no Bloomberg trademarks, logo, or wordmark anywhere; footer/about copy states non-affiliation.
