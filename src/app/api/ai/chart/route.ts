import { NextRequest, NextResponse } from "next/server";
import { aiSystem } from "@/lib/ai";

// Grounded chart commentary.
//
// WHY A DEDICATE ROUTE. The general /api/ai/chat takes a client-supplied model
// and key, which is right for chat. This takes neither: the model is the
// server's choice and the key is never accepted from the browser. Chart
// commentary is called automatically from panels all over the product, so a
// browser-supplied key would mean an auto-called feature that silently does
// nothing for anyone who hasn't pasted one in.
//
// WHY IT COMPUTES THE STATS ITSELF. A model cannot count points off an image,
// and this endpoint never sends one — so the caller supplies the raw series and
// the arithmetic happens HERE, in TypeScript, where it is exact. The model is
// handed finished numbers and is explicitly forbidden from describing shape.
// That inversion is the whole design: every number it can say is one we
// computed, so a hallucinated figure has nowhere to enter.
//
// Cheap on purpose: no cache header, small max_tokens, one round trip. It is
// user-initiated (a button), not automatic, so cost is bounded by clicks.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface ChartSeriesIn {
  label: string;
  values: (number | null)[];
  /** Optional pre-computed volatility for the series, e.g. realised vol %. */
  vol?: number | null;
}

function finite(v: unknown): v is number {
  return typeof v === "number" && isFinite(v);
}

/** Descriptive stats for one series. NaN-safe by construction: an empty or
 *  all-null series returns nulls rather than infinities. */
function stats(values: (number | null)[]) {
  const f = values.filter(finite);
  if (f.length < 2) return null;
  const first = f[0]!;
  const last = f[f.length - 1]!;
  const lo = Math.min(...f);
  const hi = Math.max(...f);
  const mean = f.reduce((a, b) => a + b, 0) / f.length;
  // Population sd of first differences scaled to a per-step percentage, which is
  // the honest generalisation: it is "typical bar-to-bar move", not an annualised
  // figure, because we do not know the bar's calendar length here.
  const rets: number[] = [];
  for (let i = 1; i < f.length; i++) {
    const p = f[i - 1]!;
    if (finite(p) && p !== 0) rets.push(((f[i]! - p) / Math.abs(p)) * 100);
  }
  const sd = rets.length < 2 ? null : Math.sqrt(rets.reduce((a, b) => a + b * b, 0) / rets.length);
  return {
    n: f.length,
    first,
    last,
    lo,
    hi,
    range: hi - lo,
    pctFromFirst: first !== 0 ? ((last - first) / Math.abs(first)) * 100 : null,
    // Where the last print sits in the range, 0 = the low, 1 = the high.
    posInRange: hi === lo ? null : (last - lo) / (hi - lo),
    mean,
    sd,
    sdPct: sd === null ? null : sd / Math.max(Math.abs(mean), 1e-9),
  };
}

const fmt = (v: number | null | undefined, dp = 2) =>
  v === null || v === undefined || !finite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });

/**
 * Reasoning models do not all keep their chain of thought hidden.
 *
 * Nemotron Super returns it in a separate `reasoning` field and behaves. Nemotron
 * Ultra returned its ENTIRE scratchpad as `content` — "The user wants a chart
 * commentary strip...", "Given data:", "Sentence 1: ..." — and because
 * max_tokens cut it off mid-sentence, `finish_reason` was "length" with
 * non-empty content. The strip is three lines; a returned scratchpad is not a
 * usable answer even though every word of it came from the model.
 *
 * So the output is gated rather than trusted. Markers from the leaked reasoning
 * are dropped, markdown bullets are unwrapped, and what survives must still look
 * like the three sentences the prompt asked for. If nothing does, this is
 * treated as a model failure and the chain moves on — an empty strip with a
 * reason is far better than a paragraph of another model's private notes.
 */
function sanitise(raw: string): string | null {
  const drop = /^(i\b|i'?m|let me|note\b|sentence\b|given\b|based on|the user|here'?s|to (produce|summarise|summarize)|in this case|the example|sentence \d|\d+\.\s|-{1,2}\s|\*{1,2}|#{1,6}|data:|answer:)/i;
  const lines = raw
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/^[\s>*#\-•]+/, "").trim())
    .filter((l) => l.length > 0)
    .filter((l) => !drop.test(l));
  const out = lines.slice(0, 3).join(" ").replace(/\s{2,}/g, " ").trim();
  // A real answer is a sentence or two; anything this short is a fragment.
  if (out.length < 40) return null;
  return out;
}

export async function POST(req: NextRequest) {
  let body: {
    series?: ChartSeriesIn[];
    symbol?: string;
    desk?: string;
    model?: string;
    label?: string;
    /** Extra context the caller already has on screen, e.g. "PRICE · 50D MA". */
    context?: string;
    /**
     * The reader's own OpenRouter key. Accepted here for the same reason
     * /api/ai/chat accepts it — the product's whole key model is "server
     * default, per-browser override" — and NOT accepting it made this the one
     * AI surface in the app that ignored a key the user had set in Settings.
     */
    apiKey?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const key = (body.apiKey || "").trim() || process.env.OPENROUTER_API_KEY || "";
  if (!key) {
    return NextResponse.json(
      { error: "No OpenRouter key — add your own in Settings, or set OPENROUTER_API_KEY on the server." },
      { status: 401 }
    );
  }
  const usingOwnKey = !!(body.apiKey || "").trim();

  const series = (body.series ?? []).filter((s) => s && Array.isArray(s.values));
  if (!series.length) {
    return NextResponse.json({ error: "No series supplied" }, { status: 400 });
  }

  const computed = series
    .map((s) => ({ label: s.label, st: stats(s.values), vol: finite(s.vol) ? s.vol : null }))
    .filter((s) => s.st !== null);

  if (!computed.length) {
    // Fewer than two real points on every series: there is nothing to comment
    // on, and the honest answer is to say so rather than let a model fill it.
    return NextResponse.json({ error: "Not enough points to describe this series" }, { status: 200 });
  }

  const symbol = (body.symbol || "").trim().toUpperCase();
  // Phrased as labelled prose rather than FIELD=value pairs. With the raw keys the
  // model echoed the field NAMES back verbatim ("CHANGE_SINCE_FIRST_PCT 6.74"),
  // which tells the reader nothing — the names are our schema, not an insight.
  const lines = computed.map((s) => {
    const st = s.st!;
    const out: string[] = [
      `SERIES: ${s.label}`,
      `NUMBER OF BARS DRAWN: ${st.n}`,
      `FIRST BAR: ${fmt(st.first)}`,
      `LAST BAR: ${fmt(st.last)}`,
      `LOWEST BAR: ${fmt(st.lo)}`,
      `HIGHEST BAR: ${fmt(st.hi)}`,
      `SPAN BETWEEN LOW AND HIGH: ${fmt(st.range)}`,
    ];
    if (st.pctFromFirst !== null) out.push(`CHANGE FROM FIRST TO LAST: ${fmt(st.pctFromFirst)}%`);
    if (st.posInRange !== null) out.push(`LAST PRINT SITS ${(st.posInRange * 100).toFixed(0)}% OF THE WAY UP THE SPAN, MEASURED FROM THE LOW`);
    if (s.vol !== null) out.push(`AVERAGE SIZE OF A BAR-TO-BAR MOVE: ${fmt(s.vol)}%`);
    return out.join("\n");
  });

  const user =
    `${body.label ? `CHART: ${body.label}\n` : ""}` +
    `${symbol ? `SECURITY: ${symbol}\n` : ""}` +
    `${body.desk ? `DESK: ${body.desk}\n` : ""}` +
    `${body.context ? `ON SCREEN: ${body.context}\n` : ""}` +
    `\n${lines.join("\n\n")}`;

  const model = body.model || process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-super-120b-a12b:free";

  // Free models are REASONING models. Nemotron 3 emitted 464 characters of
  // hidden reasoning before writing a single visible word, so the original
  // max_tokens of 180 was spent before the answer existed — the API returned
  // finish_reason "length" with an EMPTY content string, which surfaced as
  // `ok:false` and a blank box. The budget then had to rise again for the
  // larger models, whose scratchpads run past 1,000 characters before they
  // answer. 1200 covers the worst free model seen; the strip itself is three
  // lines and the prompt says so, so this is headroom, not a long answer.
  const max_tokens = 1200;

  /**
   * Fallback chain. The free tier rate-limits PER MODEL and gates some models
   * outright, so a single model makes this feature look broken rather than busy.
   *
   * Every entry below was probed against /chat/completions on the day this was
   * written. Two free models were REMOVED from the chain because they answer 403
   * with "only available on agentic harnesses" — `thinkingmachines/inkling` and
   * `thinkingmachines/inkling-small`. They are listed in /api/ai/models, because
   * that route reports the catalogue as published rather than as filtered by what
   * this particular app can use, and picking one simply fails honestly.
   *
   * Ordered across different vendors on purpose: the limit is per model, so two
   * models behind one provider throttle together.
   */
  const chain = Array.from(new Set([
    model,
    "nvidia/nemotron-3-super-120b-a12b:free",
    "nvidia/nemotron-3.5-lightning:free",
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "dots-studio/dots-3-note-preview:free",
    "apodex/apodex-1.1-mini:free",
    "inclusionai/ling-3.0-flash-sante:free",
    "cohere/north-mini-code:free",
    "liquid/lfm-2.5-2.6b:free",
  ]));
  const tried: string[] = [];

  for (const m of chain) {
    tried.push(m);
    try {
      const r = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          "HTTP-Referer": req.headers.get("origin") ?? "https://localhost",
          "X-Title": "Bullion Board",
        },
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify({
          model: m,
          temperature: 0.2,
          max_tokens,
          messages: [
            { role: "system", content: aiSystem.chartComment(body.desk) },
            { role: "user", content: user },
          ],
        }),
      });

      if (!r.ok) {
        // Per-model conditions worth retrying elsewhere rather than reporting as
        // a dead feature:
        //   429 — free-tier rate limit
        //   404 — model has left the catalogue
        //   403 — model is gated to other harnesses. `thinkingmachines/inkling`
        //          answers 403 with "only available on agentic harnesses", which
        //          is a property of THAT model, not of this request.
        // A 401 is different: that is the key, and retrying cannot fix it.
        if (r.status === 429 || r.status === 404 || r.status === 403) continue;
        const t = await r.text();
        return NextResponse.json({ error: `OpenRouter ${r.status}: ${t.slice(0, 300)}` }, { status: 502 });
      }

      const j: any = await r.json();
      const raw: string = j?.choices?.[0]?.message?.content ?? "";
      // Gated, not trusted: empty content is one failure mode (reasoning ate the
      // whole budget) and a leaked scratchpad is the other. Both mean "this model
      // did not answer", so both fall through to the next entry in the chain.
      const text = sanitise(raw);
      if (!text) continue;

      return NextResponse.json({
        ok: true,
        text,
        model: j?.model ?? m,
        // Which credential actually answered. Useful when a user has both set:
        // if the strip keeps working after CLEARING their key, the server default
        // was covering for a broken one.
        keySource: usingOwnKey ? "YOUR KEY" : "SERVER KEY",
        stats: computed.map((c) => ({ label: c.label, ...c.st })),
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "AI commentary failed";
      // A timeout on one model is worth trying the next; a hard auth failure is
      // not, and re-reporting it on every model would just triple the latency.
      if (/abort|timeout/i.test(msg)) continue;
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  return NextResponse.json(
    {
      error: `NO FREE MODEL ANSWERED — tried ${tried.length} (${tried.map((t) => t.split("/").pop()).join(", ")}). THE FREE TIER IS RATE-LIMITED; TRY AGAIN IN A MOMENT.`,
      tried,
    },
    { status: 502 }
  );
}