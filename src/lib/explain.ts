// Global explain system — single source of truth for every label,
// metric, and panel in the terminal. Pure, framework-free (AGENTS.md).
//
// Lookup: normKey(label) → GLOSSARY entry → tier-1 instant read.
// AI: buildExplainPrompt() → tier-2 streamed popover via chatComplete/streamChat.

import type { ChatMessage } from "./ai";

// ---------- types ----------

export interface ExplainEntry {
  what: string;        // 1 sentence, plain English, sentence case
  how?: string;        // formula / derivation
  unit?: string;       // "₹ Cr" | "%" | "x" | "days" | "bps"
  goodBad?: string;    // directional read, UPPERCASE terminal verdict
  indiaNote?: string;  // Ind AS / SEBI / NSE-specific caveat
  tags?: string[];     // "pl" | "bs" | "cf" | "ratio" | "options" | "risk" | "macro" | "tech" | "forensic" | "market"
  category?: string;   // "Debit" | "Credit" | "Volatility" | "Neutral" for strategies
}

export interface ExplainContext {
  symbol?: string;
  desk?: string;
  periods?: string[];
  values?: (number | null)[];
  unit?: string;
  extra?: Record<string, string | number | null>;
  source?: string;
}

// ---------- normalisation ----------

/** Lowercase, strip every non-alphanumeric, also de-camelCase. */
export function normKey(label: string): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Try de-camelCase form for Yahoo raw keys (ReconciledDepreciation → reconcileddepreciation)
  const decamel = label
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  // Return the shorter match that is at least as long as the base
  return decamel.length < base.length && decamel.length >= 3 ? decamel : base;
}

// ---------- lookup ----------

/** Longest-prefix containment, shortest match wins (same tiebreak as findVals). */
export function lookup(label: string): ExplainEntry | null {
  const nk = normKey(label);
  // 1. Exact match
  if (GLOSSARY[nk]) return GLOSSARY[nk];
  // 2. De-camel exact
  const decamel = label.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (GLOSSARY[decamel]) return GLOSSARY[decamel];
  // 3. Shortest prefix containment
  let best: ExplainEntry | null = null;
  let bestLen = Infinity;
  for (const [k, v] of Object.entries(GLOSSARY)) {
    if (nk.includes(k) || k.includes(nk)) {
      const len = Math.abs(k.length - nk.length);
      if (len < bestLen || (len === bestLen && k.length < (best?.what ? normKey(best.what).length : Infinity))) {
        bestLen = len;
        best = v;
      }
    }
  }
  return best;
}

// ---------- prompt builder ----------

export function buildExplainPrompt(
  label: string,
  entry: ExplainEntry | null,
  ctx: ExplainContext
): ChatMessage[] {
  const deskCtx = ctx.desk ? ` DESK: ${ctx.desk}.` : "";
  const symCtx = ctx.symbol ? ` SYMBOL: ${ctx.symbol}.` : "";
  const periodCtx = ctx.periods?.length ? ` PERIODS: ${ctx.periods.join(", ")}.` : "";
  const valuesCtx = ctx.values?.length
    ? ` VALUES: ${ctx.periods?.map((p, i) => `${p}=${ctx.values![i] ?? "—"}`).join("; ")}.`
    : "";
  const unitCtx = ctx.unit ? ` UNIT: ${ctx.unit}.` : "";
  const extraCtx = ctx.extra
    ? ` EXTRA: ${Object.entries(ctx.extra).map(([k, v]) => `${k}=${v ?? "—"}`).join("; ")}.`
    : "";
  const knownDef = entry
    ? ` KNOWN DEFINITION: ${entry.what}${entry.how ? ` — ${entry.how}` : ""}${entry.goodBad ? ` — ${entry.goodBad}` : ""}. DO NOT RESTATE THIS. EXTEND WITH CONTEXT.`
    : "";
  const hasValues = ctx.values && ctx.values.some((v) => v !== null && v !== undefined);

  const msgs: ChatMessage[] = [
    {
      role: "system",
      content:
        `YOU ARE A TERMINAL GLOSSARY ANALYST WHO TEACHES BEGINNERS ON AN NSE DESK. ` +
        `DEFINE THE TERM FOR A SMART BEGINNER. REPLY IN UPPERCASE TERMINAL LINES. ` +
        `USE ONLY THE NUMBERS SUPPLIED. NEVER INVENT CONSENSUS OR VALUES. EDUCATIONAL ONLY, NOT A BUY/SELL TIP.`
    },
  ];

  let userMsg = `TERM: "${label}"${deskCtx}${symCtx}${periodCtx}${valuesCtx}${unitCtx}${extraCtx}${knownDef}\n`;
  if (hasValues) {
    userMsg += `FORMAT: WHAT IT IS (2 LINES, PLAIN ENGLISH) / HOW IT'S COMPUTED (1 LINE) / READ HERE (2-3 LINES — QUOTE THE PERIODS AND VALUES, NAME THE TREND, SAY WHAT IT IMPLIES) / WATCH FOR (1 LINE). MAX 8 LINES.`;
  } else {
    userMsg += `FORMAT: WHAT IT IS (2 LINES, PLAIN ENGLISH) / HOW IT'S COMPUTED (1 LINE, FORMULA OR SOURCE) / WHY IT MATTERS (2 LINES) / INDIA NOTE (1 LINE — IND AS, SEBI, NSE OR FY-MARCH SPECIFICS; OMIT IF NONE). MAX 8 LINES.`;
  }
  msgs.push({ role: "user", content: userMsg });
  return msgs;
}

export function cacheKey(label: string, ctx: ExplainContext): string {
  const base = normKey(label);
  if (!ctx.symbol) return `def:${base}`;
  const periodHash = ctx.periods?.join(",") ?? "";
  const valHash = ctx.values?.map((v) => v ?? "n").join(",") ?? "";
  return `read:${base}:${ctx.symbol}:${periodHash}:${valHash}`;
}

// =====================================================================
// GLOSSARY — 300+ hand-written, India-aware, terminal-voiced entries.
// Key = normKey(label). Tags enable category filtering.
// =====================================================================

export const GLOSSARY: Record<string, ExplainEntry> = {

  // ────────────────────────── P&L / INCOME STATEMENT ──────────────────────────

  "totalrevenue": {
    what: "Total revenue from all operating and non-operating sources before any deductions.",
    how: "Sum of operating revenue + other revenue on the income statement",
    unit: "₹ Cr",
    goodBad: "GROWTH SIGNALS DEMAND; FLAT/DECLINING = TROUBLE",
    tags: ["pl"],
  },
  "operatingrevenue": {
    what: "Revenue from the company's core business operations, excluding one-offs.",
    how: "Sales of goods/services before excise and other non-operating items",
    unit: "₹ Cr",
    goodBad: "CORE BUSINESS TOP LINE — GROWTH MATTERS MOST",
    tags: ["pl"],
  },
  "costofrevenue": {
    what: "Direct costs attributable to producing the goods or services sold.",
    how: "Raw materials + direct labour + manufacturing overhead",
    unit: "₹ Cr",
    goodBad: "LOWER RELATIVE TO REVENUE = BETTER GROSS MARGIN",
    tags: ["pl"],
  },
  "reconciledcostofrevenue": {
    what: "Yahoo's normalised cost of revenue, adjusted for discontinued operations.",
    how: "Yahoo-reported; may differ from Indian AS cost of goods sold",
    unit: "₹ Cr",
    indiaNote: "Check against standalone P&L COGS for Ind AS reconciliation.",
    tags: ["pl"],
  },
  "grossprofit": {
    what: "Revenue left after subtracting direct production costs.",
    how: "Total Revenue − Cost of Revenue",
    unit: "₹ Cr",
    goodBad: "HIGHER GROSS MARGIN = PRICING POWER OR COST EFFICIENCY",
    tags: ["pl"],
  },
  "operatingexpense": {
    what: "All costs needed to run the business day-to-day, excluding COGS and interest.",
    how: "Selling + General & Administrative + R&D + Depreciation + Other",
    unit: "₹ Cr",
    goodBad: "GROWTH IN OPEX SHOULD BE SLOWER THAN REVENUE GROWTH",
    tags: ["pl"],
  },
  "sellinggeneral": {
    what: "Combined selling, general and administrative expenses — the overhead of running the business.",
    how: "SG&A includes salaries, rent, marketing, legal, and other office costs",
    unit: "₹ Cr",
    goodBad: "DECLINING AS % OF REVENUE = OPERATING LEVERAGE",
    tags: ["pl"],
  },
  "researchanddevelopment": {
    what: "Expenditure on R&D and product development during the period.",
    how: "Direct R&D spend as reported; capitalised R&D may be under amortisation",
    unit: "₹ Cr",
    indiaNote: "Indian companies often capitalise R&D under Ind AS 38 — check if this is expense or capitalised.",
    goodBad: "HIGH R&D = FUTURE OPTIONALITY BUT CURRENT MARGIN DRAG",
    tags: ["pl"],
  },
  "depreciation": {
    what: "Allocation of tangible asset cost over their useful life.",
    how: "Straight-line or WDV per Ind AS 16; excludes amortisation of intangibles",
    unit: "₹ Cr",
    goodBad: "NON-CASH CHARGE — ADD BACK TO OCF; HIGH D&A = CAPITAL-INTENSIVE",
    tags: ["pl", "cf"],
  },
  "reconcileddepreciation": {
    what: "Yahoo's normalised D&A figure, combining depreciation and amortisation.",
    how: "Yahoo-reported; may differ from Indian AS-reported D&A",
    unit: "₹ Cr",
    indiaNote: "Check against cash-flow D&A for consistency; Yahoo sometimes merges line items.",
    tags: ["pl"],
  },
  "amortization": {
    what: "Allocation of intangible asset cost (patents, goodwill impairment) over time.",
    how: "Amortisation of intangible assets per Ind AS 38",
    unit: "₹ Cr",
    tags: ["pl"],
  },
  "operatingincome": {
    what: "Profit from core business operations before interest and tax.",
    how: "Gross Profit − Operating Expenses",
    unit: "₹ Cr",
    goodBad: "THE KEY PROFITABILITY METRIC — DRIVES ROCE AND EV MULTIPLES",
    tags: ["pl"],
  },
  "ebitda": {
    what: "Earnings before interest, tax, depreciation and amortisation — proxy for operating cash generation.",
    how: "Operating Income + Depreciation + Amortisation",
    unit: "₹ Cr",
    goodBad: "USED IN EV/EBITDA MULTIPLES AND DEBT COVENANTS",
    tags: ["pl"],
  },
  "ebit": {
    what: "Earnings before interest and tax — operating profit after D&A.",
    how: "Operating Income (same as EBIT on most Yahoo feeds)",
    unit: "₹ Cr",
    goodBad: "DRIVES INTEREST COVERAGE AND ROCE",
    tags: ["pl"],
  },
  "netinterestincome": {
    what: "Interest earned minus interest paid — net interest margin for banks/NBFCs.",
    how: "Interest Income − Interest Expense",
    unit: "₹ Cr",
    indiaNote: "Core revenue line for banks; for non-financials, usually small.",
    tags: ["pl"],
  },
  "interestexpense": {
    what: "Total interest cost on borrowings during the period.",
    how: "Interest on term loans + working capital + debentures + bonds",
    unit: "₹ Cr",
    goodBad: "HIGH INTEREST EXPENSE RELATIVE TO EBIT = LEVERAGE STRESS",
    tags: ["pl"],
  },
  "interestincome": {
    what: "Interest earned on cash deposits, investments, and lending.",
    how: "Interest from bank FDs, fixed deposits, inter-corporate deposits",
    unit: "₹ Cr",
    tags: ["pl"],
  },
  "otherincome": {
    what: "Non-operating income: gains on asset sales, forex, investments, insurance claims.",
    how: "Miscellaneous non-core income items",
    unit: "₹ Cr",
    goodBad: "HIGH OTHER-INCOME RELATIVE TO OPERATING PROFIT = EARNINGS QUALITY RISK",
    tags: ["pl"],
  },
  "othernonoperatingincomeexpenses": {
    what: "Non-operating gains and losses not classified elsewhere.",
    how: "Forex gains/losses, investment write-downs, one-time items",
    unit: "₹ Cr",
    tags: ["pl"],
  },
  "specialincomecharges": {
    what: "One-time items: restructuring costs, asset write-offs, legal settlements.",
    how: "Non-recurring charges/gains flagged by the company",
    unit: "₹ Cr",
    goodBad: "RECURRING SPECIAL ITEMS = RED FLAG — SHOULD BE ONE-OFF",
    tags: ["pl"],
  },
  "impairmentofcapitalassets": {
    what: "Write-down of goodwill or fixed assets to recoverable amount.",
    how: "Ind AS 36 impairment loss when carrying value > recoverable amount",
    unit: "₹ Cr",
    indiaNote: "Ind AS 36 requires annual impairment test for goodwill with indefinite life.",
    goodBad: "LARGE IMPAIRMENT = PAST ACQUISITIONS NOT WORKING OUT",
    tags: ["pl"],
  },
  "restructuringandmergernacquisition": {
    what: "Costs related to restructuring operations or M&A integration.",
    how: "Severance, facility closure, integration costs",
    unit: "₹ Cr",
    goodBad: "ONE-OFF BUT REPEATED RESTRUCTURING = STRUCTURAL PROBLEMS",
    tags: ["pl"],
  },
  "pretaxincome": {
    what: "Profit before income tax provision — the tax base.",
    how: "Operating Income + Other Income − Interest Expense − Special Items",
    unit: "₹ Cr",
    tags: ["pl"],
  },
  "taxprovision": {
    what: "Income tax expense for the period.",
    how: "Current tax + deferred tax per Ind AS 12",
    unit: "₹ Cr",
    indiaNote: "India statutory rate ≈ 25.168% (22% + surcharge + cess); effective rate may differ.",
    tags: ["pl"],
  },
  "netincome": {
    what: "Bottom-line profit attributable to shareholders after all expenses and tax.",
    how: "Pretax Income − Tax Provision − Minority Interest − Preferred Dividends",
    unit: "₹ Cr",
    goodBad: "THE ULTIMATE PROFITABILITY MEASURE — DRIVES EPS AND ROE",
    tags: ["pl"],
  },
  "netincomecommonstockholders": {
    what: "Net income available to common shareholders (after preferred dividends).",
    how: "Net Income − Preferred Stock Dividends",
    unit: "₹ Cr",
    tags: ["pl"],
  },
  "minorityinterest": {
    what: "Portion of subsidiary profit/assets owned by outside shareholders.",
    how: "Non-controlling interest per Ind AS 110",
    unit: "₹ Cr",
    indiaNote: "Subtracts from consolidated net income to get parent-company attributable profit.",
    tags: ["pl", "bs"],
  },
  "dilutedeps": {
    what: "Earnings per share after accounting for all convertible dilution.",
    how: "Net Income ÷ Diluted Average Shares Outstanding",
    unit: "₹",
    goodBad: "THE EPS FIGURE USED IN P/E MULTIPLES — DILUTION MATTERS",
    tags: ["pl"],
  },
  "basic eps": {
    what: "Earnings per share on outstanding shares, ignoring dilution from options/warrants.",
    how: "Net Income ÷ Basic Average Shares Outstanding",
    unit: "₹",
    tags: ["pl"],
  },
  "dividendpershare": {
    what: "Total dividend declared per share during the period.",
    how: "Total dividends paid ÷ shares outstanding",
    unit: "₹",
    tags: ["pl"],
  },
  "normalizedebitda": {
    what: "EBITDA adjusted for one-time and non-recurring items.",
    how: "EBITDA + restructuring + impairments + other one-offs",
    unit: "₹ Cr",
    tags: ["pl"],
  },
  "normalizedincome": {
    what: "Net income adjusted for one-time items and tax effects.",
    how: "Net Income + unusual items net of tax",
    unit: "₹ Cr",
    tags: ["pl"],
  },
  "totalexpenses": {
    what: "All operating and non-operating expenses for the period.",
    how: "COGS + OPEX + Interest + Tax + Special Items",
    unit: "₹ Cr",
    tags: ["pl"],
  },
  "gainonsaleofppe": {
    what: "Profit from selling property, plant or equipment above book value.",
    how: "Sale Price − Net Book Value of asset sold",
    unit: "₹ Cr",
    goodBad: "ONE-OFF GAIN — NOT RECURRING OPERATING PROFIT",
    tags: ["pl"],
  },
  "gainonsaleofbusiness": {
    what: "Profit from selling a subsidiary or business unit.",
    how: "Sale Consideration − Net Assets Sold",
    unit: "₹ Cr",
    tags: ["pl"],
  },
  "writeoff": {
    what: "Writing off bad debts, receivables or assets deemed unrecoverable.",
    how: "Amount written off as expense in the period",
    unit: "₹ Cr",
    goodBad: "FREQUENT WRITE-OFFS = CREDIT QUALITY OR ASSET QUALITY ISSUES",
    tags: ["pl"],
  },
  "earningsfromequityinterestnetoftax": {
    what: "Share of profit from equity-method investees, net of tax.",
    how: "Company's share of investee's post-tax profit",
    unit: "₹ Cr",
    tags: ["pl"],
  },
  "totalotherfinancecost": {
    what: "Finance costs other than interest: bank charges, processing fees, forex losses.",
    how: "Sum of non-interest financial charges",
    unit: "₹ Cr",
    tags: ["pl"],
  },

  // ────────────────────────── BALANCE SHEET ──────────────────────────

  "totalassets": {
    what: "Sum of all assets — current and non-current — controlled by the company.",
    how: "Current Assets + Non-Current Assets",
    unit: "₹ Cr",
    goodBad: "GROWTH SHOULD TRACK REVENUE GROWTH; BLOAT = CAPITAL MISALLOCATION",
    tags: ["bs"],
  },
  "currentassets": {
    what: "Assets expected to be converted to cash within one year.",
    how: "Cash + Receivables + Inventory + Prepaid + Short-term Investments",
    unit: "₹ Cr",
    tags: ["bs"],
  },
  "cashandcashequivalents": {
    what: "Most liquid assets: cash in bank, treasury bills, money-market funds.",
    how: "Physical cash + bank balances + highly liquid investments < 3 months maturity",
    unit: "₹ Cr",
    goodBad: "STRONG CASH = FLEXIBILITY FOR CAPEX, DEBT REPAYMENT, OR DIVIDENDS",
    tags: ["bs"],
  },
  "inventory": {
    what: "Stock of raw materials, work-in-progress and finished goods.",
    how: "Per Ind AS 2, valued at lower of cost and net realisable value",
    unit: "₹ Cr",
    indiaNote: "Indian companies must disclose inventory break-up in notes to accounts.",
    goodBad: "RISING INVENTORY WITH FALLING SALES = DEMAND DESTRUCTION",
    tags: ["bs"],
  },
  "receivables": {
    what: "Money owed by customers for goods/services delivered but not yet paid.",
    how: "Trade receivables net of expected credit losses per Ind AS 109",
    unit: "₹ Cr",
    tags: ["bs"],
  },
  "netppe": {
    what: "Net property, plant and equipment — fixed assets after accumulated depreciation.",
    how: "Gross Block − Accumulated Depreciation + Capital WIP",
    unit: "₹ Cr",
    indiaNote: "Revaluation surplus under Ind AS 16 may inflate net PPE.",
    tags: ["bs"],
  },
  "goodwill": {
    what: "Premium paid over fair value of net assets in an acquisition.",
    how: "Purchase price − Fair value of identifiable net assets acquired",
    unit: "₹ Cr",
    goodBad: "LARGE GOODWILL RELATIVE TO TOTAL ASSETS = ACQUISITION RISK",
    tags: ["bs"],
  },
  "intangibleassets": {
    what: "Non-physical assets: patents, trademarks, software, licences.",
    how: "Ind AS 38 — recognised if identifiable, controlled, and future economic benefits probable",
    unit: "₹ Cr",
    tags: ["bs"],
  },
  "totaldebt": {
    what: "All interest-bearing borrowings: short-term + long-term loans, debentures, bonds.",
    how: "Current Debt + Long-Term Debt + Capital Lease Obligations",
    unit: "₹ Cr",
    goodBad: "DEBT RELATIVE TO EQUITY AND EBITDA DETERMINES LEVERAGE RISK",
    tags: ["bs"],
  },
  "longtermdebt": {
    what: "Borrowings due after one year: term loans, debentures, bonds.",
    how: "Long-term borrowings per balance sheet",
    unit: "₹ Cr",
    tags: ["bs"],
  },
  "currentdebt": {
    what: "Borrowings due within one year: working-capital lines, current portion of term loans.",
    how: "Current borrowings + current portion of long-term debt",
    unit: "₹ Cr",
    goodBad: "HIGH CURRENT DEBT WITH LOW CURRENT ASSETS = LIQUIDITY CRUNCH",
    tags: ["bs"],
  },
  "total liabilities": {
    what: "All obligations: current + non-current liabilities.",
    how: "Current Liabilities + Non-Current Liabilities",
    unit: "₹ Cr",
    tags: ["bs"],
  },
  "current liabilities": {
    what: "Obligations due within one year: payables, short-term debt, provisions.",
    how: "Trade Payables + Short-term Borrowings + Current Tax + Other Current Liabilities",
    unit: "₹ Cr",
    tags: ["bs"],
  },
  "stockholders equity": {
    what: "Shareholders' funds — assets minus all liabilities.",
    how: "Share Capital + Reserves & Surplus − Treasury Shares",
    unit: "₹ Cr",
    indiaNote: "Includes revaluation reserve under Ind AS; may not reflect market value.",
    goodBad: "GROWING EQUITY = RETAINED WEALTH OR CAPITAL RAISING",
    tags: ["bs"],
  },
  "commonequity": {
    what: "Equity attributable to common shareholders (excluding preferred stock).",
    how: "Total Equity − Preferred Stock Equity",
    unit: "₹ Cr",
    tags: ["bs"],
  },
  "retainedearnings": {
    what: "Cumulative profits kept in the business, not paid out as dividends.",
    how: "Prior Retained Earnings + Net Income − Dividends",
    unit: "₹ Cr",
    goodBad: "CONSISTENT GROWTH = PROFITABLE AND REINVESTING",
    tags: ["bs"],
  },
  "shareissued": {
    what: "Total number of shares issued by the company.",
    how: "Ordinary shares + preference shares issued",
    unit: "shares",
    indiaNote: "Distinguish from shares outstanding; treasury shares are issued but not outstanding.",
    tags: ["bs"],
  },
  "tangibbookvalue": {
    what: "Equity minus goodwill and intangible assets — tangible net worth.",
    how: "Stockholders Equity − Goodwill − Intangible Assets",
    unit: "₹ Cr",
    goodBad: "NEGATIVE TANGIBLE BOOK VALUE = INSOLVENT ON A TANGIBLE BASIS",
    tags: ["bs"],
  },
  "working capital": {
    what: "Short-term buffer — current assets minus current liabilities.",
    how: "Current Assets − Current Liabilities",
    unit: "₹ Cr",
    goodBad: "NEGATIVE MEANS BILLS EXCEED LIQUID ASSETS — NOT ALWAYS BAD IF PAYABLES ARE LONG-DATED",
    tags: ["bs"],
  },
  "netdebt": {
    what: "Total debt minus cash and equivalents — the true leverage burden.",
    how: "Total Debt − Cash & Equivalents",
    unit: "₹ Cr",
    goodBad: "NEGATIVE = NET CASH POSITION — STRONG BALANCE SHEET",
    tags: ["bs"],
  },
  "investedcapital": {
    what: "Total capital employed: equity + interest-bearing debt.",
    how: "Stockholders Equity + Total Debt",
    unit: "₹ Cr",
    tags: ["bs"],
  },
  "other equity interest": {
    what: "Minority interest, preferred equity, and other equity-like instruments.",
    how: "Non-controlling interest + preferred stock + other equity adjustments",
    unit: "₹ Cr",
    tags: ["bs"],
  },

  // ────────────────────────── CASH FLOW ──────────────────────────

  "operatingcashflow": {
    what: "Cash generated from core business operations — the truest measure of cash earning power.",
    how: "Net Income + D&A + Working Capital Changes + Non-Cash Adjustments",
    unit: "₹ Cr",
    goodBad: "OCF > NET INCOME = HIGH EARNINGS QUALITY; NEGATIVE OCF = RED FLAG",
    tags: ["cf"],
  },
  "investingcashflow": {
    what: "Cash spent on / received from investments: capex, acquisitions, securities.",
    how: "−Capex + Sale of Assets − Acquisitions + Sale of Investments",
    unit: "₹ Cr",
    tags: ["cf"],
  },
  "financingcashflow": {
    what: "Cash from / to debt and equity holders: borrowings, repayments, dividends, buybacks.",
    how: "Debt Issued − Debt Repaid + Equity Issued − Dividends − Buybacks",
    unit: "₹ Cr",
    tags: ["cf"],
  },
  "freecashflow": {
    what: "Cash left after operating costs and capital spending — what can be returned to shareholders.",
    how: "Operating Cash Flow − Capital Expenditure",
    unit: "₹ Cr",
    goodBad: "POSITIVE AND GROWING = BUSINESS GENERATES SURPLUS WITHOUT EXTERNAL FUNDING",
    tags: ["cf"],
  },
  "capitalexpenditure": {
    what: "Cash spent on acquiring or maintaining fixed assets: plants, equipment, property.",
    how: "Purchase of PPE − Sale of PPE",
    unit: "₹ Cr",
    goodBad: "HIGH CAPEX RELATIVE TO DEPRECIATION = GROWTH INVESTMENT OR MAINTENANCE DRAIN",
    tags: ["cf"],
  },
  "changeinworkingcapital": {
    what: "Cash impact of changes in receivables, inventory and payables.",
    how: "ΔReceivables + ΔInventory + ΔPayables + ΔOther Working Capital",
    unit: "₹ Cr",
    goodBad: "POSITIVE = CASH RELEASED FROM WORKING CAPITAL; NEGATIVE = CASH CONSUMED",
    tags: ["cf"],
  },
  "depreciationamortization": {
    what: "Non-cash D&A add-back in the cash-flow statement.",
    how: "Depreciation + Amortisation per cash-flow statement",
    unit: "₹ Cr",
    tags: ["cf"],
  },
  "stockbasedcompensation": {
    what: "Non-cash expense for employee stock options and ESOPs.",
    how: "Fair value of options vested during the period",
    unit: "₹ Cr",
    indiaNote: "Not common in Indian NSE names; mostly relevant for tech subsidiaries.",
    tags: ["cf"],
  },
  "dividendspaid": {
    what: "Cash distributed to shareholders during the period.",
    how: "Final dividend + interim dividend paid in cash",
    unit: "₹ Cr",
    tags: ["cf"],
  },
  "repurchaseofcapitalstock": {
    what: "Cash spent on buying back the company's own shares.",
    how: "Buyback consideration paid",
    unit: "₹ Cr",
    indiaNote: "SEBI requires buyback completion within 12 months of board approval.",
    tags: ["cf"],
  },
  "issuanceofdebt": {
    what: "Cash received from issuing new borrowings.",
    how: "Proceeds from term loans, debentures, bonds issued",
    unit: "₹ Cr",
    tags: ["cf"],
  },
  "repaymentofdebt": {
    what: "Cash used to repay existing borrowings.",
    how: "Principal repayments on loans, debentures, bonds",
    unit: "₹ Cr",
    tags: ["cf"],
  },
  "endcashposition": {
    what: "Cash balance at the end of the period.",
    how: "Beginning Cash + Net Cash Flow from All Activities",
    unit: "₹ Cr",
    tags: ["cf"],
  },

  // ────────────────────────── RATIOS ──────────────────────────

  "gross margin %": {
    what: "Share of revenue left after direct production costs.",
    how: "Gross Profit ÷ Total Revenue × 100",
    unit: "%",
    goodBad: "ABOVE SECTOR MEDIAN = PRICING POWER OR COST ADVANTAGE",
    tags: ["ratio"],
  },
  "operating margin %": {
    what: "Share of revenue from core operations, before interest and tax.",
    how: "Operating Income ÷ Total Revenue × 100",
    unit: "%",
    goodBad: "EXPANDING MARGIN = OPERATING LEVERAGE; CONTRACTING = COST CREEP",
    tags: ["ratio"],
  },
  "ebit margin %": {
    what: "Operating earnings power before interest and tax.",
    how: "EBIT ÷ Total Revenue × 100",
    unit: "%",
    tags: ["ratio"],
  },
  "ebitda margin %": {
    what: "Cash-like operating margin before depreciation and amortisation.",
    how: "EBITDA ÷ Total Revenue × 100",
    unit: "%",
    goodBad: "USED FOR PEER COMPARISON — SECTOR MEDIAN VARIES WIDELY",
    tags: ["ratio"],
  },
  "pretax margin %": {
    what: "Share of revenue left before paying tax.",
    how: "Pretax Income ÷ Total Revenue × 100",
    unit: "%",
    tags: ["ratio"],
  },
  "net margin %": {
    what: "Final share of revenue kept as profit for shareholders.",
    how: "Net Income ÷ Total Revenue × 100",
    unit: "%",
    goodBad: "ABOVE SECTOR MEDIAN IS STRONG; FALLING MARGIN AMID RISING REVENUE = COST CREEP",
    tags: ["ratio"],
  },
  "effective tax rate %": {
    what: "Actual tax bite out of pretax profit.",
    how: "Tax Provision ÷ Pretax Income × 100",
    unit: "%",
    indiaNote: "India statutory rate ≈ 25.168% (22% + surcharge + cess); effective rate may differ due to deductions, MAT, or tax holidays.",
    goodBad: "SIGNIFICANTLY BELOW STATutory = TAX INCENTIVES OR DEFERRALS",
    tags: ["ratio"],
  },
  "roe %": {
    what: "Profit generated per rupee of shareholder equity.",
    how: "Net Income ÷ Stockholders Equity × 100",
    unit: "%",
    goodBad: "ABOVE 15% IS HEALTHY FOR INDIAN INDUSTRIALS; BELOW 8% = CAPITAL MISALLOCATION",
    tags: ["ratio"],
  },
  "roa %": {
    what: "Profit generated per rupee of total assets.",
    how: "Net Income ÷ Total Assets × 100",
    unit: "%",
    goodBad: "ABOVE 8% IS GOOD; BELOW 3% = ASSET-HEAVY, LOW-RETURN BUSINESS",
    tags: ["ratio"],
  },
  "roce %": {
    what: "Return on capital actually employed in the business.",
    how: "EBIT ÷ (Total Assets − Current Liabilities) × 100",
    unit: "%",
    goodBad: "ABOVE WACC (≈12-15% FOR INDIAN FIRMS) = VALUE CREATION",
    tags: ["ratio"],
  },
  "roic %": {
    what: "After-tax operating return on invested capital.",
    how: "Operating Income × (1 − Tax Rate) ÷ Invested Capital × 100",
    unit: "%",
    goodBad: "ROIC > WACC = MOAT; ROIC < WACC = VALUE DESTRUCTION",
    tags: ["ratio"],
  },
  "return on tangible equity %": {
    what: "ROE without goodwill and intangibles flattering equity.",
    how: "Net Income ÷ Tangible Book Value × 100",
    unit: "%",
    tags: ["ratio"],
  },
  "dividend payout %": {
    what: "Share of profit paid out as dividends.",
    how: "Cash Dividends Paid ÷ Net Income × 100",
    unit: "%",
    goodBad: "SUSTAINABLE 30-60% IS IDEAL; >100% = UNSUSTAINABLE",
    tags: ["ratio"],
  },
  "retention ratio %": {
    what: "Share of profit reinvested in the business.",
    how: "100 − Dividend Payout %",
    unit: "%",
    goodBad: "HIGH RETENTION + HIGH ROE = COMPOUNDING MACHINE",
    tags: ["ratio"],
  },
  "current ratio x": {
    what: "Can short-term assets cover short-term bills?",
    how: "Current Assets ÷ Current Liabilities",
    unit: "x",
    goodBad: "ABOVE 1.5X IS COMFORTABLE; BELOW 1X = NEAR-TERM LIQUIDITY STRESS",
    tags: ["ratio"],
  },
  "quick ratio x": {
    what: "Same as current ratio but excludes inventory that may not sell fast.",
    how: "(Current Assets − Inventory) ÷ Current Liabilities",
    unit: "x",
    goodBad: "ABOVE 1X IS HEALTHY; BELOW 0.5X = TIGHT",
    tags: ["ratio"],
  },
  "cash ratio x": {
    what: "Bills payable from cash alone, no sales or collections needed.",
    how: "Cash & Equivalents ÷ Current Liabilities",
    unit: "x",
    goodBad: "ABOVE 0.5X = STRONG LIQUIDITY BUFFER",
    tags: ["ratio"],
  },
  "working capital rs cr": {
    what: "Short-term buffer in rupees. Negative means bills exceed liquid assets.",
    how: "Current Assets − Current Liabilities",
    unit: "₹ Cr",
    tags: ["ratio"],
  },
  "net cash rs cr": {
    what: "Cash left after repaying all debt. Negative means net debt.",
    how: "Cash & Equivalents − Total Debt",
    unit: "₹ Cr",
    goodBad: "POSITIVE = NET CASH; NEGATIVE = NET DEBT",
    tags: ["ratio"],
  },
  "debt to equity x": {
    what: "Rupees of debt per rupee of equity. Higher means more leveraged.",
    how: "Total Debt ÷ Stockholders Equity",
    unit: "x",
    goodBad: "BELOW 1X IS CONSERVATIVE; ABOVE 2X IS LEVERAGED — SECTOR-DEPENDENT",
    tags: ["ratio"],
  },
  "debt to assets x": {
    what: "Share of assets funded by debt.",
    how: "Total Debt ÷ Total Assets",
    unit: "x",
    goodBad: "BELOW 0.5 IS CONSERVATIVE; ABOVE 0.7 = HIGH LEVERAGE",
    tags: ["ratio"],
  },
  "equity ratio x": {
    what: "Share of assets funded by shareholders.",
    how: "Stockholders Equity ÷ Total Assets",
    unit: "x",
    goodBad: "ABOVE 0.5 = EQUITY-FINANCED; BELOW 0.3 = DEBT-FINANCED",
    tags: ["ratio"],
  },
  "long term debt to equity x": {
    what: "Structural leverage ignoring short-term borrowings.",
    how: "Long Term Debt ÷ Stockholders Equity",
    unit: "x",
    tags: ["ratio"],
  },
  "interest coverage x": {
    what: "How many times operating profit covers the interest bill.",
    how: "EBIT ÷ |Interest Expense|",
    unit: "x",
    goodBad: "ABOVE 3X IS SAFE; BELOW 1.5X = DISTRESS TERRITORY",
    tags: ["ratio"],
  },
  "debt to ebitda x": {
    what: "Years of EBITDA needed to repay all debt.",
    how: "Total Debt ÷ EBITDA",
    unit: "x",
    goodBad: "BELOW 2X IS HEALTHY; ABOVE 4X = OVERLEVERAGED",
    tags: ["ratio"],
  },
  "net debt to ebitda x": {
    what: "Same, after subtracting cash on hand.",
    how: "Net Debt ÷ EBITDA",
    unit: "x",
    tags: ["ratio"],
  },
  "assets to equity x": {
    what: "DuPont leverage multiplier — assets supported per rupee of equity.",
    how: "Total Assets ÷ Stockholders Equity",
    unit: "x",
    tags: ["ratio"],
  },
  "asset turnover x": {
    what: "Revenue squeezed from each rupee of assets.",
    how: "Total Revenue ÷ Total Assets",
    unit: "x",
    goodBad: "HIGHER = MORE EFFICIENT USE OF ASSETS; SECTOR-DEPENDENT",
    tags: ["ratio"],
  },
  "equity turnover x": {
    what: "Revenue per rupee of equity.",
    how: "Total Revenue ÷ Stockholders Equity",
    unit: "x",
    tags: ["ratio"],
  },
  "fixed asset turnover x": {
    what: "How hard plant and equipment work to produce sales.",
    how: "Total Revenue ÷ Net PPE",
    unit: "x",
    tags: ["ratio"],
  },
  "working capital turnover x": {
    what: "Sales supported per rupee of working capital.",
    how: "Total Revenue ÷ Working Capital",
    unit: "x",
    tags: ["ratio"],
  },
  "inventory turnover x": {
    what: "How often inventory is sold and replaced each year.",
    how: "Cost of Revenue ÷ Inventory",
    unit: "x",
    goodBad: "HIGH = FAST-MOVING GOODS; LOW = SLOW-MOVING OR OVERSTOCKED",
    tags: ["ratio"],
  },
  "receivables turnover x": {
    what: "How fast customers pay, in times per year.",
    how: "Total Revenue ÷ Receivables",
    unit: "x",
    tags: ["ratio"],
  },
  "payables turnover x": {
    what: "How fast suppliers are paid, in times per year.",
    how: "Cost of Revenue ÷ Payables",
    unit: "x",
    tags: ["ratio"],
  },
  "days sales outstanding days": {
    what: "Average days to collect cash from a sale.",
    how: "365 ÷ Receivables Turnover",
    unit: "days",
    goodBad: "LOW = FAST COLLECTION; HIGH = CREDIT RISK OR LOOSE TERMS",
    tags: ["ratio"],
  },
  "days inventory outstanding days": {
    what: "Average days stock sits before being sold.",
    how: "365 ÷ Inventory Turnover",
    unit: "days",
    goodBad: "LOW = EFFICIENT; HIGH = SLOW-MOVING OR OBSOLESCENCE RISK",
    tags: ["ratio"],
  },
  "days payable outstanding days": {
    what: "Average days taken to pay suppliers.",
    how: "365 ÷ Payables Turnover",
    unit: "days",
    goodBad: "HIGH = PAYMENT STRETCH (WORKING CAPITAL BENEFIT); VERY HIGH = SUPPLIER STRESS",
    tags: ["ratio"],
  },
  "cash conversion cycle days": {
    what: "Days cash is locked in operations. Negative means suppliers fund you.",
    how: "DSO + DIO − DPO",
    unit: "days",
    goodBad: "NEGATIVE = WORKING-CAPITAL EFFICIENT; HIGH POSITIVE = CAPITAL-INTENSIVE",
    tags: ["ratio"],
  },
  "ocf margin %": {
    what: "Cash from operations per rupee of revenue.",
    how: "Operating Cash Flow ÷ Total Revenue × 100",
    unit: "%",
    tags: ["ratio"],
  },
  "fcf margin %": {
    what: "Free cash left per rupee of revenue after capex.",
    how: "Free Cash Flow ÷ Total Revenue × 100",
    unit: "%",
    tags: ["ratio"],
  },
  "ocf to net income x": {
    what: "Are profits backed by cash? Above 1 means cash-backed earnings.",
    how: "Operating Cash Flow ÷ Net Income",
    unit: "x",
    goodBad: "ABOVE 1 = HIGH EARNINGS QUALITY; BELOW 0.7 = ACCRUAL-HEAVY",
    tags: ["ratio"],
  },
  "fcf to net income x": {
    what: "Share of profit convertible to free cash.",
    how: "Free Cash Flow ÷ Net Income",
    unit: "x",
    tags: ["ratio"],
  },
  "capex to ocf %": {
    what: "Share of operating cash eaten by capital spending.",
    how: "|Capital Expenditure| ÷ Operating Cash Flow × 100",
    unit: "%",
    goodBad: "BELOW 50% = CASH-GENERATIVE; ABOVE 80% = HEAVY REINVESTMENT NEEDED",
    tags: ["ratio"],
  },
  "capex to revenue %": {
    what: "Investment intensity of each revenue rupee.",
    how: "|Capital Expenditure| ÷ Total Revenue × 100",
    unit: "%",
    tags: ["ratio"],
  },
  "dividend to ocf %": {
    what: "Share of operating cash paid as dividends.",
    how: "|Dividends Paid| ÷ Operating Cash Flow × 100",
    unit: "%",
    tags: ["ratio"],
  },

  // ────────────────────────── GROWTH ──────────────────────────

  "revenue growth %": {
    what: "Year-on-year sales expansion.",
    how: "(Revenue − Prior Revenue) ÷ |Prior Revenue| × 100",
    unit: "%",
    goodBad: "CONSISTENT DOUBLE-DIGIT = DEMAND STRENGTH; NEGATIVE = CONTRACTION",
    tags: ["ratio"],
  },
  "gross profit growth %": {
    what: "Year-on-year growth in gross profit.",
    how: "(Gross Profit − Prior) ÷ |Prior| × 100",
    unit: "%",
    tags: ["ratio"],
  },
  "operating income growth %": {
    what: "Year-on-year growth in core operating profit.",
    how: "(Operating Income − Prior) ÷ |Prior| × 100",
    unit: "%",
    tags: ["ratio"],
  },
  "net income growth %": {
    what: "Year-on-year bottom-line growth.",
    how: "(Net Income − Prior) ÷ |Prior| × 100",
    unit: "%",
    goodBad: "NEGATIVE WITH POSITIVE REVENUE = MARGIN COMPRESSION",
    tags: ["ratio"],
  },
  "eps diluted growth %": {
    what: "Year-on-year growth in earnings per share.",
    how: "(Diluted EPS − Prior) ÷ |Prior| × 100",
    unit: "%",
    tags: ["ratio"],
  },
  "ocf growth %": {
    what: "Year-on-year growth in operating cash flow.",
    how: "(OCF − Prior) ÷ |Prior| × 100",
    unit: "%",
    tags: ["ratio"],
  },
  "fcf growth %": {
    what: "Year-on-year growth in free cash flow.",
    how: "(FCF − Prior) ÷ |Prior| × 100",
    unit: "%",
    tags: ["ratio"],
  },
  "total assets growth %": {
    what: "Year-on-year balance-sheet expansion.",
    how: "(Total Assets − Prior) ÷ |Prior| × 100",
    unit: "%",
    tags: ["ratio"],
  },
  "equity growth %": {
    what: "Year-on-year growth in shareholder funds.",
    how: "(Equity − Prior) ÷ |Prior| × 100",
    unit: "%",
    tags: ["ratio"],
  },

  // ────────────────────────── PER SHARE ──────────────────────────

  "diluted eps rs": {
    what: "Profit per share after all convertible dilution.",
    how: "Yahoo Diluted EPS, in rupees",
    unit: "₹",
    tags: ["ratio"],
  },
  "basic eps rs": {
    what: "Profit per outstanding share, undiluted.",
    how: "Yahoo Basic EPS, in rupees",
    unit: "₹",
    tags: ["ratio"],
  },
  "dividend per share rs": {
    what: "Dividend declared per share.",
    how: "Yahoo Dividend Per Share, in rupees",
    unit: "₹",
    tags: ["ratio"],
  },
  "book value per share rs": {
    what: "Equity backing each share.",
    how: "Stockholders Equity (₹ Cr × 1 Cr) ÷ Avg Shares",
    unit: "₹",
    tags: ["ratio"],
  },
  "fcf per share rs": {
    what: "Free cash flow attributable to each share.",
    how: "Free Cash Flow (₹ Cr × 1 Cr) ÷ Avg Shares",
    unit: "₹",
    tags: ["ratio"],
  },

  // ────────────────────────── DUPONT ──────────────────────────

  "tax burden x": {
    what: "DuPont: profit kept after tax per rupee of pretax profit.",
    how: "Net Income ÷ Pretax Income",
    unit: "x",
    tags: ["ratio"],
  },
  "interest burden x": {
    what: "DuPont: pretax profit per rupee of EBIT — debt cost drag.",
    how: "Pretax Income ÷ EBIT",
    unit: "x",
    goodBad: "BELOW 0.5 = HEAVY INTEREST BURDEN; ABOVE 0.8 = LOW LEVERAGE COST",
    tags: ["ratio"],
  },

  // ────────────────────────── TECHNICAL INDICATORS ──────────────────────────

  "rsi": {
    what: "Relative Strength Index — momentum oscillator measuring speed and magnitude of recent price changes.",
    how: "100 − 100/(1 + RS), RS = avg gain ÷ avg loss over 14 periods",
    unit: "",
    goodBad: "ABOVE 70 = OVERBOUGHT; BELOW 30 = OVERSOLD. NOT A STANDALONE SIGNAL.",
    tags: ["tech"],
  },
  "macd": {
    what: "Moving Average Convergence Divergence — trend-following momentum indicator from two EMAs.",
    how: "12-EMA − 26-EMA (MACD line); Signal = 9-EMA of MACD line",
    unit: "",
    goodBad: "BULLISH CROSSOVER (MACD ABOVE SIGNAL) = UPSIDE MOMENTUM BUILDING",
    tags: ["tech"],
  },
  "macdhist": {
    what: "MACD histogram — the gap between MACD line and signal line.",
    how: "MACD Line − Signal Line",
    unit: "",
    goodBad: "RISING HISTOGRAM = ACCELERATING TREND; FALLING = DECELERATING",
    tags: ["tech"],
  },
  "adx": {
    what: "Average Directional Index — measures trend strength regardless of direction.",
    how: "14-period smoothed average of DX = 100 × |PDI − MDI| ÷ (PDI + MDI)",
    unit: "",
    goodBad: "ABOVE 25 = STRONG TREND; BELOW 20 = NO TREND / RANGE-BOUND",
    tags: ["tech"],
  },
  "pdi": {
    what: "Plus Directional Indicator — strength of upward price movement.",
    how: "100 × smoothed +DM ÷ ATR",
    unit: "",
    goodBad: "PDI > MDI = BULLISH TREND; PDI < MDI = BEARISH TREND",
    tags: ["tech"],
  },
  "mdi": {
    what: "Minus Directional Indicator — strength of downward price movement.",
    how: "100 × smoothed −DM ÷ ATR",
    unit: "",
    tags: ["tech"],
  },
  "bollinger": {
    what: "Bollinger Bands — volatility envelope around a moving average.",
    how: "SMA(20) ± 2×σ(20)",
    unit: "",
    goodBad: "PRICE TOUCHING UPPER BAND = STRETCHED; TOUCHING LOWER = POTENTIAL SUPPORT OR BREAKDOWN",
    tags: ["tech"],
  },
  "bollingerwidth": {
    what: "Bollinger Band width — the spread between upper and lower bands.",
    how: "(Upper − Lower) ÷ Mid × 100",
    unit: "%",
    goodBad: "NARROWING = VOLATILITY COMPRESSION (SQUEEZE); WIDENING = EXPANSION",
    tags: ["tech"],
  },
  "bollingerpctb": {
    what: "Percent B — where price sits relative to the Bollinger Bands.",
    how: "(Price − Lower) ÷ (Upper − Lower) × 100",
    unit: "%",
    goodBad: "ABOVE 100 = ABOVE UPPER BAND; BELOW 0 = BELOW LOWER BAND",
    tags: ["tech"],
  },
  "atr": {
    what: "Average True Range — average of the largest of three price ranges over 14 periods.",
    how: "14-period Wilder EMA of max(H−L, |H−PrevC|, |L−PrevC|)",
    unit: "₹",
    goodBad: "RISING ATR = INCREASING VOLATILITY; USED FOR STOP-LOSS PLACEMENT",
    tags: ["tech"],
  },
  "stochastic": {
    what: "Stochastic Oscillator — where close sits relative to the high-low range.",
    how: "%K = 100 × (C − L14) ÷ (H14 − L14); %D = 3-SMA of %K",
    unit: "",
    goodBad: "ABOVE 80 = OVERBOUGHT; BELOW 20 = OVERSOLD",
    tags: ["tech"],
  },
  "stochrsi": {
    what: "Stochastic RSI — RSI of RSI, more sensitive than plain RSI.",
    how: "100 × (RSI − Min(RSI,14)) ÷ (Max(RSI,14) − Min(RSI,14))",
    unit: "",
    goodBad: "ABOVE 80 = OVERBOUGHT; BELOW 20 = OVERSOLD — MORE SENSITIVE THAN RSI",
    tags: ["tech"],
  },
  "williams r": {
    what: "Williams %R — momentum oscillator similar to stochastic but inverted.",
    how: "(Highest High − Close) ÷ (Highest High − Lowest Low) × −100",
    unit: "",
    goodBad: "ABOVE −20 = OVERBOUGHT; BELOW −80 = OVERSOLD",
    tags: ["tech"],
  },
  "mfi": {
    what: "Money Flow Index — volume-weighted RSI measuring buying/selling pressure.",
    how: "RSI of (Typical Price × Volume) over 14 periods",
    unit: "",
    goodBad: "ABOVE 80 = OVERBOUGHT WITH VOLUME; BELOW 20 = OVERSOLD",
    tags: ["tech"],
  },
  "obv": {
    what: "On-Balance Volume — cumulative volume flow, adding volume on up days and subtracting on down days.",
    how: "OBV = prior OBV + volume (if close > prev close) − volume (if close < prev close)",
    unit: "",
    goodBad: "OBV RISING WITH PRICE = CONFIRMED UPTREND; DIVERGING = WEAKNESS",
    tags: ["tech"],
  },
  "roc": {
    what: "Rate of Change — percentage change in price over N periods.",
    how: "(Close − Close_N) ÷ Close_N × 100",
    unit: "%",
    tags: ["tech"],
  },
  "donchian": {
    what: "Donchian Channels — highest high and lowest low over N periods.",
    how: "Upper = max(High, N); Lower = min(Low, N)",
    unit: "₹",
    goodBad: "PRICE AT UPPER CHANNEL = NEW HIGHS; AT LOWER = NEW LOWS",
    tags: ["tech"],
  },
  "sma": {
    what: "Simple Moving Average — the arithmetic mean of closing prices over N periods.",
    how: "Sum(Close, N) ÷ N",
    unit: "₹",
    tags: ["tech"],
  },
  "ema": {
    what: "Exponential Moving Average — weighted average giving more importance to recent prices.",
    how: "EMA = Close × k + Prior EMA × (1 − k), k = 2/(N+1)",
    unit: "₹",
    tags: ["tech"],
  },
  "zscore": {
    what: "Z-score — how many standard deviations the current value is from its rolling mean.",
    how: "(Value − Mean) ÷ Standard Deviation",
    unit: "",
    goodBad: "ABOVE +2 = EXTREME HIGH; BELOW −2 = EXTREME LOW — MEAN-REVERSION SIGNAL",
    tags: ["tech"],
  },
  "velocity": {
    what: "OLS slope normalised by rolling volatility — trend strength per unit of noise.",
    how: "OLS slope of N-period window ÷ rolling std of 2N window",
    unit: "",
    goodBad: "ABOVE 0 = UPTREND; BELOW 0 = DOWNTREND; MAGNITUDE = CONFIDENCE",
    tags: ["tech"],
  },
  "percentrank": {
    what: "Percentile rank of the current value within a rolling window.",
    how: "Percentage of values in window less than current value",
    unit: "%",
    goodBad: "ABOVE 80 = NEAR HIGHS; BELOW 20 = NEAR LOWS",
    tags: ["tech"],
  },
  "true range": {
    what: "Largest of three price ranges: H−L, |H−PrevC|, |L−PrevC|.",
    how: "max(High − Low, |High − Prior Close|, |Low − Prior Close|)",
    unit: "₹",
    tags: ["tech"],
  },
  "confluence score": {
    what: "Composite technical score aggregating multiple indicators into one signal.",
    how: "Weighted average of RSI, MACD, ADX, Bollinger, Stochastic signals",
    unit: "",
    goodBad: "ABOVE +3 = STRONG BULLISH CONFLUENCE; BELOW −3 = STRONG BEARISH",
    tags: ["tech"],
  },
  "divergence": {
    what: "When price makes a new high/low but an indicator does not — signals potential reversal.",
    how: "Compare direction of price vs direction of RSI/MACD/other indicator",
    unit: "",
    goodBad: "BEARISH DIVERGENCE = PRICE UP, INDICATOR DOWN; BULLISH = OPPOSITE",
    tags: ["tech"],
  },
  "20dma": {
    what: "20-day Moving Average — short-term trend proxy, used as dynamic support/resistance.",
    how: "SMA of closing prices over 20 trading days",
    unit: "₹",
    goodBad: "PRICE ABOVE 20DMA = SHORT-TERM UPTREND; BELOW = DOWNTREND",
    tags: ["tech"],
  },
  "50dma": {
    what: "50-day Moving Average — medium-term trend proxy.",
    how: "SMA of closing prices over 50 trading days",
    unit: "₹",
    goodBad: "50DMA CROSSING ABOVE 200DMA = GOLDEN CROSS; BELOW = DEATH CROSS",
    tags: ["tech"],
  },
  "200dma": {
    what: "200-day Moving Average — long-term trend and bull/bear regime divider.",
    how: "SMA of closing prices over 200 trading days",
    unit: "₹",
    goodBad: "PRICE ABOVE 200DMA = BULL MARKET; BELOW = BEAR MARKET",
    tags: ["tech"],
  },

  // ────────────────────────── OPTIONS & DERIVATIVES ──────────────────────────

  "delta": {
    what: "Rate of change of option price per ₹1 move in the underlying.",
    how: "∂Price/∂S from Black-Scholes",
    unit: "",
    goodBad: "DELTA ≈ 1 = MOVE LIKE STOCK; ≈ 0 = DECAY-ONLY; NEGATIVE = INVERSE",
    tags: ["options"],
  },
  "gamma": {
    what: "Rate of change of delta per ₹1 move in the underlying.",
    how: "∂Delta/∂S from Black-Scholes",
    unit: "",
    goodBad: "HIGH GAMMA NEAR EXPIRY AT ATM = PIN RISK AND SHARP MOVES",
    tags: ["options"],
  },
  "theta": {
    what: "Daily time decay of option value — the cost of holding the position.",
    how: "∂Price/∂T (days) from Black-Scholes",
    unit: "₹",
    goodBad: "NEGATIVE = DECAYING (BUYER PAYS); POSITIVE = COLLECTING (SELLER EARNS)",
    tags: ["options"],
  },
  "vega": {
    what: "Sensitivity of option price to 1 percentage point change in implied volatility.",
    how: "∂Price/∂σ from Black-Scholes",
    unit: "₹",
    goodBad: "HIGH VEGA = VOL EXPANSION BENEFITS LONG OPTIONS; CRUSH HURTS",
    tags: ["options"],
  },
  "rho": {
    what: "Sensitivity of option price to 1 percentage point change in interest rates.",
    how: "∂Price/∂r from Black-Scholes",
    unit: "₹",
    tags: ["options"],
  },
  "vanna": {
    what: "Sensitivity of delta to changes in implied volatility.",
    how: "∂Delta/∂σ from Black-Scholes",
    unit: "",
    goodBad: "NEGATIVE VANNA + SHORT GAMMA = DEALER HEDGING AMPLIFIES VOL-DRIVEN SELLOFFS",
    tags: ["options"],
  },
  "vomma": {
    what: "Sensitivity of vega to changes in implied volatility — the convexity of vega.",
    how: "∂Vega/∂σ from Black-Scholes",
    unit: "",
    tags: ["options"],
  },
  "charm": {
    what: "Rate of change of delta per day — how delta decays with time.",
    how: "∂Delta/∂T from Black-Scholes",
    unit: "",
    goodBad: "CHARM CAUSES DELTA TO DRIFT TOWARD 0.5 (ATM) AS EXPIRY APPROACHES",
    tags: ["options"],
  },
  "speed": {
    what: "Sensitivity of gamma to changes in the underlying price.",
    how: "∂Gamma/∂S from Black-Scholes",
    unit: "",
    tags: ["options"],
  },
  "implied volatility": {
    what: "The volatility implied by current market option prices — forward-looking.",
    how: "Backed out from Black-Scholes using market option price",
    unit: "%",
    goodBad: "HIGH IV = EXPENSIVE OPTIONS; LOW IV = CHEAP OPTIONS",
    tags: ["options"],
  },
  "historical volatility": {
    what: "Realised volatility of past returns — backward-looking.",
    how: "Annualised standard deviation of log returns over N days",
    unit: "%",
    goodBad: "HV < IV = OPTIONS OVERPRICED RELATIVE TO REALISED; HV > IV = UNDERPRICED",
    tags: ["options"],
  },
  "iv percentile": {
    what: "Where current IV sits relative to its N-day range — percentile rank.",
    how: "Percentage of historical IV readings below current IV",
    unit: "%",
    goodBad: "ABOVE 80 = IV IN TOP 20% OF RANGE (EXPENSIVE); BELOW 20 = CHEAP",
    tags: ["options"],
  },
  "iv rank": {
    what: "Where current IV sits between its 52-week high and low.",
    how: "(Current IV − 52W Low) ÷ (52W High − 52W Low) × 100",
    unit: "%",
    tags: ["options"],
  },
  "put call ratio": {
    what: "Ratio of put open interest to call open interest — sentiment gauge.",
    how: "Total Put OI ÷ Total Call OI",
    unit: "",
    goodBad: "ABOVE 1 = BEARISH SENTIMENT; BELOW 0.7 = BULLISH CROWDING. CONTRARIAN AT EXTREMES.",
    tags: ["options"],
  },
  "max pain": {
    what: "Strike price where the most open option contracts expire worthless.",
    how: "Strike with highest total OI (call + put) for the expiry",
    unit: "₹",
    goodBad: "PRICE TENDS TO GRAVITATE TOWARD MAX PAIN NEAR EXPIRY AS WRITERS HEDGE",
    tags: ["options"],
  },
  "gamma wall": {
    what: "Strike where aggregate dealer gamma exposure is highest — pin risk zone.",
    how: "Strike with max(gamma × total OI) across calls and puts",
    unit: "₹",
    goodBad: "PRICE WITHIN 50 PTS OF GAMMA WALL = EXPECT PINNING/CHOP",
    tags: ["options"],
  },
  "iv skew": {
    what: "Difference between put IV and call IV at the same moneyness — fear/greed gauge.",
    how: "ATM Put IV − ATM Call IV",
    unit: "%",
    goodBad: "HIGH POSITIVE SKEW = FEAR PRICING; HIGH NEGATIVE = BREAKOUT DEMAND",
    tags: ["options"],
  },
  "open interest": {
    what: "Total number of outstanding option contracts that have not been settled.",
    how: "Sum of all open long/short positions for a strike",
    unit: "contracts",
    goodBad: "HIGH OI AT A STRIKE = LIQUIDITY AND POTENTIAL SUPPORT/RESISTANCE",
    tags: ["options"],
  },
  "oi change": {
    what: "Change in open interest from the previous session — new positions vs closures.",
    how: "Today's OI − Yesterday's OI",
    unit: "contracts",
    goodBad: "OI UP + PRICE UP = NEW BUYING; OI UP + PRICE DOWN = NEW SHORTING",
    tags: ["options"],
  },
  "expected move": {
    what: "The expected price range over a given period based on ATR or implied vol.",
    how: "ATR-14 for 1-day; ATR-14 × √5 for 1-week",
    unit: "₹",
    goodBad: "USE AS STOP-LOSS GUIDES — BREAKOUTS BEYOND EXPECTED MOVE ARE SIGNIFICANT",
    tags: ["options"],
  },
  "breakeven": {
    what: "The price at which an option position breaks even at expiry.",
    how: "Call: K + Premium; Put: K − Premium",
    unit: "₹",
    tags: ["options"],
  },
  "payoff": {
    what: "Profit/loss of an option position at different underlying prices at expiry.",
    how: "max(S−K, 0) − Premium (call); max(K−S, 0) − Premium (put)",
    unit: "₹",
    tags: ["options"],
  },
  "intrinsic value": {
    what: "The in-the-money portion of an option's price.",
    how: "Call: max(S−K, 0); Put: max(K−S, 0)",
    unit: "₹",
    tags: ["options"],
  },
  "extrinsic value": {
    what: "The time-value portion of an option's price, above intrinsic value.",
    how: "Option Price − Intrinsic Value",
    unit: "₹",
    goodBad: "EXTRINSIC DECAYS TO ZERO AT EXPIRY — SELLERS BENEFIT, BUYERS PAY",
    tags: ["options"],
  },
  "moneyness": {
    how: "S ÷ K for calls; K ÷ S for puts",
    what: "Ratio of underlying price to strike price — determines intrinsic value.",
    unit: "",
    tags: ["options"],
  },
  "dte": {
    what: "Days to expiry — the time remaining before the option contract expires.",
    how: "Calendar days from today to expiry date",
    unit: "days",
    goodBad: "LOW DTE = HIGH TIME DECAY; OPTIONS LOSE VALUE FASTER AS DTE APPROACHES 0",
    tags: ["options"],
  },
  "lot size": {
    what: "Minimum number of shares per options contract on NSE.",
    how: "NSE-specified lot size per symbol, revised periodically",
    unit: "shares",
    indiaNote: "NSE lot sizes change with price; check NSE website for current lot sizes.",
    tags: ["options", "market"],
  },
  "rollover": {
    what: "Closing a near-month position and re-opening it in the next expiry.",
    how: "Sell near-month + Buy far-month (for long positions)",
    unit: "",
    goodBad: "HIGH ROLLOVER COST = CONTANGO TERM STRUCTURE; NEGATIVE = BACKWARDATION",
    tags: ["options"],
  },
  "basis": {
    what: "Difference between spot price and futures price.",
    how: "Futures Price − Spot Price",
    unit: "₹",
    goodBad: "POSITIVE BASIS (CONTANGO) = COST OF CARRY; NEGATIVE (BACKWARDATION) = SUPPLY SQUEEZE",
    tags: ["options"],
  },

  // ────────────────────────── RISK & QUANT ──────────────────────────

  "sharpe ratio": {
    what: "Risk-adjusted return — excess return per unit of volatility.",
    how: "(Portfolio Return − Risk-Free Rate) ÷ Portfolio Volatility, annualised",
    unit: "x",
    goodBad: "ABOVE 1 IS GOOD; ABOVE 2 IS EXCELLENT. COMPARE WITHIN SAME ASSET CLASS.",
    tags: ["risk"],
  },
  "sortino ratio": {
    what: "Risk-adjusted return penalising only downside volatility.",
    how: "(Portfolio Return − Risk-Free Rate) ÷ Downside Deviation, annualised",
    unit: "x",
    goodBad: "ABOVE 1.5 IS STRONG; HIGHER THAN SHARPE = PORTFOLIO HAS UPSIDE VOL",
    tags: ["risk"],
  },
  "calmar ratio": {
    what: "Annualised return divided by maximum drawdown — reward per unit of worst-case pain.",
    how: "Annualised Return ÷ |Max Drawdown|",
    unit: "x",
    goodBad: "ABOVE 1 IS GOOD; ABOVE 3 IS EXCELLENT",
    tags: ["risk"],
  },
  "max drawdown": {
    what: "Largest peak-to-trough decline in portfolio value.",
    how: "max((Peak − Trough) ÷ Peak) over all drawdown periods",
    unit: "%",
    goodBad: "BELOW 10% = SHALLOW; ABOVE 30% = SEVERE; RECOVERY TIME MATTERS TOO",
    tags: ["risk"],
  },
  "var 95": {
    what: "Value at Risk at 95% confidence — maximum expected loss on 95% of days.",
    how: "5th percentile of historical or parametric return distribution",
    unit: "%",
    goodBad: "A ₹10L PORTFOLIO WITH 2.5% VAR = ₹2.5L LOSS ON A BAD DAY, 1 IN 20",
    tags: ["risk"],
  },
  "cvar": {
    what: "Conditional VaR (Expected Shortfall) — average loss in the worst 5% of scenarios.",
    how: "Mean of returns below VaR threshold",
    unit: "%",
    goodBad: "WORSE THAN VaR — CAPTURES TAIL RISK",
    tags: ["risk"],
  },
  "beta": {
    what: "Sensitivity of stock returns to benchmark returns.",
    how: "Covariance(Stock, Benchmark) ÷ Variance(Benchmark)",
    unit: "",
    goodBad: "BETA > 1 = MORE VOLATILE THAN MARKET; < 1 = LESS VOLATILE; < 0 = INVERSE",
    tags: ["risk"],
  },
  "alpha": {
    what: "Excess return of a stock/portfolio above what beta predicts.",
    how: "Portfolio Return − (Risk-Free Rate + Beta × Benchmark Excess Return)",
    unit: "%",
    goodBad: "POSITIVE ALPHA = OUTPERFORMANCE NOT EXPLAINED BY MARKET EXPOSURE",
    tags: ["risk"],
  },
  "r squared": {
    what: "How much of a stock's variance is explained by benchmark variance.",
    how: "Correlation² between stock and benchmark returns",
    unit: "",
    goodBad: "ABOVE 0.8 = HIGHLY CORRELATED TO MARKET; BELOW 0.3 = INDEPENDENT",
    tags: ["risk"],
  },
  "kelly criterion": {
    what: "Optimal bet size to maximise long-run growth rate.",
    how: "f* = p − q/b where p = win rate, b = avg win ÷ avg loss",
    unit: "%",
    goodBad: "USE HALF-KELLY FOR REAL PORTFOLIOS — FULL KELLY IS TOO AGGRESSIVE",
    tags: ["risk"],
  },
  "hurst exponent": {
    what: "Measures long-term memory in a time series — trending vs mean-reverting.",
    how: "H = log(R/S) ÷ log(n)",
    unit: "",
    goodBad: "H > 0.5 = TRENDING; H < 0.5 = MEAN-REVERTING; H ≈ 0.5 = RANDOM WALK",
    tags: ["risk"],
  },
  "profit factor": {
    what: "Gross profits divided by gross losses — overall trade quality.",
    how: "Sum of Winning Trades ÷ |Sum of Losing Trades|",
    unit: "x",
    goodBad: "ABOVE 1.5 = PROFITABLE EDGE; BELOW 1 = NET LOSING",
    tags: ["risk"],
  },
  "win rate": {
    what: "Percentage of trades that are profitable.",
    how: "Winning Trades ÷ Total Trades × 100",
    unit: "%",
    goodBad: "ABOVE 50% IS GOOD IF RISK:REWARD > 1:1; BELOW 40% NEEDS HIGH R:R",
    tags: ["risk"],
  },
  "ewma vol": {
    what: "Exponentially weighted moving average volatility — recent-data-weighted.",
    how: "EWMA with λ=0.94, σ² = λσ² + (1−λ)r²",
    unit: "%",
    tags: ["risk"],
  },
  "garch": {
    what: "Generalised Autoregressive Conditional Heteroskedasticity — volatility clustering model.",
    how: "σ² = ω + αε² + βσ² (GARCH(1,1))",
    unit: "%",
    goodBad: "PERSISTENCE (α+β) CLOSE TO 1 = VOL CLUSTERING; HIGH PERSISTENCE = LONG MEMORY",
    tags: ["risk"],
  },
  "half life": {
    what: "Mean-reversion speed of a spread from AR(1) regression.",
    how: "−ln(2) ÷ β where β is AR(1) coefficient on lagged spread",
    unit: "days",
    goodBad: "LOW HALF-LIFE = FAST REVERSION (PAIRS TRADE CANDIDATE); HIGH = SLOW/UNRELIABLE",
    tags: ["risk"],
  },
  "cointegration": {
    what: "Two series share a long-term equilibrium — they move together despite short-term divergence.",
    how: "Engle-Granger or Johansen test on price levels (not returns)",
    unit: "",
    goodBad: "COINTEGRATED PAIRS ARE PAIRS-TRADE CANDIDATES; CORRELATION ALONE IS NOT ENOUGH",
    tags: ["risk"],
  },
  "max drawdown duration": {
    what: "Longest time from a peak to recovery to a new peak.",
    how: "Trading days from peak to next new high",
    unit: "days",
    goodBad: "LONG DRAWDOWNS = EMOTIONALLY AND FINANCIALLY COSTLY",
    tags: ["risk"],
  },
  "ulcer index": {
    what: "Volatility of drawdowns — measures downside pain.",
    how: "RMS of rolling drawdowns over N periods",
    unit: "%",
    goodBad: "LOW = SMOOTH RIDE; HIGH = VOLATILE DRAWDOWNS",
    tags: ["risk"],
  },
  "tail index": {
    what: "Measures how fat the tails of the return distribution are.",
    how: "Hill estimator on extreme negative returns",
    unit: "",
    goodBad: "LOW TAIL INDEX = FATTER TAILS = MORE EXTREME LOSSES THAN NORMAL",
    tags: ["risk"],
  },
  "cornish fisher": {
    what: "Volatility adjustment for skewness and kurtosis in VaR calculation.",
    how: "VaR_CF = μ + σ × (z + (z²−1)S/6 + (z³−3z)K/24 − (2z³−5z)S²/36)",
    unit: "",
    tags: ["risk"],
  },

  // ────────────────────────── FORENSIC ──────────────────────────

  "beneish m score": {
    what: "Earnings manipulation probability from 8 accrual-based indices.",
    how: "M = −4.84 + 0.92×DSRI + 0.528×GMI + 0.404×AQI + 0.892×SGI + 0.115×DEPI − 0.172×SGAI + 4.679×TATA − 0.327×LVGI",
    unit: "",
    goodBad: "ABOVE −1.78 = LIKELY MANIPULATOR; BELOW = CLEANER EARNINGS",
    tags: ["forensic"],
  },
  "altman z score": {
    what: "Bankruptcy probability score from 5 weighted financial ratios.",
    how: "Z = 1.2×X1 + 1.4×X2 + 3.3×X3 + 0.6×X4 + 1.0×X5",
    unit: "",
    goodBad: "ABOVE 2.99 = SAFE; 1.81–2.99 = GREY ZONE; BELOW 1.81 = DISTRESS",
    tags: ["forensic"],
  },
  "piotroski f score": {
    what: "9-check financial strength score from balance sheet and income statement.",
    how: "Sum of 9 binary signals (profitability, leverage, efficiency)",
    unit: "",
    goodBad: "7–9 = STRONG; 0–3 = DISTRESSED. USE AS A SCREEN, NOT A VERDICT.",
    tags: ["forensic"],
  },
  "sloan accruals": {
    what: "Gap between accounting profit and cash flow — accrual component of earnings.",
    how: "(Net Income − Operating Cash Flow) ÷ Total Assets",
    unit: "%",
    goodBad: "HIGH ACCRUALS = LOW EARNINGS QUALITY; FUTURE EARNINGS MAY REVERSE",
    tags: ["forensic"],
  },
  "dsri": {
    what: "Days Sales in Receivables Index — change in revenue recognition efficiency.",
    how: "(Receivables/Revenue)_Current ÷ (Receivables/Revenue)_Prior",
    unit: "x",
    goodBad: "DSRI > 1 = RECEIVABLES GROWING FASTER THAN REVENUE = REVENUE INFLATION RISK",
    tags: ["forensic"],
  },
  "gmi": {
    what: "Gross Margin Index — change in gross margin.",
    how: "Gross Margin_Prior ÷ Gross Margin_Current",
    unit: "x",
    goodBad: "GMI > 1 = MARGIN DETERIORATION",
    tags: ["forensic"],
  },
  "aqi": {
    what: "Asset Quality Index — change in non-current asset proportion.",
    how: "(1 − (Current Assets + PPE))/Assets_Current ÷ same_Prior",
    unit: "x",
    tags: ["forensic"],
  },
  "sgi": {
    what: "Sales Growth Index — revenue growth.",
    how: "Revenue_Current ÷ Revenue_Prior",
    unit: "x",
    goodBad: "SGI > 1 = GROWING; EXTREMELY HIGH = AGGRESSIVE RECOGNITION RISK",
    tags: ["forensic"],
  },
  "depi": {
    what: "Depreciation Index — change in depreciation method.",
    how: "Depreciation Rate_Prior ÷ Depreciation Rate_Current",
    unit: "x",
    tags: ["forensic"],
  },
  "sgai": {
    what: "SGA Expense Index — change in expense-to-sales ratio.",
    how: "(SGA/Revenue)_Current ÷ (SGA/Revenue)_Prior",
    unit: "x",
    tags: ["forensic"],
  },
  "tata": {
    what: "Total Accruals to Total Assets — cash-flow vs earnings gap.",
    how: "(Income Before Extraordinary − CFO) ÷ Total Assets",
    unit: "",
    goodBad: "HIGH TATA = ACCRUAL-HEAVY EARNINGS = LOW QUALITY",
    tags: ["forensic"],
  },
  "lvgi": {
    what: "Leverage Index — change in financial leverage.",
    how: "(Total Liabilities/Assets)_Current ÷ same_Prior",
    unit: "x",
    goodBad: "LVGI > 1 = INCREASING LEVERAGE",
    tags: ["forensic"],
  },
  "cash conversion": {
    what: "How efficiently accounting profit converts to cash.",
    how: "Operating Cash Flow ÷ Net Income",
    unit: "x",
    goodBad: "ABOVE 1 = CASH-BACKED EARNINGS; BELOW 0.7 = EARNINGS MAY BE INFLATED",
    tags: ["forensic"],
  },
  "quality of earnings": {
    what: "Proportion of earnings backed by operating cash flow.",
    how: "OCF ÷ Net Income",
    unit: "x",
    goodBad: "ABOVE 1 = HIGH QUALITY; BELOW 0.5 = LOW QUALITY — INVESTIGATE",
    tags: ["forensic"],
  },

  // ────────────────────────── MACRO ──────────────────────────

  "cpi": {
    what: "Consumer Price Index — headline inflation gauge for India.",
    how: "Weighted average of a basket of goods and services",
    unit: "%",
    indiaNote: "RBI targets 4% ± 2%; above 6% triggers emergency rate action.",
    goodBad: "ABOVE TARGET = HAWKISH RBI; BELOW = DOVISH CUTS LIKELY",
    tags: ["macro"],
  },
  "wpi": {
    what: "Wholesale Price Index — producer-level inflation.",
    how: "Price change of goods at wholesale level",
    unit: "%",
    indiaNote: "Being phased out in India; CPI is now the primary inflation target.",
    tags: ["macro"],
  },
  "iip": {
    what: "Index of Industrial Production — monthly manufacturing output gauge.",
    how: "Volume index of industrial output, base year 2011-12",
    unit: "",
    indiaNote: "Published by MOSPI; volatile month-to-month, use 3-month average.",
    tags: ["macro"],
  },
  "gdp": {
    what: "Gross Domestic Product — total value of all goods and services produced.",
    how: "GVA + Net Taxes (at factor cost for India)",
    unit: "₹ Cr",
    indiaNote: "India reports GDP at basic prices (GDP-B) from FY15 series; compare like-for-like.",
    goodBad: "ABOVE 6% = ABOVE-TREND GROWTH; BELOW 4% = STRESS",
    tags: ["macro"],
  },
  "gva": {
    what: "Gross Value Added — GDP minus net product taxes, sector-level output.",
    how: "GDP at basic prices",
    unit: "₹ Cr",
    tags: ["macro"],
  },
  "repo rate": {
    what: "RBI's policy rate at which it lends to banks — the base for all lending rates.",
    how: "Set by RBI Monetary Policy Committee (6 members, 6× yearly)",
    unit: "%",
    indiaNote: "Current rate: check RBI website. Changes move bond yields and banking stocks.",
    goodBad: "HIKING = TIGHTENING; CUTTING = EASING — BOTH MOVE EQUITIES AND BONDS",
    tags: ["macro"],
  },
  "crr": {
    what: "Cash Reserve Ratio — percentage of deposits banks must keep with RBI.",
    how: "Percentage of net demand and time liabilities",
    unit: "%",
    indiaNote: "CRR cuts free up bank liquidity for lending; hikes do the opposite.",
    tags: ["macro"],
  },
  "slr": {
    what: "Statutory Liquidity Ratio — percentage of deposits banks must invest in government securities.",
    how: "Percentage of NDTL in G-Secs, T-bills, cash",
    unit: "%",
    tags: ["macro"],
  },
  "10y g sec": {
    what: "10-year Government of India bond yield — the risk-free rate benchmark.",
    how: "Yield on 10Y GOI bonds",
    unit: "%",
    goodBad: "RISING = BONDS SELLING OFF (RISK); FALLING = FLIGHT TO SAFETY OR EASING",
    tags: ["macro"],
  },
  "term spread": {
    what: "Gap between long-term and short-term government bond yields.",
    how: "10Y Yield − 91-day T-Bill Yield",
    unit: "bps",
    goodBad: "WIDENING = GROWTH OPTIMISM; INVERTING = RECESSION WARNING",
    tags: ["macro"],
  },
  "dxy": {
    what: "US Dollar Index — strength of USD against a basket of 6 currencies.",
    how: "Weighted geometric mean of USD vs EUR, JPY, GBP, CAD, SEK, CHF",
    unit: "",
    goodBad: "RISING DXY = STRONG USD = EM OUTFLOWS, COMMODITY WEAKNESS",
    tags: ["macro"],
  },
  "brent": {
    what: "Brent crude oil price — global energy benchmark affecting India's import bill.",
    how: "ICE Futures Brent crude front-month contract",
    unit: "$/bbl",
    indiaNote: "India imports ~85% of oil; rising Brent = CAD widening + inflation + INR pressure.",
    goodBad: "ABOVE $80 = HEADWIND FOR INDIA; BELOW $60 = TAILWIND",
    tags: ["macro"],
  },
  "usdinr": {
    what: "USD/INR exchange rate — US dollar price in Indian rupees.",
    how: "RBI reference rate or spot market",
    unit: "₹",
    indiaNote: "RBI intervenes to manage volatility; sharp moves trigger RBI commentary.",
    goodBad: "RISING = INR DEPRECIATION = FII OUTFLOWS, IMPORT COST INFLATION",
    tags: ["macro"],
  },
  "fii flows": {
    what: "Foreign Institutional Investor net purchases/sales of Indian equities.",
    how: "NSE FII/DII data — net buy/sell in cash market",
    unit: "₹ Cr",
    goodBad: "SUSTAINED FII BUYING = BULLISH; SUSTAINED SELLING = BEARISH PRESSURE",
    tags: ["macro"],
  },
  "dii flows": {
    what: "Domestic Institutional Investor net purchases/sales — mutual funds, insurance, banks.",
    how: "NSE FII/DII data — net buy/sell in cash market",
    unit: "₹ Cr",
    goodBad: "DII BUYING DURING FII SELLING = DOMESTIC ABSORPTION = SUPPORTIVE",
    tags: ["macro"],
  },
  "jobless claims": {
    what: "Initial unemployment insurance claims — new filings for unemployment benefits in the US.",
    how: "Weekly DOL release",
    unit: "K",
    goodBad: "SPIKE ABOVE 300K = RED FLAG FOR US ECONOMY; LOW = TIGHT LABOR MARKET",
    tags: ["macro"],
  },
  "nfp payrolls": {
    what: "Non-farm payrolls — net new jobs added in the US economy.",
    how: "BLS establishment survey, monthly first Friday",
    unit: "K",
    goodBad: "ABOVE 200K = HEALTHY; BELOW 100K = WEAKENING; NEGATIVE = RECESSION RISK",
    tags: ["macro"],
  },
  "unemployment rate": {
    what: "Percentage of the US labor force that is jobless and actively seeking work.",
    how: "BLS household survey",
    unit: "%",
    goodBad: "BELOW 4% = TIGHT LABOR MARKET; RISING TREND = WEAKENING ECONOMY",
    tags: ["macro"],
  },

  // ────────────────────────── MARKET STRUCTURE ──────────────────────────

  "a d ratio": {
    what: "Advance-Decline ratio — number of stocks advancing vs declining.",
    how: "Stocks Closing Higher ÷ Stocks Closing Lower",
    unit: "",
    goodBad: "ABOVE 1 = BROAD RALLY; BELOW 1 = BROAD SELLOFF; EXTREMES = BREADTH EXHAUSTION",
    tags: ["market"],
  },
  "breadth": {
    what: "Percentage of stocks trading above their 20-day moving average.",
    how: "Count(Stocks Above 20DMA) ÷ Total Stocks × 100",
    unit: "%",
    goodBad: "ABOVE 70% = STRONG BREADTH; BELOW 30% = WEAK BREADTH",
    tags: ["market"],
  },
  "% above 20dma": {
    what: "Percentage of index constituents trading above their 20-day moving average.",
    how: "Nifty 50 stocks above 20DMA ÷ 50 × 100",
    unit: "%",
    tags: ["market"],
  },
  "bulk deal": {
    what: "A single trade of more than 5 lakh shares or ₹10 crore — reported on NSE.",
    how: "NSE bulk deal disclosure",
    unit: "",
    indiaNote: "Institutional activity; large block deals may indicate FII/DII repositioning.",
    tags: ["market"],
  },
  "block deal": {
    what: "A pre-negotiated trade of at least 5 lakh shares or ₹10 crore, done off-market.",
    how: "NSE block deal window — reported with a delay",
    unit: "",
    tags: ["market"],
  },
  "circuit limit": {
    what: "SEBI-mandated price band: ±5%, ±10%, or ±20% from previous close.",
    how: "Percentage-based circuit breakers per exchange",
    unit: "%",
    indiaNote: "Stocks hitting upper circuit = no sellers; lower circuit = no buyers.",
    tags: ["market"],
  },
  "asm": {
    what: "Additional Surveillance Measure — SEBI framework to curb speculative trading.",
    how: "ASM stage I–IV based on price/volume parameters",
    unit: "",
    indiaNote: "Higher ASM stages = higher margin requirements, which cool off speculative activity.",
    tags: ["market"],
  },
  "gsm": {
    what: "Graded Surveillance Measure — monitors stocks for unusual price movement.",
    how: "GSM stages I–IV based on price-to-value deviation",
    unit: "",
    tags: ["market"],
  },
  "f&o ban": {
    what: "Stock banned from F&O trading when open interest exceeds limits.",
    how: "NSE bans F&O when aggregate OI crosses threshold",
    unit: "",
    indiaNote: "Ban period: no new positions, only square-off. Reverse ban adds premium.",
    tags: ["market"],
  },
  "rollover %": {
    what: "Percentage of near-month F&O positions rolled to the next expiry.",
    how: "Far-month OI ÷ (Near-month OI + Far-month OI) × 100",
    unit: "%",
    goodBad: "ABOVE 80% = HIGH ROLLOVER; LOW = CLOSING POSITIONS",
    tags: ["market"],
  },
  "200day ema": {
    what: "200-day Exponential Moving Average — long-term regime divider.",
    how: "EMA of closing prices over 200 trading days",
    unit: "₹",
    goodBad: "ABOVE = BULL MARKET; BELOW = BEAR MARKET",
    tags: ["tech"],
  },

  // ────────────────────────── VALUATION MULTIPLES ──────────────────────────

  "pe ratio x": {
    what: "Price-to-Earnings ratio — how many years of current earnings the market is paying for.",
    how: "Market Price ÷ Diluted EPS",
    unit: "x",
    goodBad: "ABOVE SECTOR MEDIAN = PREMIUM EXPECTATION; BELOW = VALUE OR PROBLEM",
    tags: ["ratio"],
  },
  "pb ratio x": {
    what: "Price-to-Book ratio — market price relative to net asset value per share.",
    how: "Market Price ÷ Book Value Per Share",
    unit: "x",
    goodBad: "ABOVE 3X FOR BANKS IS EXPENSIVE; BELOW 1X = POSSIBLE VALUE OR IMPAIRMENT",
    tags: ["ratio"],
  },
  "ev ebitda x": {
    what: "Enterprise Value to EBITDA — total firm value per unit of operating cash flow.",
    how: "(Market Cap + Debt − Cash) ÷ EBITDA",
    unit: "x",
    goodBad: "BELOW 10X IS CHEAP; ABOVE 20X IS EXPENSIVE — SECTOR-DEPENDENT",
    tags: ["ratio"],
  },
  "ev sales x": {
    what: "Enterprise Value to Revenue — firm value per unit of sales.",
    how: "(Market Cap + Debt − Cash) ÷ Total Revenue",
    unit: "x",
    tags: ["ratio"],
  },
  "ev ebit x": {
    what: "Enterprise Value to EBIT — firm value per unit of operating profit.",
    how: "(Market Cap + Debt − Cash) ÷ EBIT",
    unit: "x",
    tags: ["ratio"],
  },
  "fcf yield %": {
    what: "Free cash flow yield — FCF per share as a percentage of market price.",
    how: "(Free Cash Flow ÷ Market Cap) × 100",
    unit: "%",
    goodBad: "ABOVE 5% = ATTRACTIVE; BELOW 2% = EXPENSIVE OR LOW FCF",
    tags: ["ratio"],
  },
  "dividend yield %": {
    what: "Annual dividend per share as a percentage of market price.",
    how: "(Dividend Per Share ÷ Market Price) × 100",
    unit: "%",
    goodBad: "ABOVE 3% = HIGH YIELD; VERY HIGH (>8%) = SUSPICIOUS OR DISTRESSED",
    tags: ["ratio"],
  },
  "enterprise value": {
    what: "Total value of the firm to all capital providers.",
    how: "Market Cap + Total Debt − Cash & Equivalents",
    unit: "₹ Cr",
    tags: ["ratio"],
  },
  "market cap": {
    what: "Total market value of all outstanding shares.",
    how: "Share Price × Shares Outstanding",
    unit: "₹ Cr",
    tags: ["ratio"],
  },

  // ────────────────────────── OPTIONS STRATEGIES ──────────────────────────

  "long call": {
    what: "Buying a call option — profits if the stock rises above strike + premium.",
    how: "Pay premium; max loss = premium; max profit = unlimited",
    category: "Debit",
    tags: ["options"],
  },
  "long put": {
    what: "Buying a put option — profits if the stock falls below strike − premium.",
    how: "Pay premium; max loss = premium; max profit = K − premium (substantial)",
    category: "Debit",
    tags: ["options"],
  },
  "bull call spread": {
    what: "Buy ATM call + sell OTM call — capped upside, lower cost.",
    how: "Max profit = width − net debit; max loss = net debit",
    category: "Debit",
    tags: ["options"],
  },
  "bear put spread": {
    what: "Buy ATM put + sell OTM put — capped downside profit, lower cost.",
    how: "Max profit = width − net debit; max loss = net debit",
    category: "Debit",
    tags: ["options"],
  },
  "bull put spread": {
    what: "Sell OTM put + buy further OTM put — collects credit, profits if stock stays above short put.",
    how: "Max profit = net credit; max loss = width − net credit",
    category: "Credit",
    tags: ["options"],
  },
  "bear call spread": {
    what: "Sell OTM call + buy further OTM call — collects credit, profits if stock stays below short call.",
    how: "Max profit = net credit; max loss = width − net credit",
    category: "Credit",
    tags: ["options"],
  },
  "long straddle": {
    what: "Buy ATM call + ATM put — profits from a large move in either direction.",
    how: "Max profit = unlimited; max loss = total premium; breakeven = K ± premium",
    category: "Volatility",
    tags: ["options"],
  },
  "long strangle": {
    what: "Buy OTM call + OTM put — cheaper than straddle but needs a bigger move.",
    how: "Max profit = unlimited; max loss = total premium",
    category: "Volatility",
    tags: ["options"],
  },
  "short straddle": {
    what: "Sell ATM call + ATM put — profits if stock stays near strike.",
    how: "Max profit = total premium; max loss = unlimited",
    category: "Credit",
    tags: ["options"],
  },
  "short strangle": {
    what: "Sell OTM call + OTM put — wider profit zone than short straddle.",
    how: "Max profit = total premium; max loss = unlimited",
    category: "Credit",
    tags: ["options"],
  },
  "long butterfly": {
    what: "Buy 1 ITM call + sell 2 ATM calls + buy 1 OTM call — profits if stock pins at ATM.",
    how: "Max profit = width − net debit; max loss = net debit",
    category: "Neutral",
    tags: ["options"],
  },
  "iron condor": {
    what: "Sell OTM call spread + sell OTM put spread — collects credit from range-bound movement.",
    how: "Max profit = total credit; max loss = width − total credit",
    category: "Credit",
    tags: ["options"],
  },
  "jade lizard": {
    what: "Sell OTM put + sell OTM call spread — no upside risk if call premium > put spread width.",
    how: "Max profit = total credit; max loss = width of call spread − credit if call side breached",
    category: "Credit",
    tags: ["options"],
  },
  "call backspread": {
    what: "Sell 1 ITM call + buy 2 OTM calls — profits from explosive upside.",
    how: "Max profit = unlimited above upper breakeven; max loss = net debit at ATM",
    category: "Volatility",
    tags: ["options"],
  },
  "put backspread": {
    what: "Sell 1 ITM put + buy 2 OTM puts — profits from a sharp downside crash.",
    how: "Max profit = substantial below lower breakeven; max loss = net debit at ATM",
    category: "Volatility",
    tags: ["options"],
  },

  // ────────────────────────── FOREX / COMMODITY / CROSS-ASSET ──────────────────────────

  "nifty 50": {
    what: "Benchmark NSE index of the 50 largest and most liquid Indian companies.",
    how: "Free-float market-cap weighted index of NSE 50 stocks",
    unit: "",
    goodBad: "ABOVE 200DMA = BULL MARKET REGIME; BELOW = BEAR REGIME",
    tags: ["market"],
  },
  "india vix": {
    what: "India's fear gauge — expected 30-day volatility of Nifty 50 from options prices.",
    how: "NSE-computed from near/far OTM Nifty option prices",
    unit: "",
    goodBad: "ABOVE 20 = HIGH FEAR; BELOW 12 = COMPLACENCY",
    tags: ["market"],
  },
  "sgx nifty": {
    what: "SGX-listed Nifty futures — proxy for next-day Indian market opening.",
    how: "Singapore Exchange Nifty 50 futures",
    unit: "",
    tags: ["market"],
  },

  // ────────────────────────── ACCOUNTING / IND AS ──────────────────────────

  "ind as": {
    what: "Indian Accounting Standards — converged with IFRS, mandatory for listed companies.",
    how: "Set by ICAI, mandated by MCA/SEBI for listed entities",
    unit: "",
    indiaNote: "Key standards: Ind AS 110 (Consolidation), Ind AS 109 (Financial Instruments), Ind AS 16 (PPE).",
    tags: ["pl", "bs"],
  },
  "consolidated": {
    what: "Financials combining parent + all subsidiaries — the full group picture.",
    how: "Per Ind AS 110 — eliminates inter-company transactions",
    unit: "",
    indiaNote: "Always compare consolidated-vs-standalone; consolidated is the primary filing for group companies.",
    tags: ["pl", "bs", "cf"],
  },
  "standalone": {
    what: "Financials of the parent company only, excluding subsidiaries.",
    how: "Individual entity financials under Ind AS",
    unit: "",
    tags: ["pl", "bs", "cf"],
  },
  "deferred tax": {
    what: "Tax effect of timing differences between accounting and tax treatment.",
    how: "Deferred tax assets/liabilities per Ind AS 12",
    unit: "₹ Cr",
    indiaNote: "DTA = future tax benefit; DTL = future tax liability. Tax rate changes cause one-off jumps.",
    tags: ["pl", "bs"],
  },
  "mat credit": {
    what: "Minimum Alternate Tax credit — excess MAT paid over normal tax.",
    how: "MAT paid − Normal tax payable",
    unit: "₹ Cr",
    indiaNote: "MAT credit can be carried forward 10 years under Section 115JAA.",
    tags: ["pl"],
  },
  "ebitda margin": {
    what: "EBITDA as a percentage of revenue — cash operating margin.",
    how: "EBITDA ÷ Revenue × 100",
    unit: "%",
    tags: ["ratio"],
  },
};

// Re-export RATIO_INFO from FundaDesks for backward compat (moved here per spec)
export const RATIO_INFO_COMPAT: Record<string, { what: string; how: string }> = {};
for (const [k, v] of Object.entries(GLOSSARY)) {
  if (v.tags?.includes("ratio") && v.how) {
    RATIO_INFO_COMPAT[k] = { what: v.what, how: v.how };
  }
}
