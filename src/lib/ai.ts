// OpenRouter AI helper — replaces every _ai_call / _load_or_config / streaming
// chat helper in special.py. All keys stay client-side; the server route
// /api/ai/chat proxies to OpenRouter so keys are never bundled.

export const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

export const FREE_MODELS = [
  { id: "nvidia/nemotron-3-super-120b-a12b:free", name: "NEMOTRON 3 SUPER" },
  { id: "deepseek/deepseek-chat-v3-0324:free", name: "DEEPSEEK V3" },
  { id: "google/gemma-3-27b-it:free", name: "GEMMA 3 27B" },
  { id: "qwen/qwen3-235b-a22b:free", name: "QWEN 3 235B" },
  { id: "meta-llama/llama-3.3-70b-instruct:free", name: "LLAMA 3.3 70B" },
];

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function chatComplete(
  messages: ChatMessage[],
  opts?: { model?: string; apiKey?: string }
): Promise<string> {
  const res = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      model: opts?.model ?? DEFAULT_MODEL,
      apiKey: opts?.apiKey ?? "",
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI request failed (${res.status}): ${t.slice(0, 300)}`);
  }
  const j = await res.json();
  return j.text ?? "";
}

// Token-streaming chat: OpenRouter SSE is proxied through /api/ai/chat
// (stream: true) and re-assembled here, calling onToken per fragment.
export async function streamChat(
  messages: ChatMessage[],
  opts: { model?: string; apiKey?: string; signal?: AbortSignal; onToken: (t: string) => void }
): Promise<string> {
  const res = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      model: opts?.model ?? DEFAULT_MODEL,
      apiKey: opts?.apiKey ?? "",
      stream: true,
    }),
    signal: opts?.signal,
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    throw new Error(`AI ${res.status}: ${t.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const p of parts) {
      const line = p
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.startsWith("data:"));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const tok = JSON.parse(payload)?.choices?.[0]?.delta?.content ?? "";
        if (tok) {
          full += tok;
          opts.onToken(tok);
        }
      } catch {
        /* partial JSON frame — wait for more bytes */
        buf = `${p}\n\n${buf}`;
        break;
      }
    }
  }
  return full;
}
