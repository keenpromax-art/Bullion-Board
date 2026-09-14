import { NextRequest, NextResponse } from "next/server";

// Server-side OpenRouter proxy — mirrors every _ai_call() in special.py.
// The browser never needs the key baked in; it sends it per-request (stored in
// localStorage). Falls back to OPENROUTER_API_KEY env on Vercel if set.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export async function POST(req: NextRequest) {
  let body: { messages?: Array<{ role: string; content: string }>; model?: string; apiKey?: string; stream?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const apiKey = body.apiKey || process.env.OPENROUTER_API_KEY || "";
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing OpenRouter API key. Set it in Settings or OPENROUTER_API_KEY env." },
      { status: 401 }
    );
  }
  const model = body.model || process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-super-120b-a12b:free";
  // House decoding defaults: factual but conversational enough for full
  // Q&A answers. Auto-summaries stay short via their prompts; Q&A needs room.
  const temperature = 0.4;
  const max_tokens = 1400;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "HTTP-Referer": req.headers.get("origin") ?? "https://localhost",
    "X-Title": "Bullion Board",
  };
  // Streaming mode: pipe OpenRouter SSE straight through to the browser.
  if (body.stream) {
    try {
      const r = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({ model, messages: body.messages ?? [], stream: true, temperature, max_tokens }),
      });
      if (!r.ok || !r.body) {
        const t = await r.text();
        return NextResponse.json({ error: `OpenRouter ${r.status}: ${t.slice(0, 500)}` }, { status: 502 });
      }
      return new Response(r.body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "AI stream failed";
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }
  try {
    const r = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, messages: body.messages ?? [], temperature, max_tokens }),
    });
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: `OpenRouter ${r.status}: ${t.slice(0, 500)}` }, { status: 502 });
    }
    const j = await r.json();
    const text: string = j?.choices?.[0]?.message?.content ?? "";
    return NextResponse.json({ text, model, raw: j });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "AI call failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
