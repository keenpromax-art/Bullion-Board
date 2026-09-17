// Comprehensive accounting + financial ratios computed from Yahoo-only
// fundamentals-timeseries ledger (yfinance-compatible). No screener needed.
// All inputs are ₹ Crores (per-share/count rows stay raw) — ratios are unit-free.

import type { YFTable } from "./yahoo";

type Row = { label: string; values: (number | null)[] };

const nn = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Exact match first, else shortest label containing the candidate.
function getRow(t: YFTable | null, cands: string[]): (number | null)[] | null {
  if (!t) return null;
  const lows = t.rows.map((r) => ({ r, l: nn(r.label) }));
  for (const c of cands) {
    const nc = nn(c);
    const exact = lows.find((x) => x.l === nc);
    if (exact) return exact.r.values;
  }
  for (const c of cands) {
    const nc = nn(c);
    const all = lows.filter((x) => x.l.includes(nc));
    if (all.length) {
      all.sort((a, b) => a.r.label.length - b.r.label.length);
      return all[0].r.values;
    }
  }
  return null;
}

// Align BS/CF series to PL periods by period label.
function align(
  t: YFTable | null,
  refPeriods: string[],
  cands: string[]
): (number | null)[] {
  if (!t) return refPeriods.map(() => null);
  const rows = t.rows.map((r) => ({ r, l: nn(r.label) }));
  let hit: Row | null = null;
  for (const c of cands) {
    const nc = nn(c);
    const exact = rows.find((x) => x.l === nc);
    if (exact) {
      hit = exact.r;
      break;
    }
  }
  if (!hit) {
    for (const c of cands) {
      const nc = nn(c);
      const all = rows.filter((x) => x.l.includes(nc));
      if (all.length) {
        all.sort((a, b) => a.r.label.length - b.r.label.length);
        hit = all[0].r;
        break;
      }
    }
  }
  if (!hit) return refPeriods.map(() => null);
  const idx = new Map(t.periods.map((p, i) => [p, i]));
  return refPeriods.map((p) => {
    const i = idx.get(p);
    return i === undefined ? null : hit!.values[i];
  });
}

const div = (a: number | null | undefined, b: number | null | undefined): number | null =>
  a === null || a === undefined || b === null || b === undefined || !b ? null : a / b;
const pct = (a: number | null | undefined, b: number | null | undefined): number | null => {
  const v = div(a, b);
  return v === null ? null : v * 100;
};
const yoy = (vals: (number | null)[], i: number): number | null => {
  const c = vals[i],
    p = vals[i - 1];
  if (c === null || p === null || p === undefined || !p || i === 0) return null;
  return ((c - p) / Math.abs(p)) * 100;
};
const r2 = (v: number | null): number | null =>
  v === null || v === undefined || !isFinite(v) ? null : Math.round(v * 100) / 100;

export function buildRatios(pl: YFTable | null, bs: YFTable | null, cf: YFTable | null): YFTable | null {
  if (!pl || !pl.periods.length) return null;
  const P = pl.periods;
  const n = P.length;

  // ---- income (aligned to PL periods = identity) ----
  const rev = align(pl, P, ["total revenue", "operating revenue"]);
  const cogs = align(pl, P, ["reconciled cost of revenue", "cost of revenue"]);
  const gp = align(pl, P, ["gross profit"]);
  const opex = align(pl, P, ["operating expense"]);
  const opInc = align(pl, P, ["operating income", "total operating income"]);
  const ebit = align(pl, P, ["ebit"]);
  const ebitda = align(pl, P, ["ebitda"]);
  const pretax = align(pl, P, ["pretax income"]);
  const tax = align(pl, P, ["tax provision"]);
  const net = align(pl, P, ["net income", "net income common stockholders"]);
  const interestExp = align(pl, P, ["interest expense"]);
  const epsD = align(pl, P, ["diluted eps"]);
  const epsB = align(pl, P, ["basic eps"]);
  const dps = align(pl, P, ["dividend per share"]);
  const shares = align(pl, P, ["basic average shares", "diluted average shares"]);

  // ---- balance ----
  const totA = align(bs, P, ["total assets"]);
  const curA = align(bs, P, ["current assets"]);
  const curL = align(bs, P, ["current liabilities"]);
  const inv = align(bs, P, ["inventory"]);
  const recv = align(bs, P, ["gross accounts receivable", "accounts receivable", "receivables"]);
  const pay = align(bs, P, ["accounts payable", "payables"]);
  const cash = align(bs, P, ["cash and cash equivalents", "cash equivalents", "cash financial"]);
  const totDebt = align(bs, P, ["total debt"]);
  const netDebt = align(bs, P, ["net debt"]);
  const ltDebt = align(bs, P, ["long term debt"]);
  const equity = align(bs, P, ["stockholders equity", "total equity gross minority interest", "common stock equity"]);
  const tangBV = align(bs, P, ["tangible book value"]);
  const netPPE = align(bs, P, ["net ppe"]);
  const workCap = align(bs, P, ["working capital"]);
  const invCap = align(bs, P, ["invested capital"]);
  const totL = align(bs, P, ["total liabilities net minority interest", "total liabilities"]);

  // ---- cash flow ----
  const ocf = align(cf, P, ["cash flow from continuing operating activities", "operating cash flow"]);
  const icf = align(cf, P, ["cash flow from continuing investing activities", "investing cash flow"]);
  const fcf = align(cf, P, ["free cash flow"]);
  const capex = align(cf, P, ["capital expenditure", "capital expenditure reported", "purchase of ppe"]);
  const divPaid = align(cf, P, ["cash dividends paid", "common stock dividend paid", "dividend paid"]);

  // Resolve capex sign (Yahoo reports capex negative). Use abs for intensity.
  const acapex = capex.map((v) => (v === null ? null : Math.abs(v)));
  const adiv = divPaid.map((v) => (v === null ? null : Math.abs(v)));

  interface Def {
    label: string;
    vals: (number | null)[];
  }
  const defs: Def[] = [];
  const add = (label: string, vals: (number | null)[]) => {
    if (vals.some((v) => v !== null)) defs.push({ label, vals: vals.map(r2) });
  };
  const at = (arr: (number | null)[], i: number) => (i < 0 || i >= arr.length ? null : arr[i]);

  // ---- profitability ----
  const grossM = P.map((_, i) => pct(at(gp, i), at(rev, i)));
  const opM = P.map((_, i) => pct(at(opInc, i), at(rev, i)));
  const ebitM = P.map((_, i) => pct(at(ebit, i), at(rev, i)));
  const ebitdaM = P.map((_, i) => pct(at(ebitda, i), at(rev, i)));
  const preM = P.map((_, i) => pct(at(pretax, i), at(rev, i)));
  const netM = P.map((_, i) => pct(at(net, i), at(rev, i)));
  const taxRate = P.map((_, i) => pct(at(tax, i), at(pretax, i)));
  const roe = P.map((_, i) => pct(at(net, i), at(equity, i)));
  const roa = P.map((_, i) => pct(at(net, i), at(totA, i)));
  const roce = P.map((_, i) => {
    const ce = at(totA, i) !== null && at(curL, i) !== null ? at(totA, i)! - at(curL, i)! : null;
    return pct(at(ebit, i), ce);
  });
  const roic = P.map((_, i) => {
    let tr = at(tax, i) !== null && at(pretax, i) ? at(tax, i)! / at(pretax, i)! : 0.25;
    if (!isFinite(tr)) tr = 0.25;
    tr = Math.max(0, Math.min(1, tr));
    const nopat = at(opInc, i) !== null ? at(opInc, i)! * (1 - tr) : null;
    return pct(nopat, at(invCap, i));
  });
  const roTangible = P.map((_, i) => pct(at(net, i), at(tangBV, i)));
  const payout = P.map((_, i) => pct(at(adiv, i), at(net, i)));
  add("Gross Margin %", grossM);
  add("Operating Margin %", opM);
  add("EBIT Margin %", ebitM);
  add("EBITDA Margin %", ebitdaM);
  add("Pretax Margin %", preM);
  add("Net Margin %", netM);
  add("Effective Tax Rate %", taxRate);
  add("ROE %", roe);
  add("ROA %", roa);
  add("ROCE %", roce);
  add("ROIC %", roic);
  add("Return on Tangible Equity %", roTangible);
  add("Dividend Payout %", payout);
  add(
    "Retention Ratio %",
    payout.map((v) => (v === null ? null : 100 - v))
  );

  // ---- liquidity ----
  add(
    "Current Ratio x",
    P.map((_, i) => div(at(curA, i), at(curL, i)))
  );
  add(
    "Quick Ratio x",
    P.map((_, i) => {
      const qa = at(curA, i) !== null && at(inv, i) !== null ? at(curA, i)! - at(inv, i)! : at(curA, i);
      return div(qa, at(curL, i));
    })
  );
  add(
    "Cash Ratio x",
    P.map((_, i) => div(at(cash, i), at(curL, i)))
  );
  add(
    "Working Capital Rs Cr",
    P.map((_, i) => {
      const w = at(workCap, i);
      if (w !== null) return w;
      return at(curA, i) !== null && at(curL, i) !== null ? at(curA, i)! - at(curL, i)! : null;
    })
  );
  add(
    "Net Cash Rs Cr",
    P.map((_, i) => (at(cash, i) !== null && at(totDebt, i) !== null ? at(cash, i)! - at(totDebt, i)! : null))
  );

  // ---- leverage ----
  add(
    "Debt to Equity x",
    P.map((_, i) => div(at(totDebt, i), at(equity, i)))
  );
  add(
    "Debt to Assets x",
    P.map((_, i) => div(at(totDebt, i), at(totA, i)))
  );
  add(
    "Equity Ratio x",
    P.map((_, i) => div(at(equity, i), at(totA, i)))
  );
  add(
    "Long Term Debt to Equity x",
    P.map((_, i) => div(at(ltDebt, i), at(equity, i)))
  );
  add(
    "Interest Coverage x",
    P.map((_, i) => {
      const ie = at(interestExp, i);
      return div(at(ebit, i), ie !== null ? Math.abs(ie) : null);
    })
  );
  add(
    "Debt to EBITDA x",
    P.map((_, i) => div(at(totDebt, i), at(ebitda, i)))
  );
  add(
    "Net Debt to EBITDA x",
    P.map((_, i) => div(at(netDebt, i), at(ebitda, i)))
  );
  add(
    "Assets to Equity x",
    P.map((_, i) => div(at(totA, i), at(equity, i)))
  );

  // ---- efficiency ----
  const assetT = P.map((_, i) => div(at(rev, i), at(totA, i)));
  const recvT = P.map((_, i) => div(at(rev, i), at(recv, i)));
  const invT = P.map((_, i) => div(at(cogs, i), at(inv, i)));
  const payT = P.map((_, i) => div(at(cogs, i), at(pay, i)));
  add("Asset Turnover x", assetT);
  add(
    "Equity Turnover x",
    P.map((_, i) => div(at(rev, i), at(equity, i)))
  );
  add(
    "Fixed Asset Turnover x",
    P.map((_, i) => div(at(rev, i), at(netPPE, i)))
  );
  add(
    "Working Capital Turnover x",
    P.map((_, i) => {
      const w = at(workCap, i) ?? (at(curA, i) !== null && at(curL, i) !== null ? at(curA, i)! - at(curL, i)! : null);
      return div(at(rev, i), w);
    })
  );
  add("Inventory Turnover x", invT);
  add("Receivables Turnover x", recvT);
  add("Payables Turnover x", payT);
  const dso = recvT.map((v) => (v ? 365 / v : null));
  const dio = invT.map((v) => (v ? 365 / v : null));
  const dpo = payT.map((v) => (v ? 365 / v : null));
  add("Days Sales Outstanding days", dso);
  add("Days Inventory Outstanding days", dio);
  add("Days Payable Outstanding days", dpo);
  add(
    "Cash Conversion Cycle days",
    P.map((_, i) => (dso[i] !== null && dio[i] !== null && dpo[i] !== null ? dso[i]! + dio[i]! - dpo[i]! : null))
  );

  // ---- cash flow ----
  add(
    "OCF Margin %",
    P.map((_, i) => pct(at(ocf, i), at(rev, i)))
  );
  add(
    "FCF Margin %",
    P.map((_, i) => pct(at(fcf, i), at(rev, i)))
  );
  add(
    "OCF to Net Income x",
    P.map((_, i) => div(at(ocf, i), at(net, i)))
  );
  add(
    "FCF to Net Income x",
    P.map((_, i) => div(at(fcf, i), at(net, i)))
  );
  add(
    "Capex to OCF %",
    P.map((_, i) => pct(at(acapex, i), at(ocf, i)))
  );
  add(
    "Capex to Revenue %",
    P.map((_, i) => pct(at(acapex, i), at(rev, i)))
  );
  add(
    "Dividend to OCF %",
    P.map((_, i) => pct(at(adiv, i), at(ocf, i)))
  );

  // ---- growth ----
  const g = (arr: (number | null)[]) => P.map((_, i) => (i === 0 ? null : yoy(arr, i)));
  add("Revenue Growth %", g(rev));
  add("Gross Profit Growth %", g(gp));
  add("Operating Income Growth %", g(opInc));
  add("Net Income Growth %", g(net));
  add("EPS Diluted Growth %", g(epsD));
  add("OCF Growth %", g(ocf));
  add("FCF Growth %", g(fcf));
  add("Total Assets Growth %", g(totA));
  add("Equity Growth %", g(equity));

  // ---- per-share ----
  const bvps = P.map((_, i) => {
    const e = at(equity, i),
      s = at(shares, i);
    if (e === null || !s) return null;
    return (e * 1e7) / s;
  });
  const fcfps = P.map((_, i) => {
    const f = at(fcf, i),
      s = at(shares, i);
    if (f === null || !s) return null;
    return (f * 1e7) / s;
  });
  add("Diluted EPS Rs", epsD);
  add("Basic EPS Rs", epsB);
  add("Dividend Per Share Rs", dps);
  add("Book Value Per Share Rs", bvps);
  add("FCF Per Share Rs", fcfps);

  // ---- dupont extras ----
  add(
    "Tax Burden x",
    P.map((_, i) => div(at(net, i), at(pretax, i)))
  );
  add(
    "Interest Burden x",
    P.map((_, i) => div(at(pretax, i), at(ebit, i)))
  );

  // Opex reference (handy, not a ratio but completes the picture)
  void opex;
  void icf;
  void totL;

  if (!defs.length) return null;
  return {
    periods: P,
    rows: defs.map((d) => ({
      label: d.label,
      values: d.vals,
      raw: d.vals.map((v) => (v === null ? "—" : v.toLocaleString("en-IN"))),
    })),
  };
}
