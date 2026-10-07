import { NextResponse } from "next/server";
import { nseGet } from "@/lib/nse";
import { IST_OFFSET_SEC } from "@/lib/opening";

// Corporate documents hub — the REAL filing record behind module 43.
//
// The desk used to be four outbound links, two of which were dead: screener.in
// /company/<sym>/documents/ 404s, and BSE's announcement API answers 403 to
// anything without a live browser session. A documents hub made of links is not
// a documents hub.
//
// This reads NSE's own corporate-announcements feed, which is the same record
// the exchange publishes and carries, per filing: the subject, the disclosure
// category, the filed PDF on nsearchives, the size, the XBRL flag and — the
// reason this desk is worth building — the company's OWN prose in
// `attchmntText`. On a large issuer 3,300 of 3,356 filings carry it, because
// SEBI's disclosure regime requires the explanation to be filed, not just the
// PDF attached. That text is the management commentary; a formal MD&A chapter
// sits inside the annual-report PDF, which a browser cannot parse, and the desk
// says so rather than pretending otherwise.
//
// WINDOW. The unfiltered feed is ~2.5MB for a single mid-cap, which is a lot
// to pull to show four quarters. NSE honours from_date/to_date as DD-MM-YYYY,
// and the same request drops to ~185 records, so the default window covers
// 18 months — four quarters plus the last AGM plus the annual report that
// goes with it. `?months=` widens it to 36.
//
// VENUE HONESTY. NSE only. A .BO symbol gets ok:false with the reason rather
// than an empty table, because a BSE-only listing has a real filing record we
// cannot reach and silence would read as "no filings exist".

export const revalidate = 900;

export type DocFamily =
  | "RESULTS"
  | "COMMENTARY"
  | "PRESENTATION"
  | "GOVERNANCE"
  | "CAPITAL"
  | "RATING"
  | "CORPORATE"
  | "PRESS"
  | "DISCLOSURE"
  | "ROUTINE";

export interface Filing {
  id: string;
  /** Filing date, IST, YYYY-MM-DD. */
  date: string;
  /** Exchange timestamp as published. */
  ts: string;
  family: DocFamily;
  /** The category NSE filed it under. */
  headline: string;
  /** Category plus the issuer's own qualifier where one was filed. */
  subject: string;
  size: string | null;
  pdf: string | null;
  xbrl: boolean;
  /** Company-filed prose. Clamped to MAX_TEXT with `truncated` set. */
  text: string | null;
  truncated: boolean;
}

export interface FamilyCount {
  key: DocFamily;
  label: string;
  count: number;
  latest: string | null;
}

export interface DocumentsPayload {
  ok: boolean;
  error?: string;
  symbol: string;
  base: string;
  venue: "NSE" | null;
  name: string | null;
  isin: string | null;
  industry: string | null;
  from: string;
  to: string;
  /** Records NSE returned for the window, before the response cap. */
  total: number;
  returned: number;
  /** Filings carrying company prose — the ones worth reading here. */
  withText: number;
  latestAt: string | null;
  families: FamilyCount[];
  filings: Filing[];
  fetchedAtIST: string;
}

const MAX_TEXT = 1400;
const MAX_FILINGS = 220;

/**
 * Family rules, evaluated in order, so the specific patterns are matched before
 * the broad ones. `startsWith` rather than a regex on the whole string: NSE
 * appends the issuer's qualifier after ": " and some categories legitimately
 * contain hyphens, so a split-on-hyphen classifier tears them in half.
 */
const RULES: Array<[DocFamily, string[]]> = [
  ["RESULTS", ["Financial Result", "Financial Results", "Audited financial", "Outcome of Board Meeting", "Intimation of Financial", "Financial Statements"]],
  ["PRESENTATION", ["Investor Presentation", "Presentation", "Corporate Presentation"]],
  [
    "COMMENTARY",
    [
      "Analysts/Institutional Investor",
      "Integrated Filing",
      "Investor Meeting",
      "Investor Call",
      "Management Discussion",
      "MD&A",
      "News Clarification",
      "News Verification",
      "Clarification",
      "Investor Conference",
      "Con. Call",
      "Q&A",
    ],
  ],
  [
    "GOVERNANCE",
    [
      "Shareholders meeting",
      "Shareholder meeting",
      "General Meeting",
      "Postal Ballot",
      "Change in Auditors",
      "Appointment",
      "Resignation",
      "Amendment to AOA",
      "Amendment to MOA",
      "Board Meeting",
      "CSR",
      "Voting",
      "Insider Trading",
    ],
  ],
  [
    "CAPITAL",
    [
      "Dividend",
      "Buyback",
      "ESOP",
      "ESOS",
      "ESPS",
      "Allotment",
      "Record Date",
      "Conversion of",
      "Bonus",
      "Stock Split",
      "Rights Issue",
      "Warrants",
      "Issue of",
      "Redemption",
      "Securities Lending",
    ],
  ],
  ["RATING", ["Credit Rating", "Rating"]],
  [
    "CORPORATE",
    [
      "Acquisition",
      "Demerger",
      "Divestment",
      "Scheme of Arrangement",
      "Product launch",
      "Capacity",
      "Expansion",
      "Capex",
      "Order",
      "Contract",
      "Strikes",
      "Termination",
      "Material Event",
    ],
  ],
  ["PRESS", ["Press Release", "Media Release", "Newspaper", "Copy of Newspaper"]],
  [
    "DISCLOSURE",
    [
      "Disclosure under",
      "Disclosure of",
      "Disclosure Relating",
      "Regulation 30",
      "Regulation 29",
      "Regulation 31",
      "Takeover Regulations",
      "SAST",
      "Substantial Acq",
      "Statement under",
      "FPI",
      "Pledge",
      "Reg.",
      "Shareholding Pattern",
      "Coverage",
    ],
  ],
];

const FAMILY_LABEL: Record<DocFamily, string> = {
  RESULTS: "Results",
  COMMENTARY: "MD&A / Commentary",
  PRESENTATION: "Presentation",
  GOVERNANCE: "Governance",
  CAPITAL: "Capital",
  RATING: "Rating",
  CORPORATE: "Corporate",
  PRESS: "Press",
  DISCLOSURE: "Disclosure",
  ROUTINE: "Routine",
};

function familyOf(headline: string): DocFamily {
  const h = (headline || "").trim();
  for (const [fam, prefixes] of RULES) {
    for (const p of prefixes) if (h.toLowerCase().startsWith(p.toLowerCase())) return fam;
  }
  return "ROUTINE";
}

/** Filed prose arrives with runs of spaces and stray newlines from the exchange. */
function cleanText(t: string): string {
  return t.replace(/\s+/g, " ").trim();
}

function istDateStr(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_SEC * 1000).toISOString().slice(0, 10);
}

function ddmmyyyy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

function emptyPayload(base: string, symbol: string, from: string, to: string, error: string): DocumentsPayload {
  return {
    ok: false,
    error,
    symbol,
    base,
    venue: null,
    name: null,
    isin: null,
    industry: null,
    from,
    to,
    total: 0,
    returned: 0,
    withText: 0,
    latestAt: null,
    families: [],
    filings: [],
    fetchedAtIST: istDateStr(new Date()),
  };
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const raw = (sp.get("symbol") || "").trim().toUpperCase();

  const suffix = raw.match(/\.(NS|BO)$/)?.[1] ?? null;
  const base = suffix ? raw.slice(0, -(suffix.length + 1)) : raw;

  const to = istDateStr(new Date());
  const months = Math.min(36, Math.max(6, Number(sp.get("months") || 18) || 18));
  const fromDate = new Date(new Date(`${to}T00:00:00Z`).getTime() - months * 30.44 * 86400_000);
  const from = istDateStr(fromDate);

  if (!base) {
    return NextResponse.json(emptyPayload(base, raw, from, to, "NO SYMBOL — OPEN THE DESK WITH A TICKER"), { status: 400 });
  }
  if (suffix === "BO") {
    return NextResponse.json(
      emptyPayload(
        base,
        raw,
        from,
        to,
        "BSE LISTING — BSE'S ANNOUNCEMENT API ANSWERS 403 WITHOUT A LIVE BROWSER SESSION, SO NO BSE FILINGS CAN BE READ SERVER-SIDE. OPEN THE EXCHANGE FEEDS BELOW."
      ),
      { status: 200 }
    );
  }

  const url =
    `https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=${encodeURIComponent(base)}` +
    `&from_date=${ddmmyyyy(from)}&to_date=${ddmmyyyy(to)}`;

  let rows: any[];
  try {
    const r = await nseGet(url);
    if (!r.ok) throw new Error(`nse ${r.status}`);
    const j = await r.json();
    if (!Array.isArray(j)) throw new Error("unexpected shape");
    rows = j;
  } catch (e: any) {
    return NextResponse.json(emptyPayload(base, raw, from, to, `NSE FEED UNAVAILABLE — ${e?.message ?? "unknown"}`), { status: 200 });
  }

  const filings: Filing[] = [];
  for (const row of rows) {
    const headline = String(row?.desc ?? "").trim();
    if (!headline) continue;
    const ts = String(row?.sort_date ?? row?.an_dt ?? "");
    const family = familyOf(headline);
    const rawText = typeof row?.attchmntText === "string" ? row.attchmntText : "";
    const cleaned = rawText ? cleanText(rawText) : "";
    const truncated = cleaned.length > MAX_TEXT;
    const pdf = typeof row?.attchmntFile === "string" && row.attchmntFile.startsWith("http") ? row.attchmntFile : null;
    filings.push({
      id: String(row?.seq_id ?? `${ts}-${headline}`),
      date: (ts || "").slice(0, 10) || "—",
      ts,
      family,
      headline: headline.split(":")[0]!.trim(),
      subject: headline.length > 200 ? `${headline.slice(0, 200)}…` : headline,
      size: typeof row?.attFileSize === "string" && row.attFileSize ? row.attFileSize : null,
      pdf,
      xbrl: row?.hasXbrl === true,
      text: cleaned ? (truncated ? `${cleaned.slice(0, MAX_TEXT)}…` : cleaned) : null,
      truncated,
    });
  }

  filings.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));

  const shown = filings.slice(0, MAX_FILINGS);
  const counts = new Map<DocFamily, { count: number; latest: string | null }>();
  for (const f of filings) {
    const cur = counts.get(f.family) ?? { count: 0, latest: null };
    cur.count += 1;
    if (!cur.latest || f.ts > cur.latest) cur.latest = f.ts;
    counts.set(f.family, cur);
  }
  const families: FamilyCount[] = [...counts.entries()]
    .map(([key, v]) => ({ key, label: FAMILY_LABEL[key], count: v.count, latest: v.latest }))
    .sort((a, b) => b.count - a.count);

  const head = rows[0];

  return NextResponse.json({
    ok: filings.length > 0,
    error: filings.length ? undefined : "NO FILINGS IN WINDOW — WIDEN ?MONTHS= UP TO 36 IF THE LISTING IS OLD",
    symbol: raw || base,
    base,
    venue: "NSE",
    name: typeof head?.sm_name === "string" ? head.sm_name : null,
    isin: typeof head?.sm_isin === "string" ? head.sm_isin : null,
    industry: typeof head?.smIndustry === "string" ? head.smIndustry : null,
    from,
    to,
    total: filings.length,
    returned: shown.length,
    withText: filings.filter((f) => f.text).length,
    latestAt: filings[0]?.ts ?? null,
    families,
    filings: shown,
    fetchedAtIST: istDateStr(new Date()),
  });
}