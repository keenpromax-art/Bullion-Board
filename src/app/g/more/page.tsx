"use client";

import GuidedShell from "../../experiences/guided/GuidedShell";

const SCREENS: Array<{ href: string; title: string; blurb: string; state: "ready" | "next" }> = [
  { href: "/g", title: "Today", blurb: "The flagship home: one asset, the market map, and what changed.", state: "ready" },
  { href: "/g/markets", title: "Markets", blurb: "Every index, sector and mover in one list.", state: "next" },
  { href: "/g/watchlist", title: "Watchlist", blurb: "The symbols you already track, on one screen.", state: "next" },
  { href: "/g/portfolio", title: "Portfolio", blurb: "Holdings, performance and allocation.", state: "next" },
  { href: "/g/macro", title: "Macro", blurb: "The economy in plain language, not a data dump.", state: "next" },
  { href: "/g/options", title: "Options", blurb: "Support, resistance and what the chain is doing.", state: "next" },
  { href: "/g/search", title: "Search", blurb: "Find any stock, index or market.", state: "next" },
  { href: "/opening", title: "Opening desk", blurb: "The pre-open engine — the full Pro desk, unchanged.", state: "ready" },
  { href: "/terminal", title: "Pro terminal", blurb: "All 116 function codes, workspace panels, keyboard-driven.", state: "ready" },
];

export default function GuidedMore() {
  return (
    <GuidedShell title="More">
      <header className="gx-full">
        <p className="gx-eyebrow">Bullion Board</p>
        <h1 className="gx-h1">More</h1>
        <p className="gx-lede">
          Everything in the product, and the two switches that change how it looks and behaves.
        </p>
      </header>

      <section className="gx-card gx-full">
        <div className="gx-card-head"><h2 className="gx-h2">All screens</h2></div>
        <div className="gx-reads">
          {SCREENS.map((s) => (
            <a className="gx-read" key={s.href} href={s.href} style={{ textDecoration: "none", color: "inherit" }}>
              <span className="gx-read-icon gx-flat" aria-hidden>{s.state === "ready" ? "●" : "○"}</span>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <span className="gx-read-t">{s.title}</span>
                {s.state === "next" && (
                  <span className="gx-chip" style={{ height: 22, fontSize: 10.5 }}>NEXT</span>
                )}
                <span className="gx-read-d" style={{ flexBasis: "100%" }}>{s.blurb}</span>
              </div>
            </a>
          ))}
        </div>
        <p className="gx-empty" style={{ marginTop: 12 }}>
          Screens marked NEXT are on the Guided roadmap. They are listed so the shape of the experience is honest
          up front — a missing screen is not a broken one.
        </p>
      </section>

      <section className="gx-card gx-full">
        <div className="gx-card-head"><h2 className="gx-h2">Experience</h2></div>
        <p className="gx-lede" style={{ marginTop: -4 }}>
          This switch changes navigation, typography, density, cards, labels and interaction — not just light and
          dark. The data and the engine underneath are identical in all three.
        </p>
        <div style={{ marginTop: 12 }}>
          <a className="gx-chip" href="/settings">Open full settings →</a>
        </div>
        <p className="gx-empty" style={{ marginTop: 12 }}>
          The appearance toggle in the top bar switches light and dark. The experience selector — Guided, Hybrid,
          Pro — lives in Settings, because it is a larger decision than a theme.
        </p>
      </section>
    </GuidedShell>
  );
}