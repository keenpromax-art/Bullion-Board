"use client";

import { useEffect, useRef, useState } from "react";
import { streamChat, FREE_MODELS, DEFAULT_MODEL, type ChatMessage } from "@/lib/ai";
import { store } from "@/lib/store";
import { MODULE_MAP } from "@/lib/modules";

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

const now = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function loadSessions(): Session[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem("iss.ai.sessions");
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function marketDigest(symbol: string): Promise<string> {
  try {
    const r = await fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`);
    const q = await r.json();
    if (q.error || q.regularMarketPrice === undefined) return `SEC ${symbol} (QUOTE UNAVAILABLE)`;
    return `SEC ${symbol} ${q.shortName ?? ""} @ ₹${q.regularMarketPrice} (${Number(q.regularMarketChangePercent ?? 0).toFixed(2)}%)`;
  } catch {
    return `SEC ${symbol}`;
  }
}

function deskLabel(): string {
  if (typeof window === "undefined") return "HOME";
  const m = window.location.pathname.match(/\/module\/(\d+)/);
  if (!m) {
    const p = window.location.pathname;
    if (p === "/") return "HOME DIRECTORY";
    return p.replace(/^\//, "").toUpperCase() || "HOME";
  }
  const mod = MODULE_MAP[m[1]];
  return mod ? `#${m[1]} ${mod.label.toUpperCase()}` : `MODULE ${m[1]}`;
}

export default function AIChat() {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [ticker, setTicker] = useState("RELIANCE.NS");
  const abort = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSessions(loadSessions());
    setModel(store.getORModel());
    setTicker(store.getTicker());
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
      if (e.key === "?" && !typing) {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("iss.ai.sessions", JSON.stringify(sessions.slice(-20)));
    } catch { /* quota */ }
  }, [sessions]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sessions, activeId, open, busy]);

  const active = sessions.find((s) => s.id === activeId) ?? null;

  function touchSession(tick: string): Session {
    if (active) return active;
    const s: Session = {
      id: Date.now(), title: tick, ticker: tick, msgs: [],
      updated: new Date().toISOString(),
    };
    setSessions((prev) => [...prev.slice(-19), s]);
    setActiveId(s.id);
    return s;
  }

  async function send(raw?: string) {
    const text = (raw ?? input).trim();
    if (!text || busy) return;
    const tick = store.getTicker();
    setTicker(tick);
    const sess = touchSession(tick);
    const umsg: Msg = { role: "user", text, time: now() };
    const amsg: Msg = { role: "assistant", text: "", time: now() };
    const base = [...sess.msgs, umsg, amsg];
    setSessions((prev) => prev.map((s) => (s.id === sess.id ? { ...s, msgs: base, ticker: tick, updated: new Date().toISOString() } : s)));
    setInput("");
    setBusy(true);
    abort.current = new AbortController();
    try {
      const digest = await marketDigest(tick);
      const history: ChatMessage[] = [
        {
          role: "system",
          content: `You are a terse terminal markets assistant. Reply in short UPPERCASE lines, numbers first, no disclaimers. Context: ${digest}. Desk: ${deskLabel()}.`,
        },
        ...base.slice(-12, -1).map((m) => ({ role: m.role, content: m.text }) as ChatMessage),
      ];
      let full = "";
      await streamChat(history, {
        model: store.getORModel(),
        apiKey: store.getORKey(),
        signal: abort.current.signal,
        onToken: (t) => {
          full += t;
          const snapshot = full;
          setSessions((prev) => prev.map((s) => {
            if (s.id !== sess.id) return s;
            const msgs = [...s.msgs];
            msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], text: snapshot };
            return { ...s, msgs };
          }));
        },
      });
      if (!full) throw new Error("empty reply");
    } catch (e: any) {
      const msg = e?.name === "AbortError" ? "STOPPED." : `AI ERR: ${e.message}. SET KEY IN CONFIG.`;
      setSessions((prev) => prev.map((s) => {
        if (s.id !== sess.id) return s;
        const msgs = [...s.msgs];
        const last = msgs[msgs.length - 1];
        msgs[msgs.length - 1] = { ...last, text: last.text || msg };
        return { ...s, msgs };
      }));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  function newChat() {
    abort.current?.abort();
    setBusy(false);
    setActiveId(null);
    setInput("");
  }

  function exportChat() {
    if (!active) return;
    const txt = active.msgs.map((m) => `[${m.time}] ${m.role.toUpperCase()}:\n${m.text}`).join("\n\n");
    const blob = new Blob([`DESK CHAT — ${active.ticker} — ${active.title}\n\n${txt}`], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `desk-chat-${active.ticker}-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const sug = [`ANALYZE ${ticker}`, `TOP 3 RISKS — ${ticker}`, `BULL VS BEAR CASE`, `WHAT MOVES TODAY?`];

  return (
    <>
      <button className="ai-fab" onClick={() => setOpen((o) => !o)} title="Desk chat (?)">
        {open ? "✕" : "◈ AI"}
      </button>
      {open && (
        <div className="ai-dock">
          <div className="ai-head">
            <span className="sec">◈ DESK CHAT</span>
            <select
              className="box" value={model} style={{ maxWidth: 150, padding: "4px 6px", fontSize: 11 }}
              onChange={(e) => { setModel(e.target.value); store.setORModel(e.target.value); }}
              aria-label="Model"
            >
              {FREE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <button className="ghost" style={{ padding: "4px 10px" }} onClick={newChat} title="New session">+</button>
            <button className="ghost" style={{ padding: "4px 10px" }} onClick={() => setOpen(false)}>✕</button>
          </div>

          {sessions.length > 1 && (
            <div className="ai-sessions">
              {sessions.slice().reverse().slice(0, 8).map((s) => (
                <button
                  key={s.id}
                  className={`pill${s.id === activeId ? " active" : ""}`}
                  style={{ fontSize: 11, padding: "4px 10px" }}
                  onClick={() => { abort.current?.abort(); setBusy(false); setActiveId(s.id); }}
                >
                  {s.ticker.replace(".NS", "")} · {s.msgs.length >> 1}
                </button>
              ))}
            </div>
          )}

          <div className="ai-msgs" ref={listRef}>
            {(!active || active.msgs.length === 0) && (
              <div>
                <p className="muted" style={{ fontSize: 12 }}>ASK ABOUT {ticker} — LIVE QUOTE AUTO-ATTACHED. HISTORY STAYS IN THIS BROWSER.</p>
                <div className="pills" style={{ marginTop: 8 }}>
                  {sug.map((s) => (
                    <button key={s} className="pill" style={{ fontSize: 11 }} onClick={() => send(s)}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            {(active?.msgs ?? []).map((m, i) => (
              <div key={i} className={m.role === "user" ? "ai-msg-you" : "ai-msg-ai"}>
                <div className="faint" style={{ fontSize: 10 }}>{m.role === "user" ? "YOU" : "DESK"} · {m.time}</div>
                <pre>{m.text}{busy && i === (active?.msgs.length ?? 1) - 1 && m.role === "assistant" ? "▊" : ""}</pre>
              </div>
            ))}
          </div>

          <div className="ai-foot">
            <div className="toolbar">
              <textarea
                className="box" rows={2} value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder={`MESSAGE DESK… (${ticker})`}
                style={{ flex: 1, resize: "none" }}
              />
              {busy
                ? <button className="ghost" onClick={() => abort.current?.abort()}>STOP</button>
                : <button className="btn" onClick={() => send()}>SEND</button>}
            </div>
            <div className="toolbar" style={{ marginTop: 6 }}>
              <span className="faint" style={{ fontSize: 10.5 }}>{ticker} · {model.split("/")[1]?.split(":")[0]?.toUpperCase() ?? "MODEL"}</span>
              <button className="ghost" style={{ padding: "3px 8px", fontSize: 11, marginLeft: "auto" }} onClick={exportChat} disabled={!active}>EXPORT</button>
              <button
                className="ghost" style={{ padding: "3px 8px", fontSize: 11 }}
                onClick={() => { if (active && confirm("DELETE SESSION?")) { setSessions((p) => p.filter((s) => s.id !== active.id)); setActiveId(null); } }}
                disabled={!active}
              >DEL</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
