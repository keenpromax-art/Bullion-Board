// Politician Portfolio Tracker (module 118) — one endpoint, seven kinds.
//
//   sources      the four disclosure regimes: cadence, granularity, the machine
//                -readable layer this desk actually reads, and the caveat that
//                stops a trader misreading it. `?probe=1` pings each host.
//   us           US HOUSE register (Clerk) + US SENATE eFD reports, fail-open
//   uk           UK Parliament member search
//   ukinterests  one member's Register of Financial Interests, categorised
//   ukregister   the fortnightly bulk Register: interest-class mix for a chamber
//   roster       India's ADR/MyNeta elected house with declared-wealth stats
//   candidate    one candidate's affidavit: assets, liabilities, ITR, cases
//
// Honesty contract, same as /api/filings: a leg that fails returns ok:false
// with an UPPERCASE reason the desk prints verbatim. A leg that cannot be
// reached NEVER degrades into an empty table that reads like "no holdings" —
// across these four registries that distinction is the whole point of the desk.

import { NextRequest, NextResponse } from "next/server";
import {
  cohortStats,
  declaredCagr,
  houseFilings,
  indiaNetWorth,
  mynetaCandidate,
  mynetaElection,
  mynetaRoster,
  MYNETA_ELECTIONS,
  POLI_SOURCES,
  SENATE_AGREEMENT,
  senateRegister,
  ukInterests,
  ukMembers,
  ukRegister,
  type PoliSource,
} from "@/lib/politicians";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function fail(kind: string, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, kind, error, ...extra }, { status: 200 });
}

const msg = (e: unknown): string =>
  (e instanceof Error && e.message ? e.message : String(e)).toUpperCase();

function intParam(sp: URLSearchParams, key: string, dflt: number, lo: number, hi: number): number {
  const raw = sp.get(key);
  if (raw === null || raw.trim() === "") return dflt;
  const n = Number(raw);
  if (!isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

/** Only the four catalogues above may be opened by key. */
function isoOrNull(v: string | null, fallback: string): string {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : fallback;
}

export async function GET(req: NextRequest, ctx: { params: { kind: string } }) {
  const kind = (ctx.params.kind || "").toLowerCase();
  const sp = req.nextUrl.searchParams;

  // ------------------------------------------------------------- sources
  if (kind === "sources") {
    const probe = sp.get("probe") === "1";
    if (!probe) return NextResponse.json({ ok: true, kind, sources: POLI_SOURCES });
    const [house, senate, uk, india] = await Promise.allSettled([
      houseFilings("PELOSI"),
      senateRegister({ pages: 1 }),
      ukMembers("Starmer"),
      mynetaRoster(MYNETA_ELECTIONS[0].key),
    ]);
    /** One line per host: did it answer, how much came back, and why not. */
    const seen = (r: PromiseSettledResult<{ length: number }>): { live: boolean; rows: number; note: string } =>
      r.status === "fulfilled"
        ? { live: true, rows: r.value.length, note: `ANSWERED — ${r.value.length} ROW(S) READ` }
        : { live: false, rows: 0, note: msg(r.reason) };
    const senateSeen = (r: PromiseSettledResult<Awaited<ReturnType<typeof senateRegister>>>): { live: boolean; rows: number; note: string } =>
      r.status === "fulfilled"
        ? { live: true, rows: r.value.scanned, note: `ANSWERED — ${r.value.scanned} OF ${r.value.total ?? "?"} INDEX ROWS PAGED` }
        : { live: false, rows: 0, note: msg(r.reason) };
    return NextResponse.json({
      ok: true,
      kind,
      sources: POLI_SOURCES,
      probe: {
        "US-HOUSE": seen(house),
        "US-SENATE": senateSeen(senate),
        UK: seen(uk),
        IN: seen(india),
      } satisfies Record<string, { live: boolean; rows: number; note: string }>,
    });
  }

  // ------------------------------------------------------------ US — House + Senate
  if (kind === "us") {
    const name = (sp.get("name") ?? "").trim();
    if (!name) return fail(kind, "TYPE A MEMBER SURNAME — BOTH US REGISTERS SEARCH BY SURNAME (e.g. PELOSI, SCHUMER), NOT BY A TICKER.");
    const state = (sp.get("state") ?? "").trim().toUpperCase();
    const errors: Record<string, string | null> = {};
    const [houseRes, senateRes] = await Promise.allSettled([houseFilings(name, state), senateRegister({ lastName: name })]);
    const filings = houseRes.status === "fulfilled" ? houseRes.value : [];
    const senate = senateRes.status === "fulfilled" ? senateRes.value : null;
    if (houseRes.status === "rejected") errors.house = msg(houseRes.reason);
    if (senateRes.status === "rejected") errors.senate = msg(senateRes.reason);
    if (!filings.length && !senate) {
      return fail(
        kind,
        `NO DISCLOSURE INDEX ROWS READ FOR "${name.toUpperCase()}". ${Object.values(errors).filter(Boolean).join(" · ")}`.trim(),
        { name, state: state || null, errors }
      );
    }
    const ptrCount = filings.filter((f) => /PTR/i.test(f.filing)).length;
    return NextResponse.json({
      ok: true,
      kind,
      name,
      state: state || null,
      filings,
      houseCount: filings.length,
      years: [...new Set(filings.map((f) => f.year))].sort((a, b) => Number(b) - Number(a)),
      ptrCount,
      senate,
      senateAgreement: SENATE_AGREEMENT,
      errors,
      partial: Object.values(errors).filter(Boolean).length > 0,
    });
  }

  // ---------------------------------------------------------------- UK — search
  if (kind === "uk") {
    const q = (sp.get("q") ?? "").trim();
    if (!q) return fail(kind, "TYPE A MEMBER NAME — THE UK PARLIAMENT MEMBERS API SEARCHES BY NAME.");
    try {
      const members = await ukMembers(q, (sp.get("house") ?? "").trim());
      return NextResponse.json({ ok: true, kind, q, members, count: members.length });
    } catch (e) {
      return fail(kind, msg(e), { q });
    }
  }

  // ---------------------------------------------------------------- UK — interests
  if (kind === "ukinterests") {
    const id = intParam(sp, "id", 0, 1, 999999);
    if (!id) return fail(kind, "NO MEMBER SELECTED — PICK ONE FROM THE UK MEMBER LIST.");
    try {
      const interests = await ukInterests(id);
      const byClass: Record<string, number> = {};
      for (const i of interests) byClass[i.cls] = (byClass[i.cls] ?? 0) + 1;
      const amounts = interests.map((i) => i.amount).filter((v): v is number => v !== null);
      return NextResponse.json({
        ok: true,
        kind,
        id,
        interests,
        count: interests.length,
        byClass,
        categories: [...new Set(interests.map((i) => i.category))],
        // A COUNT of entries, never a total value: most Register entries print no
        // figure at all, so summing them would be a number with no meaning.
        pricedCount: amounts.length,
        pricedSum: amounts.length ? amounts.reduce((a, b) => a + b, 0) : null,
        doc: `https://members.parliament.uk/member/${id}/financialinterests`,
      });
    } catch (e) {
      return fail(kind, msg(e), { id });
    }
  }

  // ---------------------------------------------------------------- UK — chamber sweep
  if (kind === "ukregister") {
    const to = isoOrNull(sp.get("to"), new Date().toISOString().slice(0, 10));
    const from = isoOrNull(sp.get("from"), new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10));
    try {
      const reg = await ukRegister(from, to, (sp.get("house") ?? "").trim());
      return NextResponse.json({ ok: true, kind, from, to, pageSize: 100, ...reg, doc: "https://members.parliament.uk/members" });
    } catch (e) {
      return fail(kind, msg(e), { from, to });
    }
  }

  // ---------------------------------------------------------------- India — elected house
  if (kind === "roster") {
    const el = mynetaElection(sp.get("election"));
    let rows;
    try {
      rows = await mynetaRoster(el.key);
    } catch (e) {
      return fail(kind, msg(e), { election: el.key });
    }
    if (!rows.length) {
      return fail(kind, `ADR'S ${el.label} WINNER TABLE SERVED NO PARSEABLE ROWS — THE TABLE MARKUP MAY HAVE CHANGED.`, {
        election: el.key,
      });
    }
    // Quartiles are over the whole elected house, never over the filtered view,
      // so a search for one MP does not quietly rebase the distribution.
      const cohort = cohortStats(rows.map((r) => r.assets).filter((v): v is number => v !== null));
      const q = (sp.get("q") ?? "").trim().toUpperCase();
      const hits = q
        ? rows.filter((r) => `${r.name} ${r.constituency} ${r.party}`.toUpperCase().includes(q))
        : rows;
      const top = [...rows].sort((a, b) => (b.assets ?? -1) - (a.assets ?? -1)).slice(0, 10);
      return NextResponse.json({
        ok: true,
        kind,
        election: el.key,
        electionLabel: el.label,
        elections: MYNETA_ELECTIONS,
        q: q || null,
        total: rows.length,
        rows: hits.slice(0, 60),
        shown: Math.min(hits.length, 60),
        top,
        cohort,
        crorepati: rows.filter((r) => (r.assets ?? 0) >= 1e7).length,
        withCases: rows.filter((r) => (r.cases ?? 0) > 0).length,
        source: "ADR / MYNETA.INFO — ELECTION COMMISSION OF INDIA AFFIDAVIT ARCHIVE",
        doc: `https://www.myneta.info${el.href}`,
      });
  }

  // ---------------------------------------------------------------- India — one affidavit
  if (kind === "candidate") {
    const el = mynetaElection(sp.get("election"));
    const id = (sp.get("id") ?? "").trim();
    if (!/^\d+$/.test(id)) return fail(kind, "NO CANDIDATE SELECTED — PICK ONE FROM THE ADR ELECTED-HOUSE BOARD.", { election: el.key });
    try {
      const c = await mynetaCandidate(el.key, id);
      if (!c) {
        return fail(kind, `ADR SERVED NO AFFIDAVIT FOR CANDIDATE ${id} IN ${el.label}. THE ID BELONGS TO A DIFFERENT ELECTION.`, {
          election: el.key,
          id,
        });
      }
      const net = indiaNetWorth(c.assets, c.liabilities);
      const income = c.income.filter((r) => r.income !== null);
      return NextResponse.json({
        ok: true,
        kind,
        election: el.key,
        candidate: c,
        net,
        cagr: declaredCagr([{ election: el.label, assets: c.assets, band: c.assetsBand, cases: c.cases }, ...c.history]),
        selfIncome: income.filter((r) => r.relation === "self").length,
        incomeYears: [...new Set(income.map((r) => r.fy))].length,
        caveat:
          "DECLARED IN RUPEES ON THE AFFIDAVIT DATE, COVERING SELF, SPOUSE, HUF AND DEPENDENTS TOGETHER. INDIA FILES NO TRANSACTION REPORT, SO NOTHING BETWEEN TWO ELECTIONS IS VISIBLE. A NET WORTH FIGURE HERE IS A DECLARATION, NOT A VALUATION.",
      });
    } catch (e) {
      return fail(kind, msg(e), { election: el.key, id });
    }
  }

  return fail(kind, `UNKNOWN KIND "${kind.toUpperCase()}". VALID: SOURCES, US, UK, UKINTERESTS, UKREGISTER, ROSTER, CANDIDATE.`);
}

/** Exported so the desk's source panel and the route can never drift apart. */
export type { PoliSource };