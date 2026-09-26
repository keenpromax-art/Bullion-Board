"use client";

// Contextual AI panel (spec §S6/§14) — shares the desktop `iss.ai.sessions`
// storage so conversations move between phone and terminal. Attaches the
// current screen context automatically and always carries NO_INVENT.

import { useEffect, useMemo, useRef, useState } from "react";
import { aiSystem, streamChat, NO_INVENT, type ChatMessage } from "@/lib/ai";
import { store } from "@/lib/store";
import { ErrorState, Skeleton } from "./Pills";

interface Msg {
  role: "user" | "assistant";
  text: string;
  time: string;
}

interface Session {
  id: number;
  title: string;
  ticker: string;
  msgs: Msg[];
  updated: string;
}

const KEY = "iss.ai.sessions";
const now = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function loadSessions(): Session[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as Session[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveSessions(list: Session[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, 40)));
  } catch {
    /* quota */
  }
}

export default function AIChatPanel({
  context,
  desk,
  symbol,
  placeholder = "ASK ANYTHING ABOUT THIS SCREEN…",
  sessionTitle,
  initialQuery,
}: {
  /** Short string describing the current screen, injected into the prompt. */
  context: string;
  desk: string;
  symbol?: string | null;
  placeholder?: string;
  sessionTitle?: string;
  /** Fire once on mount (deep link from search: /ai?q=…). */
  initialQuery?: string;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sessionId] = useState(() => Date.now());
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Resume the most recent session for this ticker, else start fresh.
  useEffect(() => {
    try {
      const list = loadSessions();
      const match = symbol ? list.find((s) => s.ticker === symbol) : list[0];
      setMsgs(match ? match.msgs : []);
    } catch {
      setMsgs([]);
    }
    return () => abort.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [msgs, busy]);

  // deep-linked question (from /ai?q= or search hand-off)
  const fired = useRef(false);
  useEffect(() => {
    if (!initialQuery || fired.current || busy) return;
    fired.current = true;
    void send(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  const suggestions = useMemo(() => {
    const base = symbol ? symbol.replace(/\.(NS|BO)$/, "") : "THIS MARKET";
    return [
      `WHY DID ${base} MOVE TODAY?`,
      "WHAT CHANGED IN THE NUMBERS?",
      "WHAT ARE THE KEY RISKS HERE?",
      "WHAT SHOULD I WATCH NEXT?",
    ];
  }, [symbol]);

  function persist(next: Msg[]) {
    try {
      const list = loadSessions();
      const title = sessionTitle ?? (symbol ? `${symbol} · ${desk}` : desk);
      const idx = list.findIndex((s) => s.id === sessionId);
      const entry: Session = {
        id: idx >= 0 ? list[idx].id : sessionId,
        title,
        ticker: symbol ?? "",
        msgs: next,
        updated: new Date().toISOString(),
      };
      const nextList = idx >= 0 ? list.map((s, i) => (i === idx ? entry : s)) : [entry, ...list];
      saveSessions(nextList);
    } catch {
      /* ignore */
    }
  }

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setErr("");
    const userMsg: Msg = { role: "user", text: q, time: now() };
    const base: Msg[] = [...msgs, userMsg, { role: "assistant", text: "", time: now() }];
    setMsgs(base);
    setBusy(true);
    abort.current = new AbortController();

    const history: ChatMessage[] = [
      {
        role: "system",
        content: `${symbol ? aiSystem.deskChatSecurity(symbol, null, desk) : aiSystem.deskChat(desk)} SCREEN CONTEXT: ${context}. ${NO_INVENT}`,
      },
      ...msgs.slice(-10).map((m) => ({ role: m.role, content: m.text }) as ChatMessage),
      { role: "user", content: q },
    ];

    let full = "";
    try {
      await streamChat(history, {
        model: store.getORModel(),
        apiKey: store.getORKey(),
        signal: abort.current.signal,
        onToken: (t) => {
          full += t;
          setMsgs((m) => {
            const copy = [...m];
            copy[copy.length - 1] = { ...copy[copy.length - 1], text: full };
            return copy;
          });
        },
      });
      const done = [...base];
      done[done.length - 1] = { ...done[done.length - 1], text: full || "— NO ANSWER —" };
      setMsgs(done);
      persist(done);
    } catch (e: unknown) {
      const aborted = e instanceof Error && e.name === "AbortError";
      if (!aborted) {
        setErr(e instanceof Error ? e.message.slice(0, 180) : "AI OFFLINE — SET AN OPENROUTER KEY IN SETTINGS");
        const done = [...base];
        done[done.length - 1] = { ...done[done.length - 1], text: full || "" };
        setMsgs(done.filter((m, i) => !(i === done.length - 1 && !m.text)));
        persist(done.filter((m, i) => !(i === done.length - 1 && !m.text)));
      }
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  return (
    <div>
      <div className="dx-inline" style={{ marginBottom: 10 }}>
        <span className="dx-badge dx-fnc">CONTEXT: {context}</span>
        <span className="dx-spacer" />
        <button className="dx-btn dx-ghost" style={{ minHeight: 30, fontSize: 10 }} onClick={() => { setMsgs([]); persist([]); }}>
          NEW CHAT
        </button>
      </div>

      {msgs.length === 0 && !busy ? (
        <div className="dx-card">
          <div className="dx-note" style={{ marginBottom: 10 }}>
            THE MODEL SEES THIS SCREEN&apos;S CONTEXT AUTOMATICALLY. IT CANNOT INVENT NUMBERS —
            MISSING DATA IS REPORTED AS A GAP.
          </div>
          <div className="dx-col" style={{ gap: 6 }}>
            {suggestions.map((s) => (
              <button key={s} className="dx-row" onClick={() => send(s)}>
                <span style={{ fontSize: 12.5 }}>✦ {s}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="dx-col" style={{ gap: 8, paddingBottom: 8 }}>
          {msgs.map((m, i) => (
            <div key={i} className={`dx-ai-msg ${m.role === "user" ? "dx-me" : "dx-bot"}`}>
              <div className="dx-ai-who">{m.role === "user" ? "YOU" : "BULLION DROID"} · {m.time}</div>
              {m.text || (busy && i === msgs.length - 1 ? "…" : "")}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}

      {busy ? <Skeleton rows={1} height={44} /> : null}
      {err ? <ErrorState what="AI" detail={err} retry={() => send(input || "CONTINUE")} /> : null}

      <div className="dx-inline" style={{ position: "sticky", bottom: 0, background: "var(--dx-bg)", paddingTop: 8 }}>
        <div className="dx-searchbar" style={{ flex: 1 }}>
          <span className="dx-amber">›</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={placeholder}
            aria-label="Ask AI"
          />
        </div>
        <button className="dx-btn" disabled={busy || !input.trim()} onClick={() => send(input)}>
          {busy ? "…" : "SEND"}
        </button>
      </div>
    </div>
  );
}
