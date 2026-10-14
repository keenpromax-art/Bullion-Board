"use client";

// One line per desk: <DeskPlanGate symbol={symbol} />
//
// The dedicated desks do not pass through GenericDeskContent, so they cannot
// inherit the plan the way the fall-through modules do. They also each fetch
// their own endpoint, so none of them already holds the standard indicator block
// the plan is built from. Re-fetching it inside every desk would mean N extra
// round trips and N chances for the copies to drift.
//
// So the gate fetches it once, on demand, and renders the shared panel. A desk
// that already had a plan keeps its own - this is additive, never a replacement,
// because the Order Flow desk's intraday read and this daily read are different
// questions about the same name.
//
// Reference desks - filings, registers, readers - pass `note` instead and get an
// honest statement of what the desk is for, in the same slot a plan would use. A
// stop-loss on a House disclosure is nonsense, so there is deliberately no way to
// ask this component for one on a desk that has no price.

import { useEffect, useState } from "react";
import DeskPlanPanel from "@/components/DeskPlanPanel";
import { buildDailyPlan, type DeskPlan } from "@/lib/deskplan";
import { useDeskFetch } from "@/lib/useDeskFetch";

interface AnalysisPayload {
  price?: number;
  bars?: Array<{ high: number; low: number; close: number; volume: number }>;
  indicators?: Record<string, unknown>;
  risk?: Record<string, unknown>;
  extra?: { signal?: string };
}

/**
 * Build the daily plan for a symbol. Returns null until it is ready.
 *
 * Silently absent rather than erroring is deliberate: this is an addition to a
 * desk that already has its own loading and error handling. A failed plan fetch
 * must not replace a working desk with an error box.
 */
export function useDailyPlan(symbol: string | null | undefined): DeskPlan | null {
  const sym = (symbol ?? "").trim();
  const url = sym ? `/api/analysis/3?symbol=${encodeURIComponent(sym)}&range=1y` : null;
  const { data, err } = useDeskFetch<AnalysisPayload>(url);
  const [plan, setPlan] = useState<DeskPlan | null>(null);

  useEffect(() => {
    if (err || !data || !data.bars?.length) {
      setPlan(null);
      return;
    }
    const px =
      typeof data.price === "number" && data.price > 0
        ? data.price
        : data.bars[data.bars.length - 1]?.close ?? 0;
    try {
      setPlan(
        buildDailyPlan({
          price: px,
          bars: data.bars,
          indicators: (data.indicators ?? {}) as never,
          risk: (data.risk ?? {}) as never,
          deskSignal: data.extra?.signal ? String(data.extra.signal) : undefined,
        })
      );
    } catch {
      // A malformed payload must not take the desk down with it.
      setPlan(null);
    }
  }, [data, err]);

  return plan;
}

/**
 * Reference-desk notes, by family.
 *
 * Written per family rather than generated, because a desk that fills the slot
 * with boilerplate is worse than a desk that leaves it empty — it looks like an
 * explanation while saying nothing. Each one names what this class of source is
 * actually good for AND the specific way it misleads.
 */
export const READ_NOTES: Record<string, { note: string; caveat: string }> = {
  fundamentals: {
    note:
      "STATEMENTS ARE LAGGING BY CONSTRUCTION. THE FIGURES HERE ARE WHAT THE COMPANY REPORTED, NOT WHAT IS TRUE TODAY, AND " +
      "THEY ARE ONLY AS RECENT AS THE LAST FILED QUARTER. RATIOS COMPUTED FROM THEM DESCRIBE A BUSINESS AS IT WAS, NOT AS " +
      "IT IS TRADING. USE THEM TO CHECK WHETHER THE PRICE IS DEFENSIBLE BY THE FUNDAMENTALS — NEVER TO TIME AN ENTRY. THE " +
      "MOST COMMON WAY THESE DESKS ARE MISREAD IS TREATING A GOOD BALANCE SHEET AS A BUY SIGNAL; IT IS A REASON NOT TO " +
      "SHORT SOMETHING.",
    caveat:
      "THIS IS A RECORD OF FILED FIGURES, NOT A VALUATION AND NOT A SIGNAL. NO PRICE, ENTRY, TARGET OR STOP IS IMPLIED. " +
      "ACCOUNTING IS JUDGEMENT: EVERY RATIO HERE IS THE PRODUCT OF ESTIMATES SOMEONE ELSE MADE. READ THE NOTES ON THE " +
      "DESK BEFORE YOU TRUST A LINE.",
  },
  filings: {
    note:
      "FILINGS AND REGISTERS ARE FACTS ABOUT THE PAST, LAGGING BY DESIGN. A DISCLOSURE ARRIVES WEEKS OR MONTHS AFTER THE " +
      "BEHAVIOUR IT DESCRIBES, SO TRADES YOU CAN SEE IN HERE HAVE ALREADY HAPPENED. THE CORRECT USE IS CONFIRMATION AND " +
      "DUE DILIGENCE: DID MANAGEMENT DO WHAT THEY TOLD YOU THEY WOULD DO? THE COMMON MISTAKE IS TRADEABLE ATTRIBUTION " +
      "FROM THESE PAGES — THE ACT IS PUBLIC THE MOMENT IT IS FILED, AND BY THE TIME IT IS EASY TO FIND, THE PRICE HAS " +
      "ALREADY REPRICED.",
    caveat:
      "NOTHING HERE IS REAL-TIME AND NOTHING HERE IS A SIGNAL. THE REGISTER OF FINANCIAL Interests, the ownership filings " +
      "and the dividend record all describe what was declared, not what to do next. NO POSITION, ENTRY, TARGET OR STOP IS " +
      "IMPLIED BY ANY FIGURE ON THIS DESK.",
  },
  news: {
    note:
      "HEADLINES CARRY FACTS AND THE PRICING CARRIES THE REACTION. THE GAP BETWEEN them is where news desks get misused: a " +
      "story that looks enormous can be fully priced, and a quiet filing can be the thing that matters. USE THIS DESK TO " +
      "FIND OUT WHAT CHANGED AND WHEN — THEN CHECK THE PRICE'S OWN REACTION BEFORE DECIDING ANYTHING. A HEADLINE YOU HAVE " +
      "NOT SEEN IS USUALLY A HEADLINE THE MARKET HAS ALREADY PRICED.",
    caveat:
      "A HEADLINE IS NOT A FACT AND A STORY IS NOT AN EDGE. EVERY ITEM HERE IS A LEAD TO INVESTIGATE, TIMESTAMPED AS " +
      "PUBLISHED, AND PUBLICATION TIME IS NOT THE SAME AS THE TIME THE MARKET LEARNED IT. NO TRADE IS IMPLIED.",
  },
  people: {
    note:
      "DISCLOSURE REGISTERS ARE A LONGEST-LOOKING-BIAS MACHINE, and that is their whole value. They cannot tell you what " +
      "happened this morning; they can tell you what a specific person has done, repeatedly, over years — which is a " +
      "different and slower question. READ THEM AS CHARACTER EVIDENCE, NOT AS TIMING. THE HONEST LIMIT IS THE CADENCE: " +
      "US FILINGS ARE QUARTERLY AND LATE, UK RETURNS ARE FILED TO PARLIAMENT, AND INDIA'S ARE FILED AT ELECTION TIME, " +
      "NOT IN REAL TIME. None of the three is a live feed.",
    caveat:
      "NO POSITION, ENTRY, TARGET OR STOP IS IMPLIED. A DISCLOSURE IS EITHER SELF-REPORTED OR UNVERIFIED, IS PUBLISHED ON " +
      "THE REGISTRY'S SCHEDULE RATHER THAN ON THE TRADE'S, AND SAYS NOTHING ABOUT ANYTHING THAT HAPPENED SINCE. WHAT A " +
      "PERSON DECLARED IS NOT A PREDICTION OF WHAT THEY WILL DO NEXT.",
  },
  market: {
    note:
      "MARKET-WIDE DESKS HAVE NO SINGLE SECURITY TO TRADE, so there is no entry, no target and no stop here — by design, " +
      "not by omission. WHAT THEY ARE FOR IS REGIME: WHICH OF THESE CONDITIONS ARE YOU OPERATING IN, AND DOES THAT CHANGE " +
      "THE SIZE YOU TAKE ANYWHERE ELSE ON THE BOARD. A BROAD, UNDIRECTIONAL TAPE IS AN ARGUMENT FOR SMALLER POSITIONS " +
      "AND TIGHTER STOPS ON EVERY OTHER DESK, AND THIS IS WHERE THAT ARGUMENT GETS MADE.",
    caveat:
      "NO POSITION, ENTRY, TARGET OR STOP IS IMPLIED. BREADTH, VOLUME AND CORRELATION DESCRIBE THE TAPE AS A WHOLE; THEY " +
      "DO NOT PICK A SECURITY, AND A REGIME CALL IS A REASON TO SIZE DIFFERENTLY RATHER THAN A REASON TO BUY SOMETHING.",
  },
  reader: {
    note:
      "THIS DESK IS A READER, NOT AN ANALYST. IT GIVES YOU THE TEXT — primary source, reference, or your own notes — " +
      "because the most valuable analysis in this terminal is still the kind you do after reading something properly. " +
      "WHAT YOU DO WITH IT, AND WHETHER IT IS WORTH ANYTHING, IS NOT A QUESTION ANY PANEL ON THIS SCREEN CAN ANSWER FOR YOU.",
    caveat:
      "NOTHING HERE IS A SIGNAL AND NOTHING HERE IS A SOURCE OF TRADES. THE TEXT MAY BE OUT OF DATE, INCOMPLETE OR WRONG " +
      "— CHECK THE ORIGINAL BEFORE RELYING ON ANYTHING YOU READ HERE. NO POSITION IS IMPLIED.",
  },
};

/** Reference desks: what this desk is for, and what it cannot tell you. */
export function ReadNotePanel({
  title,
  family,
}: {
  title: string;
  family: keyof typeof READ_NOTES | string;
}) {
  const spec = READ_NOTES[family] ?? READ_NOTES.reader;
  const plan: DeskPlan = {
    stance: "REFERENCE",
    stanceTone: "",
    badge: "NO TRADE",
    flags: [],
    headline: "THIS DESK IS A SOURCE, NOT A SIGNAL",
    entryText:
      "THERE IS NO ENTRY, TARGET OR STOP HERE ON PURPOSE. THIS DESK REPORTS WHAT WAS FILED, REGISTERED OR PUBLISHED; WHAT TO DO WITH IT IS A SEPARATE DECISION AND IT IS YOURS.",
    levels: [],
    profitRules: [
      "NO POSITION IS IMPLIED BY ANYTHING ON THIS DESK. NOTHING HERE HAS AN ENTRY, A TARGET OR A STOP.",
      "TREAT EVERY FIGURE AS A LEAD TO INVESTIGATE, NOT A CONCLUSION.",
      "IF YOU CANNOT STATE WHAT WOULD CHANGE YOUR MIND, YOU ARE NOT READING THIS — YOU ARE LOOKING FOR CONFIRMATION.",
    ],
    invalidation: "",
    confluence: [],
    against: [],
    caveat: spec.caveat,
  };
  return <DeskPlanPanel plan={plan} title={title} readNote={spec.note} />;
}

/** Reference desks take no symbol, so this is a plain component, not a gate. */
export function ReadNoteGate({
  family,
  title,
}: {
  family: string;
  title: string;
}) {
  return <ReadNotePanel title={title} family={family} />;
}


export default function DeskPlanGate({
  symbol,
  title = "Trade plan",
  bare = false,
}: {
  symbol?: string | null;
  title?: string;
  bare?: boolean;
}) {
  const plan = useDailyPlan(symbol);
  if (!plan) return null;
  // Nothing usable came back (too few bars, no bands) - stay out of the way
  // rather than printing a NO DATA box above a desk that is showing fine.
  if (plan.badge === "NO DATA") return null;
  return (
    <DeskPlanPanel plan={plan} title={title} symbol={symbol ?? undefined} bare={bare} />
  );
}
