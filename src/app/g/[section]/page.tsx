import GuidedShell from "../../experiences/guided/GuidedShell";

// Sections that are on the Guided roadmap but not built yet.
//
// A tab that 404s is worse than a tab that says what is coming and links to the
// working Pro screen, so each of these names its intended content and hands off
// to the real desk rather than dead-ending.

const SPEC: Record<string, { title: string; lede: string; will: string[]; proHref: string; proLabel: string }> = {
  markets: {
    title: "Markets",
    lede: "Every index, sector and mover in one list, with the market map above it rather than beside it.",
    will: [
      "All indices with day change and the last completed session's range",
      "The sector map, sortable by move, size or breadth",
      "Gainers and losers across the full universe, not just the top five",
      "Tap any name to open the stock page",
    ],
    proHref: "/markets",
    proLabel: "Pro market desk",
  },
  watchlist: {
    title: "Watchlist",
    lede: "The symbols you already track, as large cards with the one number that matters.",
    will: [
      "Your existing watchlist and favourites, read from the same store the terminal uses",
      "Large day change, with the sparkline rather than a full table",
      "A one-tap route into the Pro desk for any name on it",
    ],
    proHref: "/markets",
    proLabel: "Pro market desk",
  },
  portfolio: {
    title: "Portfolio",
    lede: "Holdings, performance and allocation — built so the allocation is a picture, not a table.",
    will: [
      "Performance chart and allocation treemap, side by side",
      "Per-holding day change and unrealised P&L from the existing store",
      "Portfolio metrics beneath, not instead of, the picture",
    ],
    proHref: "/portfolio",
    proLabel: "Pro portfolio",
  },
  macro: {
    title: "Macro",
    lede: "The economy described in words first, with the raw series one tap below it.",
    will: [
      "Growth, inflation, liquidity and rates as plain-language states",
      "What changed recently, in sentences",
      "Explore Macro Data handing off to the full Pro macro desk",
    ],
    proHref: "/macro",
    proLabel: "Pro macro desk",
  },
  options: {
    title: "Options",
    lede: "Support, resistance and what the chain is doing — before any Greek.",
    will: [
      "Support, current and resistance read off the open-interest profile",
      "A plain-language read of where call activity is building",
      "Explore Option Chain handing off to the full Pro chain",
    ],
    proHref: "/ochain",
    proLabel: "Pro option chain",
  },
  search: {
    title: "Search",
    lede: "One field for any stock, index, sector or market.",
    will: [
      "Type-ahead across the equity universe and the index list",
      "Recent searches and an explore menu by category",
      "A result page that opens the Guided stock view, not the terminal panel",
    ],
    proHref: "/markets",
    proLabel: "Pro search",
  },
};

export function generateStaticParams() {
  return Object.keys(SPEC).map((section) => ({ section }));
}

export default async function GuidedSection({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const spec = SPEC[section];

  if (!spec) {
    return (
      <GuidedShell title="Not found">
        <header className="gx-full">
          <p className="gx-eyebrow">Guided</p>
          <h1 className="gx-h1">No such screen</h1>
          <p className="gx-lede">
            There is no Guided section called &ldquo;{section}&rdquo;. The guided surfaces are Home, Markets,
            Watchlist, Portfolio, Macro, Options, Search and More.
          </p>
        </header>
      </GuidedShell>
    );
  }

  return (
    <GuidedShell title={spec.title}>
      <header className="gx-full">
        <p className="gx-eyebrow">On the roadmap</p>
        <h1 className="gx-h1">{spec.title}</h1>
        <p className="gx-lede">{spec.lede}</p>
      </header>

      <section className="gx-card gx-full">
        <div className="gx-card-head">
          <h2 className="gx-h3">What this screen will carry</h2>
          <span className="gx-chip" style={{ height: 24, fontSize: 10.5 }}>NOT YET BUILT</span>
        </div>
        <div className="gx-reads">
          {spec.will.map((w, k) => (
            <div className="gx-read" key={k}>
              <span className="gx-read-icon gx-flat" aria-hidden>·</span>
              <div className="gx-read-d" style={{ marginTop: 0 }}>{w}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="gx-card gx-full">
        <div className="gx-card-head"><h2 className="gx-h3">In the meantime</h2></div>
        <p className="gx-lede" style={{ marginTop: 0 }}>
          The same data is already available today in the Pro terminal. Nothing here is missing from the product —
          it has not been given the Guided treatment yet.
        </p>
        <div className="gx-chips" style={{ marginTop: 12 }}>
          <a className="gx-chip" href={spec.proHref}>{spec.proLabel} →</a>
          <a className="gx-chip" href="/g">Back to Today</a>
        </div>
      </section>
    </GuidedShell>
  );
}