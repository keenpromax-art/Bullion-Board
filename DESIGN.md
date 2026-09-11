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

## 8. Agent Prompt Guide
- "Bloomberg terminal: bg #030304, panel #0c0c0e, amber #ffa028 functions, yellow #ffb000 securities, IBM Plex Mono, 3px radius, dense uppercase grids."
