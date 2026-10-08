import { NextRequest, NextResponse } from "next/server";

/**
 * Validate an OpenRouter key without spending anything useful.
 *
 * WHY THIS EXISTS. The settings screen stored a key and reported `● SET`, which
 * is indistinguishable from `● WORKING`. The reader found out their key was
 * wrong, revoked, or mistyped when a desk 402'd some time later, in a context
 * that gave them no idea which credential was at fault. A paste box that cannot
 * tell you whether what you pasted is valid is half a feature.
 *
 * It answers three questions at once and nothing more:
 *   - does this key authenticate at all (401)?
 *   - is the failure a rate limit or a credit problem, which look identical as
 *     "it didn't work" but need completely different fixes (429 / 402)?
 *   - which model answered, so a working key on a retired model is
 *     distinguishable from a broken key.
 *
 * One token, one model, no streaming. It is the cheapest request OpenRouter
 * serves. The key is never echoed back — only whether it worked.
 *
 * No caching: a test that could return a cached PASS after a key was revoked
 * would be worse than no test.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export async function POST(req: NextRequest) {
  let body: { apiKey?: string; model?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const key = (body.apiKey || "").trim() || process.env.OPENROUTER_API_KEY || "";
  if (!key) {
    return NextResponse.json({ ok: false, verdict: "NO KEY", detail: "Nothing to test — paste a key or set OPENROUTER_API_KEY." }, { status: 200 });
  }
  const usingOwnKey = !!(body.apiKey || "").trim();
  const model = body.model || "nvidia/nemotron-3-super-120b-a12b:free";

  try {
    const r = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "HTTP-Referer": req.headers.get("origin") ?? "https://localhost",
        "X-Title": "Bullion Board",
      },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    const source = usingOwnKey ? "YOUR KEY" : "SERVER KEY";

    if (r.ok) {
      const j: any = await r.json();
      return NextResponse.json({
        ok: true,
        verdict: "WORKS",
        detail: `${source} authenticated on ${j?.model ?? model}.`,
        model: j?.model ?? model,
        source,
      });
    }

    const t = await r.text();
    // The three failure modes look identical to the user but need different
    // fixes, so they are named rather than collapsed into "failed".
    const map: Record<number, string> = {
      401: "REJECTED — that key is invalid, revoked, or mistyped. Copy it again from openrouter.ai/keys.",
      402: "NO CREDIT — the key is valid but has no balance. Free models still need a topped-up account.",
      403: "BLOCKED — OpenRouter refused this key for this model. Pick another model, or check the key's permissions.",
      429: "RATE LIMITED — the key is valid, the free tier is just busy. This is not a key problem.",
      404: "MODEL GONE — the key may be fine but that model id has left the catalogue. Pick another model.",
    };
    return NextResponse.json({
      ok: false,
      // 404 gets its own verdict rather than falling into the HTTP-n catch-all: a
// retired model id and a broken key BOTH make "test" fail, and telling someone
// to re-copy a key they already pasted correctly is worse than useless.
verdict:
  r.status === 401 ? "INVALID"
  : r.status === 402 ? "NO CREDIT"
  : r.status === 403 ? "BLOCKED"
  : r.status === 404 ? "MODEL GONE"
  : r.status === 429 ? "RATE LIMITED"
  : `HTTP ${r.status}`,
      detail: map[r.status] ?? `OpenRouter ${r.status}: ${t.slice(0, 200)}`,
      source,
    });
  } catch (e: unknown) {
    return NextResponse.json({
      ok: false,
      verdict: "UNREACHABLE",
      detail: e instanceof Error ? e.message : "Could not reach OpenRouter.",
    });
  }
}