"use client";

// One panel, one plan shape, every desk.
//
// Extracted from the Order Flow desk's TradePlanPanel so the two surfaces cannot
// drift. A desk that reads a price produces a DeskPlan (src/lib/deskplan.ts) and
// this renders it; a desk that reads a filing or a registry produces a
// "readNote" instead and this renders that without pretending there is a trade.
//
// Order matters in the layout and it is not cosmetic: stance and headline first,
// because that is what a trader needs in the first half second. Levels and the
// profit rules next. The case against, the invalidation, and the caveat last,
// because they are what stops the first three from being read as a signal.

import type { DeskPlan, DeskPlanLevel, PlanRole } from "@/lib/deskplan";
import { PLAN_LEVEL_TONE } from "@/lib/deskplan";

const SUBHEAD: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--sub)",
  margin: "0 0 6px",
};

const fmt = (v: number) =>
  v.toLocaleString("en-IN", { maximumFractionDigits: v >= 1000 ? 2 : 2 });

function LevelRows({ levels }: { levels: DeskPlanLevel[] }) {
  if (!levels.length) {
    return (
      <p className="faint" style={{ fontSize: 11.5, margin: 0 }}>
        NO LEVELS TO PRINT.
      </p>
    );
  }
  return (
    <div className="scrollx">
      <table className="plain">
        <thead>
          <tr>
            <th>Role</th>
            <th style={{ textAlign: "right" }}>Price</th>
            <th style={{ textAlign: "right" }}>R:R</th>
            <th>Anchor</th>
          </tr>
        </thead>
        <tbody>
          {levels.map((l) => (
            <tr key={`${l.role}-${l.px}-${l.note}`}>
              <td className={PLAN_LEVEL_TONE[l.role]} style={{ fontSize: 11 }}>
                {l.role}
              </td>
              <td style={{ textAlign: "right" }}>
                {l.role === "ENTRY" || l.role === "STOP" ? <strong>{fmt(l.px)}</strong> : fmt(l.px)}
              </td>
              <td
                style={{ textAlign: "right" }}
                className={l.rr === null ? "faint" : l.rr >= 2 ? "pos" : ""}
              >
                {l.rr === null ? "—" : `${l.rr}R`}
              </td>
              <td className="faint" style={{ fontSize: 10.5 }}>{l.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DeskPlanPanel({
  plan,
  title = "Trade plan",
  symbol,
  /** For desks with no trade to give: how to actually use what you are looking at. */
  readNote,
  /**
   * Render without the panel box, for desks whose root element is already a
   * panel. Nesting a bordered box inside a bordered box reads as a mistake;
   * a rule and some air does not.
   */
  bare = false,
}: {
  plan: DeskPlan;
  title?: string;
  symbol?: string;
  readNote?: string;
  bare?: boolean;
}) {
  const accent =
    plan.stanceTone === "pos" ? "var(--green)" : plan.stanceTone === "neg" ? "var(--red)" : "var(--grid)";
  const hasLevels = plan.levels.length > 0;

  return (
    <div className={bare ? undefined : "panel"} style={bare ? { borderTop: "1px solid var(--grid)", paddingTop: 12, marginBottom: 10 } : undefined}>
      <p className="p-head">
        {title}
        {symbol ? ` — ${symbol}` : ""}
        {hasLevels ? " · what to trade and when to take profit" : " · how to read this"}
      </p>

      {/* Verdict first, in the largest type on the panel. */}
      <div style={{ borderLeft: `3px solid ${accent}`, padding: "2px 0 2px 12px", marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <strong style={{ fontSize: 17, letterSpacing: "0.04em", color: accent === "var(--grid)" ? "var(--sub)" : accent }}>
            {plan.stance}
          </strong>
          <span className="badge fnc" style={{ fontSize: 10 }}>{plan.badge}</span>
          {plan.flags.map((f) => (
            <span key={f} className="badge bad" style={{ fontSize: 10 }}>
              <span className="dot" /> {f}
            </span>
          ))}
        </div>
        <p style={{ margin: "5px 0 0", fontSize: 13, lineHeight: 1.45 }}>{plan.headline}</p>
        <p className="muted" style={{ margin: "5px 0 0", fontSize: 11.5, lineHeight: 1.5 }}>{plan.entryText}</p>
      </div>

      {hasLevels && (
        <div className="grid grid-2" style={{ gap: 12 }}>
          <div>
            <p style={SUBHEAD}>Levels</p>
            <LevelRows levels={plan.levels} />
          </div>
          <div>
            <p style={SUBHEAD}>When to take profit</p>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 11.5, lineHeight: 1.55 }}>
              {plan.profitRules.map((r, i) => (
                <li key={i} style={{ marginBottom: 3 }}>{r}</li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {/* Why, and what argues the other way. Showing the case against is what
          stops this reading as a signal generator. */}
      {(plan.confluence.length > 0 || plan.against.length > 0) && (
        <div className="grid grid-2" style={{ gap: 12, marginTop: hasLevels ? 10 : 0 }}>
          {plan.confluence.length > 0 && (
            <div>
              <p style={{ ...SUBHEAD, color: "var(--green)" }}>On the tape for this</p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, lineHeight: 1.5 }}>
                {plan.confluence.map((c, i) => <li key={i} style={{ marginBottom: 2 }}>{c}</li>)}
              </ul>
            </div>
          )}
          {plan.against.length > 0 && (
            <div>
              <p style={{ ...SUBHEAD, color: "var(--red)" }}>Against it</p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, lineHeight: 1.5 }}>
                {plan.against.map((c, i) => <li key={i} style={{ marginBottom: 2 }}>{c}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Reference desks have no invalidation to state, so they get the read note
          in the same slot. Silently omitting the block is worse than saying what
          the desk is actually for. */}
      {readNote ? (
        <p className="muted" style={{ fontSize: 11.5, margin: "10px 0 0", lineHeight: 1.55 }}>
          <strong style={{ color: "var(--amber)" }}>HOW TO USE THIS —</strong> {readNote}
        </p>
      ) : (
        plan.invalidation && (
          <p className="warn" style={{ fontSize: 11.5, margin: "10px 0 0", lineHeight: 1.5 }}>
            <strong>INVALIDATION —</strong> {plan.invalidation}
          </p>
        )
      )}

      <p className="faint" style={{ fontSize: 10.5, margin: "10px 0 0", lineHeight: 1.6 }}>
        {plan.caveat}
      </p>
    </div>
  );
}

export default DeskPlanPanel;
