// Politician disclosure sources — one adapter per jurisdiction, plus the pure
// parsers and cohort maths behind them.
//
// THE HONEST FRAMING THIS FILE ENCODES
// =====================================
// "Track a politician's portfolio" means five different things in five different
// places, and a desk that pretends otherwise is lying to the trader. The four
// registries the desk reads are:
//
//   US HOUSE   Office of the Clerk. STOCK ACT periodic transaction reports (PTR)
//              filed within 45 days of a trade, plus an annual FD. The Clerk
//              publishes an INDEX (member, office, filing year, filing type, and
//              a link to the filed PDF). The index is the only machine-readable
//              layer — the asset lines live inside the PDF. VERIFIED: the site
//              exposes no open JSON/XML of PTR holdings, so this desk shows the
//              register and links the PDF rather than fabricating a book.
//
//   US SENATE  Senate eFD search. Unlike the House, eFD DOES answer with JSON
//              (reportInformations[] carrying filerInfo + assets[]/transactions[]),
//              which is where a real ticker/asset-level book comes from. The host
//              sits behind an edge that refuses many datacentre IPs with a 403,
//              so this leg fails OPEN and says the reason in UPPERCASE rather
//              than showing an empty book that reads like "no trades".
//
//   UK         Register of Members' Financial Interests, published fortnightly by
//              the Registrar (members-api.parliament.uk). Structured JSON: each
//              member has categories, each category has free-text interests.
//              Registrable only — a member need not declare a brokerage account
//              holding, only the registrable directorship/employment/interest.
//              Position sizes are frequently prose, so there is no numeric book
//              to total and this desk never manufactures one.
//
//   INDIA      No STOCK ACT analogue. The Election Commission captures a Form 26
//              / nomination affidavit at election time and the annual
//              declaration of assets follows the elected member's term. ADR's
//              MyNeta.info is the machine-readable mirror of the ECI affidavit
//              archive and it publishes declared assets, liabilities, ITR income
//              and declared criminal cases, election by election. Point-in-time
//              declarations, NOT transactions — an Indian MP who sold a holding
//              between elections has no filing trail here at all.
//
// Every parser here returns exactly what the source served. A field the source
// does not carry is null and renders "—". Nothing is inferred, interpolated or
// carried across jurisdictions.

export type Jurisdiction = "US-HOUSE" | "US-SENATE" | "UK" | "IN";

// ------------------------------------------------------------------ register

export interface PoliSource {
  id: Jurisdiction;
  /** Terminal label. */
  label: string;
  /** Who publishes it. */
  authority: string;
  /** How often the filer is obliged to file. */
  cadence: string;
  /** What one record actually contains. */
  granularity: string;
  /** The machine-readable layer this adapter reads. */
  machine: string;
  /** The one thing a reader is most likely to get wrong. */
  caveat: string;
  /** The public entry point a trader can audit by hand. */
  url: string;
  /** True when a real, parsed, per-position book exists downstream. */
  bookLevel: "REGISTER" | "POSITION" | "DECLARED-TOTAL";
}

export const POLI_SOURCES: PoliSource[] = [
  {
    id: "US-HOUSE",
    label: "US HOUSE — STOCK ACT PTR",
    authority: "OFFICE OF THE CLERK, U.S. HOUSE OF REPRESENTATIVES",
    cadence: "PTR WITHIN 45 DAYS OF A TRANSACTION; ANNUAL DISCLOSURE EVERY YEAR; AMENDMENTS AT ANY TIME",
    granularity: "PER-TRANSACTION ON THE FILED FORM — ASSET, RANGE, BUY/SELL/EXCHANGE, DATE. READ ONLY FROM THE PDF.",
    machine: "MEMBER SEARCH REGISTER (HTML INDEX, BOTH financial-pdfs/ AND ptr-pdfs/) → FILED DOCUMENT LINK. NO OPEN XML/JSON OF HOUSE PTR HOLDINGS EXISTS.",
    caveat:
      "THE CLERK SERVES A REGISTER OF FILINGS, NOT A MACHINE-READABLE BOOK OF POSITIONS. EVERY ASSET LINE IS INSIDE THE FILED DOCUMENT — OPEN IT. A NAME MISSING FROM THE INDEX IS NOT EVIDENCE THAT THE MEMBER FILED NOTHING.",
    url: "https://disclosures-clerk.house.gov/FinancialDisclosure",
    bookLevel: "REGISTER",
  },
  {
    id: "US-SENATE",
    label: "US SENATE — eFD DISCLOSURE INDEX",
    authority: "UNITED STATES SENATE, COMMITTEE ON ETHICS IN GOVERNMENT (eFD SEARCH)",
    cadence: "PERIODIC TRANSACTION REPORT WITHIN 45 DAYS; ANNUAL DISCLOSURE; CANDIDATE AND EXTENSION FORMS",
    granularity: "INDEX ROW ONLY — FILER, FORM TYPE, FILED DATE, LINK. ASSET LINES ARE PER REPORT.",
    machine: "eFD SEARCH DATA-TABLES FEED (/search/report/data?start&length). PAGED, UNFILTERED, AND NO ASSET ARRAYS.",
    caveat:
      "PER-REPORT ASSET LINES SIT BEHIND eFD's USE-AGREEMENT GATE, WHICH THIS DESK DOES NOT ACCEPT FOR YOU. THE INDEX IS PAGED AND HONOURS NO NAME FILTER, SO A MISS MEANS 'NOT IN THE WINDOW SCANNED' — THE WINDOW IS ALWAYS PRINTED WITH THE RESULT. HTTP 403 FROM THIS HOST IS A BLOCKED NETWORK, NOT AN EMPTY RESULT.",
    url: "https://efdsearch.senate.gov/search/",
    bookLevel: "REGISTER",
  },
  {
    id: "UK",
    label: "UK PARLIAMENT — REGISTER OF FINANCIAL INTERESTS",
    authority: "REGISTRAR OF MEMBERS' FINANCIAL INTERESTS, UK PARLIAMENT",
    cadence: "PUBLISHED FORTNIGHTLY; DECLARED ON ENTERING AND ON ANY CHANGE",
    granularity: "REGISTRABLE INTERESTS ONLY — FREE TEXT PER CATEGORY. DIRECTORSHIPS, EMPLOYMENT, GIFT/ HOSPITALITY, MISCELLANEOUS.",
    machine: "MEMBERS API JSON: /Members/Search, /Members/{id}/RegisteredInterests, /LordsInterests/Register.",
    caveat:
      "THIS IS NOT A PORTFOLIO. A MEMBER DECLARES WHAT THE STANDING ORDERS REQUIRE AND NOTHING ELSE — A BROKERAGE ACCOUNT, AN ORDINARY SHAREHOLDING BELOW THE THRESHOLD OR AN INDEX FUND MAY APPEAR NOWHERE. THERE IS NO SIZE FOR MOST LINES, SO THERE IS NO TOTAL TO SUM, AND THIS DESK DOES NOT INVENT ONE.",
    url: "https://members.parliament.uk/members",
    bookLevel: "POSITION",
  },
  {
    id: "IN",
    label: "INDIA — ADR / MYNETA AFFIDAVITS",
    authority: "ASSOCIATION FOR DEMOCRATIC REFORMS (ADR) · ELECTION COMMISSION OF INDIA FORM 26",
    cadence: "AT ELECTION ONLY — NOMINATION AFFIDAVIT + FORM 26 — PLUS THE ANNUAL DECLARATION OF ASSETS. NO TRANSACTION REPORTING EXISTS.",
    granularity: "POINT-IN-TIME DECLARED TOTAL — ASSETS, LIABILITIES, ITR INCOME, DECLARED CRIMINAL CASES — PER ELECTION.",
    machine: "MYNETA.INFO AFFIDAVIT MIRROR (ADR). DECLARED WEALTH BY CONSTITUENCY AND BY ELECTION.",
    caveat:
      "THIS IS NOT A TRADE TAPE. INDIA HAS NO STOCK ACT EQUIVALENT: A MEMBER DECLARES A TOTAL AT ELECTION TIME AND NOTHING IN BETWEEN. A SALE MADE AFTER THE VOTE LEAVES NO TRAIL HERE. THE DECLARED TOTAL ALSO MIXES SELF, SPOUSE, HUF AND DEPENDENTS AND IS DECLARED IN RUPEES ON A STATED DATE.",
    url: "https://www.myneta.info/",
    bookLevel: "DECLARED-TOTAL",
  },
];

// -------------------------------------------------------------------- http

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/** One polite GET. Throws an UPPERCASE message the desk renders verbatim. */
async function httpText(
  url: string,
  opts: { method?: string; body?: string; accept?: string; timeoutMs?: number; revalidate?: number } = {}
) {
  const { method = "GET", body, accept = "text/html,application/json,*/*", timeoutMs = 20000, revalidate } = opts;
  const res = await fetch(url, {
    method,
    headers: {
      "user-agent": UA,
      accept,
      "accept-language": "en-US,en;q=0.9",
      ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
    // The Indian roll is a ~530KB page that changes only around an election;
    // without a revalidate window every desk open re-downloads it.
    ...(revalidate !== undefined ? { next: { revalidate } } : { cache: "no-store" }),
  } as RequestInit);
  if (!res.ok) {
    throw new Error(
      res.status === 403
        ? `HTTP 403 — ${new URL(url).host} REFUSED THIS NETWORK (ITS EDGE BLOCKS DATACENTRE IPS). THIS IS NOT AN EMPTY RESULT.`
        : `${new URL(url).host} ANSWERED HTTP ${res.status}`
    );
  }
  return await res.text();
}

async function httpJson<T>(url: string, accept = "application/json", revalidate?: number): Promise<T> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept, "accept-language": "en-US,en;q=0.9" },
    signal: AbortSignal.timeout(20000),
    ...(revalidate !== undefined ? { next: { revalidate } } : { cache: "no-store" }),
  } as RequestInit);
  if (!res.ok) {
    throw new Error(
      res.status === 403
        ? `HTTP 403 — ${new URL(url).host} REFUSED THIS NETWORK (ITS EDGE BLOCKS DATACENTRE IPS). THIS IS NOT AN EMPTY RESULT.`
        : `${new URL(url).host} ANSWERED HTTP ${res.status}`
    );
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------- parsers

/** Entities + tags out, whitespace collapsed. MyNeta pages are full of both. */
export function stripHtml(s: string): string {
  return (s || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&rsquo;|&#8217;/gi, "'")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * "Rs 3,09,16,833" / "Rs1,84,77,888" / "Rs 0" -> 30916833.
 * Indian grouping only: the first comma is a lakh separator, the rest thousands,
 * so stripping every separator is correct for all of them.
 */
export function inrNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = (raw || "").match(/(-?)\s*(?:rs\.?|₹)?\s*([\d,]+)/i);
  if (!m) return null;
  const digits = m[2].replace(/,/g, "");
  if (!digits) return null;
  const n = Number(digits);
  if (!isFinite(n)) return null;
  return m[1] === "-" ? -n : n;
}

/** MyNeta's own coarse band label, e.g. "~3&nbsp;Crore+" -> "3 CRORE+". */
export function inrBandLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = (raw || "").match(/~\s*([\d.,]+)(?:&nbsp;|\s)*(crore|lacs?|lakh|lac)/i);
  if (!m) return null;
  return `${m[1]} ${m[2].toUpperCase()}+`;
}

/**
 * A STOCK ACT value is filed as a band, never a price ("$15,001 - $50,000").
 * Nothing in this module feeds this helper a value it did not receive — the
 * Senate index carries no amounts and the House registers link to filings — so
 * it exists only to document the band format for whoever reads the linked
 * documents. No panel here renders a mid-point as though it were a price.
 */
export const STOCK_ACT_BANDS = [
  "$1 - $1,000", "$1,001 - $15,000", "$15,001 - $50,000",
  "$50,001 - $100,000", "$100,001 - $250,000", "$250,001 - $1,000,000", "Over $1,000,000",
] as const;

// ------------------------------------------------------------- US — House

export interface HouseFiling {
  /** Filing year as the register prints it. */
  year: string;
  /** "PTR", "PTR Amendment", "FD Original", "FD Amendment". */
  filing: string;
  /** "CA12" — state + district. */
  office: string;
  /** Member exactly as the register prints the name. */
  member: string;
  /** Absolute URL of the filed PDF. */
  doc: string;
}

const HOUSE_ROOT = "https://disclosures-clerk.house.gov/";

/**
 * The Clerk's member search is a POST that answers an HTML table. No query
 * params narrow the year, so every filing for the surname comes back and the
 * desk slices by year and filing type itself.
 */
export async function houseFilings(lastName: string, state = ""): Promise<HouseFiling[]> {
  const name = (lastName || "").trim();
  if (!name) return [];
  const html = await httpText(`${HOUSE_ROOT}FinancialDisclosure/ViewMemberSearchResult`, {
    method: "POST",
    revalidate: 6 * 3600,
    body: new URLSearchParams({
      LastName: name,
      State: state.trim().toUpperCase(),
      CurrentStatus: "",
      FinancialDisclosureReportType: "",
      FilingType: "",
      ReportYear: "",
    }).toString(),
  });
  return parseHouseRegister(html, HOUSE_ROOT);
}

export function parseHouseRegister(html: string, root = HOUSE_ROOT): HouseFiling[] {
  const out: HouseFiling[] = [];
  const seen = new Set<string>();
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const body = row[1];
    // Both document families live in one index: the annual/periodic-disclosure
    // forms under financial-pdfs/ and the STOCK ACT transaction reports under
    // ptr-pdfs/. Matching only one of them silently drops every PTR.
    const href = body.match(/href="([^"]*(?:financial|ptr)-pdfs\/[^"]+)"/i)?.[1];
    if (!href) continue;
    const cell = (label: string): string =>
      stripHtml(body.match(new RegExp(`data-label="${label}"[^>]*>([\\s\\S]*?)(?=<td|</td|</tr|$)`, "i"))?.[1] ?? "");
    const filing = {
      member: cell("Name"),
      office: cell("Office"),
      year: cell("Filing Year"),
      filing: cell("Filing"),
      doc: href.startsWith("http") ? href : `${root}${href.replace(/^\//, "")}`,
    };
    const key = `${filing.year}|${filing.filing}|${filing.doc}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(filing);
  }
  // Newest year first, then the most granular form first inside a year: an
  // amendment supersedes the original it amends.
  const rank = (f: string) => (/AMEND/i.test(f) ? 0 : 1);
  return out.sort((a, b) => Number(b.year) - Number(a.year) || rank(a.filing) - rank(b.filing));
}

// ------------------------------------------------------------ US — Senate
//
// VERIFIED SHAPE, because this one is easy to get wrong: eFD's
// /search/report/data/ is a DataTables server-side feed, not a document list.
//
//   { draw, recordsTotal, recordsFiltered, result: "ok",
//     data: [ [firstName, lastName, displayName, linkHtml, filedDate], … ] }
//
// It takes `start` + `length` and honours NO name/date filter without the
// site's use-agreement, so this adapter pages a bounded window and filters the
// surname itself, then reports the window it actually read. Per-report asset
// lines live behind that agreement — a legal prohibition statement the desk
// will not accept on the user's behalf, so it links the report instead.

const SENATE_EFD = "https://efdsearch.senate.gov";
export const SENATE_AGREEMENT =
  "THE ASSET-LEVEL LINES OF A SENATE REPORT SIT BEHIND eFD's USE-AGREEMENT GATE. THIS DESK DOES NOT ACCEPT A LEGAL PROHIBITION STATEMENT ON YOUR BEHALF, SO IT LINKS THE FILED REPORT INSTEAD OF SCRAPING PAST THE GATE.";

export interface SenateIndexRow {
  /** First + last as eFD prints them. */
  member: string;
  /** eFD's own display name, e.g. "Schumer, Charles (Senator)". */
  display: string;
  /** eFD's own report-type label, e.g. "Periodic Transaction Report". */
  reportType: string;
  /** YYYY-MM-DD, from eFD's MM/DD/YYYY filing date. */
  filed: string | null;
  /** Official report page on efdsearch.senate.gov. */
  doc: string | null;
}

export interface SenateWindow {
  rows: SenateIndexRow[];
  /** How many rows the window covered before the surname filter ran. */
  scanned: number;
  /** Filings on the index at fetch time. */
  total: number | null;
  /** Date span of the scanned window, so a miss is never a silent gap. */
  from: string | null;
  to: string | null;
}

const PAGE = 100;

export async function senateRegister(opts: { lastName?: string; pages?: number } = {}): Promise<SenateWindow> {
  const pages = Math.min(Math.max(opts.pages ?? 3, 1), 6);
  const fetches = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      httpJson<any>(
        `${SENATE_EFD}/search/report/data/?start=${i * PAGE}&length=${PAGE}`,
        "application/json, text/javascript, */*; q=0.01",
        1800
      )
    )
  );
  const rows: SenateIndexRow[] = [];
  let total: number | null = null;
  for (const payload of fetches) {
    if (total === null) total = Number(payload?.recordsTotal ?? 0) || null;
    for (const row of Array.isArray(payload?.data) ? payload.data : []) rows.push(...parseSenateRow(row));
  }
  const dates = rows.map((r) => r.filed).filter((d): d is string => !!d).sort();
  const window: SenateWindow = {
    rows,
    scanned: rows.length,
    total,
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
  };
  const name = (opts.lastName || "").trim().toUpperCase();
  if (!name) return window;
  return { ...window, rows: window.rows.filter((r) => `${r.member} ${r.display}`.toUpperCase().includes(name)) };
}

export function parseSenateRow(row: unknown): SenateIndexRow[] {
  if (!Array.isArray(row)) return [];
  const [first = "", last = "", display = "", linkHtml = "", filed = ""] = row.map((c) => String(c ?? ""));
  const href = String(linkHtml).match(/href="([^"]+)"/i)?.[1] ?? null;
  const label = stripHtml(String(linkHtml));
  // "/search/view/annual/<id>/" vs "/search/view/ptr/<id>/" — the path is the
  // authoritative form; the link text is the label the Senate chose to print.
  const kind = href?.match(/\/search\/view\/([a-z]+)\//i)?.[1] ?? null;
  const reportType =
    (label.match(/Periodic Transaction Report/i) && "PERIODIC TRANSACTION REPORT") ||
    (label.match(/Candidate Report/i) && "CANDIDATE REPORT") ||
    (label.match(/Annual/i) && "ANNUAL DISCLOSURE") ||
    (label.match(/Extension/i) && "DUE DATE EXTENSION") ||
    (label.match(/Other/i) && "OTHER REPORT") ||
    (kind ? kind.toUpperCase() : label || "—");
  const member = `${first} ${last}`.trim() || display || "—";
  return [
    {
      member,
      display: display || member,
      reportType,
      filed: senateDate(filed),
      doc: href ? `${SENATE_EFD}${href.startsWith("http") ? "" : ""}${href}` : null,
    },
  ];
}

/** eFD prints MM/DD/YYYY. Returns ISO, or null when the field is not a date. */
function senateDate(raw: string): string | null {
  const m = (raw || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

// ------------------------------------------------------------------ UK

export interface UkMember {
  id: number;
  name: string;
  title: string | null;
  party: string | null;
  house: string;
  from: string | null;
  to: string | null;
  status: string | null;
}

export interface UkInterest {
  id: number;
  /** The category exactly as the Register names it, e.g. "3. Gifts, benefits…". */
  category: string;
  /** Normalised class derived from the category + entry text. */
  cls: UkClass;
  /** The entry verbatim, newlines kept. */
  text: string;
  /** Entity named in the entry, when the entry names one. */
  entity: string | null;
  /** A £ figure only when the entry prints one. */
  amount: number | null;
  amountLabel: string | null;
  registered: string | null;
  amended: string | null;
}

export type UkClass = "DIRECTORSHIP" | "EMPLOYMENT" | "SECURITIES" | "PROPERTY" | "GIFT" | "POLICY" | "OTHER";

export async function ukMembers(name: string, house = ""): Promise<UkMember[]> {
  const sp = new URLSearchParams({ Name: (name || "").trim(), skip: "0", take: "20" });
  const h = house.trim();
  if (h) sp.set("House", h);
  const raw = await httpJson<any>(`https://members-api.parliament.uk/api/Members/Search?${sp.toString()}`, "application/json", 3600);
  const items = Array.isArray(raw?.items) ? raw.items : [];
  return items.map((it: any) => {
    const v = it?.value ?? {};
    const m = v.latestHouseMembership ?? {};
    return {
      id: Number(v.id),
      name: v.nameDisplayAs || v.nameListAs || "—",
      title: v.nameFullTitle || null,
      party: v.latestParty?.name || null,
      house: m.house === 1 ? "COMMONS" : m.house === 2 ? "LORDS" : "—",
      from: m.membershipStartDate ? String(m.membershipStartDate).slice(0, 10) : null,
      to: m.membershipEndDate ? String(m.membershipEndDate).slice(0, 10) : null,
      // `membershipStatus` is null on many rows, so fall back to the dates the
      // same record carries rather than reporting every such member as "—".
      status: ukStatus(m.membershipStatus?.statusIsActive, m.membershipEndDate),
    } satisfies UkMember;
  });
}

function ukStatus(statusIsActive: unknown, endDate: unknown): string {
  if (typeof statusIsActive === "boolean") return statusIsActive ? "SITTING" : "FORMER";
  if (!endDate) return "SITTING";
  const end = String(endDate).slice(0, 10);
  return end >= new Date().toISOString().slice(0, 10) ? "SITTING" : "FORMER";
}

export async function ukInterests(memberId: number): Promise<UkInterest[]> {
  const raw = await httpJson<any>(`https://members-api.parliament.uk/api/Members/${Math.trunc(memberId)}/RegisteredInterests`, "application/json", 3600);
  const cats = Array.isArray(raw?.value) ? raw.value : [];
  const out: UkInterest[] = [];
  for (const cat of cats) {
    const name = String(cat?.name ?? "—");
    const list = Array.isArray(cat?.interests) ? cat.interests : [];
    for (const it of list) {
      const text = String(it?.interest ?? "");
      const amt = gbpFigure(text);
      out.push({
        id: Number(it?.id ?? 0),
        category: name,
        cls: classifyUkInterest(name, text),
        text,
        entity: ukEntity(text),
        amount: amt?.value ?? null,
        amountLabel: amt?.label ?? null,
        registered: it?.createdWhen ? String(it.createdWhen).slice(0, 10) : null,
        amended: it?.lastAmendedWhen ? String(it.lastAmendedWhen).slice(0, 10) : null,
      });
    }
  }
  return out;
}

/**
 * The bulk fortnightly Register. Rows are member bundles, so this is the only
 * one of the four sources that can sweep a whole chamber at once — it is what
 * the COHORT panel counts interest classes from.
 */
export async function ukRegister(from: string, to: string, house = ""): Promise<{ count: number; byClass: Record<string, number>; members: number; totalResults: number }> {
  const sp = new URLSearchParams({ startDate: from, endDate: to, skip: "0", take: "100" });
  const h = house.trim();
  if (h) sp.set("house", h);
  const raw = await httpJson<any>(`https://members-api.parliament.uk/api/LordsInterests/Register?${sp.toString()}`, "application/json", 3600);
  const items = Array.isArray(raw?.items) ? raw.items : [];
  const byClass: Record<string, number> = {};
  let count = 0;
  const members = new Set<number>();
  for (const row of items) {
    // Every Members API list wraps the payload in `{ value: … }`, the register
    // bundle included. Reading `row.member` instead of `row.value.member`
    // returns a register of twenty anonymous bundles.
    const it = row?.value ?? row;
    const cats = Array.isArray(it?.interestCategories) ? it.interestCategories : [];
    const id = it?.member?.id;
    if (id !== undefined) members.add(Number(id));
    for (const cat of cats) {
      const name = String(cat?.name ?? "");
      for (const entry of Array.isArray(cat?.interests) ? cat.interests : []) {
        count++;
        const cls = classifyUkInterest(name, String(entry?.interest ?? ""));
        byClass[cls] = (byClass[cls] ?? 0) + 1;
      }
    }
  }
  return { count, byClass, members: members.size, totalResults: Number(raw?.totalResults ?? items.length) };
}

const UK_CLASS_RULES: Array<[UkClass, RegExp]> = [
  ["DIRECTORSHIP", /director|directorship|board of|trustee|chair(m|person)? of/i],
  ["POLICY", /policy|policies|spoken|voted|vote on/i],
  ["SECURITIES", /share|securit|stock|bond|debenture|unit trust|investment fund|fund\b|holding in|equity|option|derivative/i],
  ["EMPLOYMENT", /employ|salary|remunerat|consultan|contract|apprentice|wages|professio/i],
  ["PROPERTY", /property|land|tenan|lease|premises/i],
  ["GIFT", /gift|hospitality|donation|received from|benefit/i],
];

export function classifyUkInterest(category: string, text: string): UkClass {
  // The category heading wins: it is the Registrar's own classification, and
  // an entry about a director's employer also mentions "employ".
  const cat = (category || "").toLowerCase();
  for (const [cls, re] of UK_CLASS_RULES) {
    if (re.test(cat)) return cls;
  }
  for (const [cls, re] of UK_CLASS_RULES) {
    if (re.test(text || "")) return cls;
  }
  return "OTHER";
}

/** A £ amount only when the entry actually prints one. */
function gbpFigure(text: string): { value: number; label: string } | null {
  const m = (text || "").match(/£\s*([\d][\d,]*)/);
  if (!m) return null;
  const v = Number(m[1].replace(/,/g, ""));
  if (!isFinite(v)) return null;
  return { value: v, label: `£${m[1]}` };
}

/**
 * The entity named in a Register entry, when there is one. Register entries are
 * labelled prose, not a schema, so this only fires on the labels the Register
 * actually uses and returns null otherwise rather than guessing a noun phrase.
 * The value is cut at the first comma or bracket because the label usually
 * continues into a postal address — the full line is always printed verbatim
 * beside it, so nothing is lost by keeping the chip short.
 */
export function ukEntity(text: string): string | null {
  const m = (text || "").match(
    /(?:name of (?:company|employer|payer|organisation|organization|body)|company|employer|payer|organisation|organization|body corporate)\s*:\s*([^\r\n]+)/i
  );
  if (!m) return null;
  const v = m[1].split(/[,(]/)[0].trim().replace(/\s+/g, " ").replace(/[.;]$/, "");
  return v.length > 1 && v.length <= 80 ? v : null;
}

// ----------------------------------------------------------------- India

export interface MynetaRow {
  id: string;
  name: string;
  constituency: string;
  party: string;
  cases: number | null;
  education: string;
  /** Declared total assets in rupees, as filed. */
  assets: number | null;
  assetsBand: string | null;
  liabilities: number | null;
  doc: string;
}

export const MYNETA_ELECTIONS = [
  { key: "LokSabha2024", label: "LOK SABHA 2024", href: "/LokSabha2024/" },
  { key: "LokSabha2019", label: "LOK SABHA 2019", href: "/LokSabha2019/" },
  { key: "ls2014", label: "LOK SABHA 2014", href: "/ls2014/" },
  { key: "ls2009", label: "LOK SABHA 2009", href: "/ls2009/" },
] as const;

/** Accepted only from the table above, so the election is never a URL fragment. */
export function mynetaElection(key: string | null | undefined): (typeof MYNETA_ELECTIONS)[number] {
  return MYNETA_ELECTIONS.find((e) => e.key === (key ?? "")) ?? MYNETA_ELECTIONS[0];
}

/**
 * The elected house — the roll ADR actually exposes as one machine-readable
 * table. `show_all_candidates` is NOT an action MyNeta honours (it silently
 * re-renders the election summary), so this desk takes the elected house rather
 * than claiming a candidate-wide roll it cannot read.
 */
export async function mynetaRoster(electionKey: string): Promise<MynetaRow[]> {
  const el = mynetaElection(electionKey);
  const html = await httpText(`https://www.myneta.info${el.href}index.php?action=show_winners&sort=asset`, { revalidate: 6 * 3600 });
  return parseMynetaRoster(html, el.key);
}

export function parseMynetaRoster(html: string, election: string): MynetaRow[] {
  const out: MynetaRow[] = [];
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const body = row[1];
    const id = body.match(/candidate_id=(\d+)/i)?.[1];
    if (!id) continue;
    const cells = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => stripHtml(c[1]));
    if (cells.length < 8) continue;
    out.push({
      id,
      name: cells[1]?.split("(")[0]?.trim() || "—",
      constituency: cells[2] || "—",
      party: cells[3] || "—",
      cases: /^\d+$/.test((cells[4] ?? "").trim()) ? Number(cells[4].trim()) : null,
      education: cells[5] || "—",
      assets: inrNumber(cells[6]),
      assetsBand: inrBandLabel(cells[6]),
      liabilities: inrNumber(cells[7]),
      doc: `https://www.myneta.info/${election}/candidate.php?candidate_id=${id}`,
    });
  }
  return out;
}

export interface MynetaDeclared {
  /** "Lok Sabha 2019" etc, exactly as MyNeta prints the row. */
  election: string;
  assets: number | null;
  band: string | null;
  cases: number | null;
}

export interface MynetaIncome {
  relation: string;
  pan: string;
  /** Financial year label, e.g. "2021 - 2022". */
  fy: string;
  income: number | null;
}

export interface MynetaCandidate {
  id: string;
  name: string;
  party: string | null;
  constituency: string | null;
  age: number | null;
  profession: string | null;
  spouseProfession: string | null;
  assets: number | null;
  assetsBand: string | null;
  liabilities: number | null;
  /** Declared totals across every election ADR holds for this candidate. */
  history: MynetaDeclared[];
  income: MynetaIncome[];
  cases: number | null;
  /** Free-text IPC/BNS descriptions, as printed. */
  caseNotes: string[];
  doc: string;
}

export async function mynetaCandidate(electionKey: string, id: string): Promise<MynetaCandidate | null> {
  const el = mynetaElection(electionKey);
  const html = await httpText(`https://www.myneta.info/${el.key}/candidate.php?candidate_id=${id}`, { revalidate: 24 * 3600 });
  return parseMynetaCandidate(html, el.key, id);
}

export function parseMynetaCandidate(html: string, election: string, id: string): MynetaCandidate | null {
  const title = stripHtml(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  if (!title || /404|not found/i.test(title)) return null;
  const name = title.split("(")[0].trim() || "—";
  const party = stripHtml(html.match(/<b>Party:<\/b>([\s\S]*?)<\/div>/i)?.[1] ?? "") || title.match(/\(([^()]*)\)\s*:/)?.[1]?.split(")")[0]?.trim() || null;
  const constituency = title.match(/Constituency-\s*([^(:]*)/i)?.[1]?.trim() || null;
  const ageRaw = stripHtml(html.match(/<b>Age:<\/b>([\s\S]*?)<\/div>/i)?.[1] ?? "");
  const age = /^\d+$/.test(ageRaw) ? Number(ageRaw) : null;
  const profession = stripHtml(html.match(/<b>Self Profession:<\/b>([\s\S]*?)(?:<b>Spouse Profession:<\/b>)/i)?.[1] ?? "") || null;
  const spouseProfession = stripHtml(html.match(/<b>Spouse Profession:<\/b>([\s\S]*?)<\/p>/i)?.[1] ?? "") || null;

  // Summary Assets & Liabilities panel. Anchored on the row labels, NOT on the
  // "Assets & Liabilities" heading: the heading carries a trailing space and a
  // bare `&`, and the heading string also appears inside the link target. A
  // liability printed as "Nil" has no figure and stays null — "—", not zero.
  const assetsCellRaw = html.match(/<td>\s*Assets\s*:\s*<\/td>\s*<td>([\s\S]*?)<\/td>/i)?.[1] ?? "";
  const liabCellRaw = html.match(/<td>\s*Liabilities\s*:\s*<\/td>\s*<td>([\s\S]*?)<\/td>/i)?.[1] ?? "";
  const assets = inrNumber(stripHtml(assetsCellRaw));
  const assetsBand = inrBandLabel(assetsCellRaw);
  const liabilities = inrNumber(stripHtml(liabCellRaw));

  // "Other Elections" table — declared totals for every earlier election ADR
  // holds for this candidate.
  const history: MynetaDeclared[] = [];
  const otherBlock = html.match(/Other Elections\s*<\/th>([\s\S]*?)<\/table>/i)?.[1] ?? "";
  for (const r of otherBlock.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => stripHtml(c[1]));
    if (cells.length < 3 || !/sabha|assembly|assembly|election|assembly/i.test(cells[0])) continue;
    if (/^Declaration in$/i.test(cells[0])) continue;
    history.push({
      election: cells[0],
      assets: inrNumber(cells[1]),
      band: inrBandLabel(cells[1]),
      cases: /^\d+$/.test(cells[2]) ? Number(cells[2]) : null,
    });
  }

  // PAN / ITR income table. The 4th cell is one <br>-separated run of
  // "FINANCIAL YEAR ** Rs amount" blocks, so the cell is split on <br> and
  // each block is read as a pair — reading the whole cell at once would make
  // the first number the YEAR rather than the income.
  const income: MynetaIncome[] = [];
  const itr = html.match(/<table id=income_tax[\s\S]*?<\/table>/i)?.[0] ?? "";
  for (const r of itr.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)) {
    const rawCells = [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
    if (rawCells.length !== 4) continue;
    const relation = stripHtml(rawCells[0]).toLowerCase();
    if (!/^(self|spouse|huf|dependent\d?)$/.test(relation)) continue;
    for (const block of rawCells[3].split(/<br\s*\/?>/i)) {
      const fy = stripHtml(block.match(/(\d{4}\s*-\s*\d{4})/)?.[1] ?? "");
      const amt = block.match(/<b>\s*Rs(?:&nbsp;|\s)+([\d,]+)\s*<\/b>/i);
      if (!fy || !amt) continue;
      income.push({ relation, pan: stripHtml(rawCells[1]), fy: fy.replace(/\s+/g, " "), income: inrNumber(amt[1]) });
    }
  }

  // Declared criminal cases: the Crime-O-Meter gauge data is the count ADR itself
  // feeds its own chart, so read it first; fall back to the printed sentence and
  // then to "No criminal cases" on the details panel.
  let cases: number | null = null;
  const gauge = html.match(/arrayToDataTable\(\[\s*\[\s*['"]Label['"]\s*,\s*['"]Value['"]\s*\]\s*,\s*\[\s*['"]Cases['"]\s*,\s*(\d+)/i);
  if (gauge) cases = Number(gauge[1]);
  else {
    const printed = stripHtml(html.match(/Number of Criminal Cases:\s*<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "");
    if (/^\d+$/.test(printed)) cases = Number(printed);
    else if (/No criminal cases/i.test(html)) cases = 0;
  }
  const caseNotes = [...html.matchAll(/<span class='w3-badge w3-red w3-tiny'>\s*(\d+)\s*<\/span>\s*([^<]*)/gi)].map((m) => `${m[1].trim()} · ${stripHtml(m[2])}`);

  return {
    id,
    name,
    party: party || null,
    constituency,
    age,
    profession,
    spouseProfession,
    assets,
    assetsBand,
    liabilities,
    history,
    income,
    cases,
    caseNotes,
    doc: `https://www.myneta.info/${election}/candidate.php?candidate_id=${id}`,
  };
}

// ------------------------------------------------------- cohort arithmetic

/** Declared net worth. A liability above the declared assets is shown as such. */
export function indiaNetWorth(assets: number | null, liabilities: number | null): number | null {
  if (assets === null) return null;
  return assets - (liabilities ?? 0);
}

/**
 * Compound growth of DECLARED totals between two elections, oldest first.
 * These are point-in-time self-declarations years apart, not a valuation — the
 * desk labels it as such and renders "—" below one year of separation, where a
 * CAGR would be a fabrication.
 */
export function declaredCagr(history: MynetaDeclared[]): { pct: number | null; from: string; to: string; years: number } {
  const pts = history
    .filter((h) => h.assets !== null && /\d{4}/.test(h.election))
    .map((h) => ({ year: Number(h.election.match(/(\d{4})/)![1]), label: h.election, v: h.assets as number }))
    .filter((p) => isFinite(p.year) && p.v > 0)
    .sort((a, b) => a.year - b.year);
  if (pts.length < 2) return { pct: null, from: "", to: "", years: 0 };
  const first = pts[0];
  const last = pts[pts.length - 1];
  const years = last.year - first.year;
  if (years < 1 || first.v <= 0) return { pct: null, from: first.label, to: last.label, years };
  return { pct: (Math.pow(last.v / first.v, 1 / years) - 1) * 100, from: first.label, to: last.label, years };
}

/** Percentile helpers are not needed: the cohort panel prints real quartiles. */
export function cohortStats(values: number[]): { n: number; min: number; p25: number; median: number; p75: number; max: number } | null {
  const v = values.filter((x) => isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const q = (p: number) => {
    const idx = (p / 100) * (v.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return lo === hi ? v[lo] : v[lo] + (v[hi] - v[lo]) * (idx - lo);
  };
  return { n: v.length, min: v[0], p25: q(25), median: q(50), p75: q(75), max: v[v.length - 1] };
}