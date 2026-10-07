import { NextResponse } from "next/server";

// Live free-model catalogue.
//
// WHY THIS ROUTE EXISTS. FREE_MODELS was a hardcoded array of five ids, and four
// of them are gone: deepseek-chat-v3-0324, gemma-3-27b-it, qwen3-235b-a22b and
// llama-3.3-70b-instruct are no longer served on the :free tier. Only Nemotron
// Super survived. A picker built from a frozen list silently offers dead models
// and the failure surfaces as a 404 from OpenRouter on the user's first click,
// which is the worst place to discover it.
//
// So the list is READ, not written. OpenRouter's /api/v1/models is public and
// needs no key, so this endpoint never touches the credential and cannot leak it.
//
// DAILY REFRESH is the `revalidate` below: Next re-fetches the catalogue once a
// day and serves the cached copy in between. OpenRouter rotates its free tier
// constantly — between today and last week this list gained a 1M-context
// Nemotron Ultra and two Gemma 4s while losing four of the five — so a weekly
// cadence would already be stale, and per-request fetching would hammer their
// API for a list that changes once in a while.
//
// If OpenRouter is unreachable the client falls back to FALLBACK_MODELS rather
// than showing an empty picker, because a working list five minutes old beats
// an honest but useless empty one.

export const revalidate = 86400;

const OPENROUTER_MODELS = "https://openrouter.ai/api/v1/models";

/** Trim the vendor prefix and the ":free" suffix into something a 28px pill can hold. */
function shortName(id: string): string {
  return id
    .replace(/:free$/, "")
    .split("/")
    .pop()!
    .replace(/-it$/, "")
    .replace(/-preview$/, "")
    .toUpperCase();
}

export async function GET() {
  try {
    const r = await fetch(OPENROUTER_MODELS, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) throw new Error(`openrouter ${r.status}`);
    const j: any = await r.json();
    const rows: any[] = Array.isArray(j?.data) ? j.data : [];

    const models = rows
      // Two tests, not one. The ":free" suffix is the documented marker, but
      // pricing is what actually decides whether a request is billed, and a
      // mispriced id would surface as a surprise bill rather than an error.
      .filter((m) => typeof m?.id === "string" && m.id.endsWith(":free"))
      .filter((m) => String(m?.pricing?.prompt) === "0" && String(m?.pricing?.completion) === "0")
      .map((m) => ({
        id: m.id as string,
        name: shortName(m.id as string),
        context: Number.isFinite(Number(m?.context_length)) ? Number(m.context_length) : null,
      }))
      // Biggest context first: on a financial terminal the long-context models
      // are the ones that can hold a filing or a wide statement table at all.
      .sort((a, b) => (b.context ?? 0) - (a.context ?? 0) || a.id.localeCompare(b.id));

    if (!models.length) throw new Error("openrouter returned no free models");

    return NextResponse.json({
      ok: true,
      count: models.length,
      models,
      fetchedAt: new Date().toISOString(),
      refreshHours: 24,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `MODEL CATALOGUE UNAVAILABLE — ${e?.message ?? "unknown"}`, models: [] },
      { status: 200 }
    );
  }
}