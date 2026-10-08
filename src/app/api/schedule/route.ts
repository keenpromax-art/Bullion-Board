import { NextRequest, NextResponse } from "next/server";
import { resolveNotes } from "@/lib/filingsSource";

// Ledger drill-down. This was an intentional empty stub: Yahoo's
// fundamentals-timeseries has no schedule breakdown and screener.in's
// Company.showSchedule has no Yahoo equivalent, so it returned count 0 and the
// UI rendered "NO BREAKUP ON FEED".
//
// It is now backed by EDGAR's rendered note reports (see /api/filings/notes):
// a 10-K/10-Q carries the Borrowings, Debt, Commitments and segment schedules
// as its own R-file tables, which is exactly what a ledger row was asking for.
//
// The response contract is UNCHANGED — { rows: [{ label, values keyed by
// period label }] } — so CapitalDesks and FundaDesks consume this without a
// fork. Values stay strings, because they are the issuer's printed text.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const symbol = (sp.get("symbol") || "").trim().toUpperCase();
  const parent = (sp.get("parent") || "").trim().slice(0, 80);
  const section = (sp.get("section") || "profit-loss").trim().slice(0, 40);
  const ua = sp.get("secua");

  if (!symbol) {
    return NextResponse.json({ symbol, parent, section, count: 0, rows: [], source: "no symbol supplied" });
  }

  // Resolved in-process, not over HTTP. An earlier version called
  // /api/filings/notes against a constructed origin, which works in dev and
  // breaks on any deployment without one — and would fall back to "no
  // breakdown" rather than failing loudly. Sharing the resolver also keeps the
  // throttle, the contact header and the honest-error shape in one place.
  const payload = await resolveNotes(symbol, parent, { ua });

  if (!payload?.ok) {
    return NextResponse.json({
      symbol,
      parent,
      section,
      count: 0,
      rows: [],
      source: payload?.error ?? "filings notes unavailable",
    });
  }

  return NextResponse.json({
    symbol,
    parent,
    section,
    count: payload.count ?? 0,
    rows: payload.rows ?? [],
    accession: payload.accession ?? null,
    form: payload.form ?? null,
    source: `${payload.source ?? "EDGAR"} / SECTION ${section.toUpperCase()}`,
    // The note index travels with the answer so a UI can offer the other
    // schedules without a second round trip.
    reportsAvailable: payload.reportsAvailable ?? [],
  });
}
