"use client";

import { useEffect, useRef, useState } from "react";
import { chatComplete, streamChat } from "@/lib/ai";
import { store } from "@/lib/store";

/* ---------------- wikipedia ---------------- */

export function WikiDesk() {
  const [q, setQ] = useState("NIFTY 50");
  const [results, setResults] = useState<Array<{ title: string; words: number }>>([]);
  const [article, setArticle] = useState<{ title: string; intro: string; body: string; link: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiOut, setAiOut] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  async function search(query: string = q) {
    setLoading(true); setArticle(null);
    try {
      const r = await fetch(`/api/wiki?q=${encodeURIComponent(query)}`);
      const j = await r.json();
      setResults(j.results ?? []);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }

  async function open(title: string) {
    setLoading(true);
    try {
      const r = await fetch(`/api/wiki?title=${encodeURIComponent(title)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "open failed");
      setArticle(j);
    } catch { setArticle(null); }
    finally { setLoading(false); }
  }

  useEffect(() => { search("NIFTY 50"); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function financeLens() {
    if (!article) return;
    setAiLoading(true); setAiOut("");
    try {
      const txt = await chatComplete([
        { role: "system", content: "You are a markets explainer. Terse uppercase terminal lines." },
        { role: "user", content: `ARTICLE: ${article.title}\n${article.intro.slice(0, 2000)}\nTASK: FINANCE LENS — WHAT A TRADER MUST KNOW IN 5 LINES + 1 RISK.` },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(txt);
    } catch (e: any) {
      setAiOut(`AI ERR: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">Wikipedia — live search</p>
        <div className="toolbar">
          <input className="box" value={q} onChange={(e) => setQ(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === "Enter") search(); }} placeholder="SEARCH…" style={{ flex: 2 }} />
          <button className="btn" onClick={() => search()}>SEARCH</button>
        </div>
        {loading && <p className="muted">QUERYING…</p>}
        {!article && results.length > 0 && (
          <table className="plain" style={{ marginTop: 10 }}>
            <thead><tr><th>ARTICLE</th><th style={{ textAlign: "right" }}>WORDS</th></tr></thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.title} onClick={() => open(r.title)} style={{ cursor: "pointer" }}>
                  <td><a href="#" onClick={(e) => { e.preventDefault(); open(r.title); }}>{r.title.toUpperCase()}</a></td>
                  <td style={{ textAlign: "right" }}>{r.words?.toLocaleString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {article && (
        <div className="panel">
          <p className="p-head">{article.title.toUpperCase()}</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{article.intro}</p>
          <div className="toolbar" style={{ marginTop: 8 }}>
            <button className="ghost" onClick={() => setArticle(null)}>← RESULTS</button>
            <a href={article.link} target="_blank" rel="noreferrer"><button className="ghost">FULL ARTICLE ↗</button></a>
            <button className="btn" onClick={financeLens} disabled={aiLoading}>{aiLoading ? "…" : "FINANCE LENS"}</button>
          </div>
          {aiOut && <pre className="ai" style={{ marginTop: 10 }}>{aiOut}</pre>}
        </div>
      )}
    </div>
  );
}

/* ---------------- bible ---------------- */

const BIBLE_TRANS = [
  { id: "KJV", name: "KING JAMES" },
  { id: "ASV", name: "AMERICAN STANDARD" },
  { id: "WEB", name: "WORLD ENGLISH" },
  { id: "YLT", name: "YOUNG'S LITERAL" },
  { id: "LSV", name: "LITERAL STANDARD" },
  { id: "NKJV", name: "NEW KING JAMES" },
  { id: "ESV", name: "ENGLISH STANDARD" },
  { id: "NIV", name: "NEW INTERNATIONAL" },
  { id: "CEB", name: "COMMON ENGLISH" },
  { id: "NET", name: "NEW ENGLISH TRANSLATION" },
];

function storedTrans(): string {
  if (typeof window === "undefined") return "KJV";
  const t = window.localStorage.getItem("iss.bible.trans") ?? "KJV";
  return BIBLE_TRANS.some((x) => x.id === t) ? t : "KJV";
}

export function BibleDesk() {
  const [trans, setTrans] = useState(storedTrans);
  const [books, setBooks] = useState<Array<{ id: number; name: string; chapters: number }>>([]);
  const [book, setBook] = useState(43);
  const [chapter, setChapter] = useState(3);
  const [verses, setVerses] = useState<Array<{ n: number; text: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [aiOut, setAiOut] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  async function load(b = book, c = chapter, t = trans) {
    setLoading(true); setVerses([]); setAiOut("");
    try {
      const r = await fetch(`/api/bible?book=${b}&chapter=${c}&trans=${encodeURIComponent(t)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "load failed");
      setVerses(j.verses ?? []);
    } catch { setVerses([]); }
    finally { setLoading(false); }
  }

  // Book list follows the active translation (canon order differs per edition).
  useEffect(() => {
    let alive = true;
    fetch(`/api/bible?books=1&trans=${encodeURIComponent(trans)}`)
      .then((r) => r.json())
      .then((j) => { if (alive) setBooks(j.books ?? []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [trans]);

  useEffect(() => { load(43, 3, storedTrans()); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickTrans(t: string) {
    setTrans(t);
    try { window.localStorage.setItem("iss.bible.trans", t); } catch { /* quota */ }
    load(book, chapter, t);
  }

  const bookName = books.find((b) => b.id === book)?.name ?? `BOOK ${book}`;
  const maxCh = books.find((b) => b.id === book)?.chapters ?? 150;

  async function commentary() {
    if (!verses.length) return;
    setAiLoading(true); setAiOut("");
    try {
      const txt = await chatComplete([
        { role: "system", content: "You are a concise study assistant. Terse lines." },
        { role: "user", content: `${bookName} ${chapter} (${trans}):\n${verses.slice(0, 12).map((v) => `${v.n}. ${v.text}`).join("\n")}\nTASK: 3-LINE COMMENTARY + 1 CROSS-REFERENCE.` },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(txt);
    } catch (e: any) {
      setAiOut(`AI ERR: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">Scripture — {trans} · bolls.life feed</p>
        <div className="toolbar">
          <select className="box" value={trans} onChange={(e) => pickTrans(e.target.value)} aria-label="Translation">
            {BIBLE_TRANS.map((t) => <option key={t.id} value={t.id}>{t.id} · {t.name}</option>)}
          </select>
          <select className="box" value={book} onChange={(e) => { const b = Number(e.target.value); setBook(b); setChapter(1); load(b, 1); }}>
            {books.map((b) => <option key={b.id} value={b.id}>{b.name.toUpperCase()}</option>)}
          </select>
          <input className="box" value={chapter} onChange={(e) => setChapter(Math.max(1, parseInt(e.target.value) || 1))} style={{ maxWidth: 90 }} inputMode="numeric" />
          <button className="btn" onClick={() => load()}>READ</button>
          <button className="ghost" onClick={() => { const c = Math.max(1, chapter - 1); setChapter(c); load(book, c); }}>←</button>
          <button className="ghost" onClick={() => { const c = Math.min(maxCh || chapter + 1, chapter + 1); setChapter(c); load(book, c); }}>→</button>
          <button className="ghost" onClick={commentary} disabled={aiLoading || !verses.length}>{aiLoading ? "…" : "COMMENTARY"}</button>
        </div>
        {loading && <p className="muted">LOADING {bookName} {chapter}…</p>}
      </div>
      <div className="panel">
        <p className="p-head">{bookName} {chapter} · {verses.length} verses</p>
        {!loading && verses.length === 0 && (
          <p className="muted">NO TEXT FOR THIS BOOK/CHAPTER IN {trans} — CHAPTER COUNTS DIFFER PER EDITION. PICK ANOTHER CHAPTER.</p>
        )}
        {verses.map((v) => (
          <p key={v.n} style={{ fontSize: 13.5, lineHeight: 1.7, margin: "0 0 8px 0" }}>
            <sup className="sec" style={{ marginRight: 8 }}>{v.n}</sup>{v.text}
          </p>
        ))}
        {aiOut && <pre className="ai" style={{ marginTop: 10 }}>{aiOut}</pre>}
      </div>
    </div>
  );
}

/* ---------------- text reader (.txt/.md upload) ---------------- */

const PAGE = 2200;

export function ReaderDesk() {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("iss.reader");
      if (raw) {
        const j = JSON.parse(raw);
        setTitle(j.title ?? ""); setText(j.text ?? ""); setPage(j.page ?? 0);
      }
    } catch { /* empty */ }
  }, []);

  function openFile(f: File) {
    const rd = new FileReader();
    rd.onload = () => {
      const t = String(rd.result ?? "");
      setTitle(f.name.toUpperCase()); setText(t); setPage(0);
      try { window.localStorage.setItem("iss.reader", JSON.stringify({ title: f.name.toUpperCase(), text: t.slice(0, 900000), page: 0 })); } catch { /* quota */ }
    };
    rd.readAsText(f);
  }

  const pages = Math.max(1, Math.ceil(text.length / PAGE));
  const slice = text.slice(page * PAGE, page * PAGE + PAGE);
  const pct = ((page + 1) / pages) * 100;

  function go(p: number) {
    const np = Math.max(0, Math.min(pages - 1, p));
    setPage(np);
    try {
      const raw = window.localStorage.getItem("iss.reader");
      if (raw) {
        const j = JSON.parse(raw);
        window.localStorage.setItem("iss.reader", JSON.stringify({ ...j, page: np }));
      }
    } catch { /* ignore */ }
  }

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">Reader — device-local .txt / .md {title ? `· ${title}` : ""}</p>
        <div className="toolbar">
          <input
            type="file" accept=".txt,.md,.markdown" className="box"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f); }}
          />
          {text && <span className="muted" style={{ fontSize: 12 }}>PG {page + 1}/{pages} · {pct.toFixed(0)}%</span>}
        </div>
        {text && (
          <div style={{ height: 6, background: "#1a1a1e", borderRadius: 2, marginTop: 10 }}>
            <div style={{ width: `${pct}%`, height: "100%", background: "#ffa028", borderRadius: 2 }} />
          </div>
        )}
      </div>
      {text ? (
        <div className="panel">
          <p style={{ fontSize: 14, lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{slice}</p>
          <div className="toolbar" style={{ marginTop: 10 }}>
            <button className="ghost" onClick={() => go(page - 1)}>← PREV</button>
            <button className="ghost" onClick={() => go(page + 1)}>NEXT →</button>
          </div>
        </div>
      ) : (
        <div className="panel"><p className="muted">NO BOOK LOADED — UPLOAD A .TXT/.MD FILE. EPUB BINARIES ARE NOT PARSEABLE IN-BROWSER; EXPORT AS TEXT FIRST. PROGRESS AUTOSAVES.</p></div>
      )}
    </div>
  );
}

/* ---------------- external links / filings ---------------- */

export function LinkDesk({ symbol, mode }: { symbol: string; mode: "charts" | "filings" }) {
  const base = symbol.replace(/\.NS$|\.BO$/, "");
  const links = mode === "charts" ? [
    ["TRADINGVIEW", `https://www.tradingview.com/chart/?symbol=${base.endsWith("BO") ? "BSE" : "NSE"}%3A${encodeURIComponent(base)}`],
    ["SCREENER.IN", `https://www.screener.in/company/${encodeURIComponent(base)}/`],
    ["YAHOO FINANCE", `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`],
    ["MONEYCONTROL", `https://www.moneycontrol.com/stocks/cptmarket/compsearchnew.php?search_data=&cid=&mbsearch_str=${encodeURIComponent(base)}`],
    ["TICKERTAPE", `https://www.tickertape.in/stocks/${encodeURIComponent(base)}`],
  ] : [
    ["NSE ANNOUNCEMENTS", `https://www.nseindia.com/companies-listing/corporate-filings-announcements`],
    ["BSE ANNOUNCEMENTS", `https://www.bseindia.com/corporates/ann.html`],
    ["SCREENER DOCUMENTS", `https://www.screener.in/company/${encodeURIComponent(base)}/documents/`],
    ["MONEYCONTROL RESULTS", `https://www.moneycontrol.com/financials/${encodeURIComponent(base.toLowerCase())}/results/yearly/`],
  ];
  return (
    <div className="panel panel-glow">
      <p className="p-head">{mode === "charts" ? "Chart launcher" : "Filings & documents"} — {symbol}</p>
      <div className="toolbar">
        {links.map(([label, url]) => (
          <a key={label} href={url} target="_blank" rel="noreferrer"><button className="ghost">{label} ↗</button></a>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 11.5 }}>DEEP LINKS OPEN THE SECURITY WHERE THE VENUE SUPPORTS IT — NSE/BSE ANNOUNCEMENT PAGES ARE EXCHANGE-WIDE FEEDS.</p>
    </div>
  );
}

/* ---------------- AI chat desk ---------------- */

interface Msg { role: "user" | "assistant"; text: string }

const TEMPLATES: Record<string, string> = {
  BLANK: "",
  EARNINGS: "READ THE LATEST EARNINGS FOR {TICKER} AT ₹{PX}: 3 TAKEAWAYS + GUIDANCE READ + 1 RED FLAG.",
  TECHNICAL: "TECHNICAL READ ON {TICKER} AT ₹{PX}: TREND + 2 LEVELS + INVALIDATION IN 5 LINES.",
  SCAN: "I HAVE ₹100,000. USING {TICKER} AT ₹{PX} AS ANCHOR: 1 SETUP + POSITION SIZE AT 1% RISK + STOP.",
};

interface DMsg extends Msg { time: string }

const nowHHMM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function AIDesk({ symbol, mode }: { symbol: string; mode: "chat" | "tasks" }) {
  const [msgs, setMsgs] = useState<DMsg[]>([]);
  const [input, setInput] = useState("");
  const [tpl, setTpl] = useState("BLANK");
  const [busy, setBusy] = useState(false);
  const [px, setPx] = useState<number | null>(null);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const abort = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`).then((r) => r.json()).then((j) => {
      if (!j.error) setPx(j.regularMarketPrice ?? null);
    }).catch(() => {});
    fetch("/api/ai/status").then((r) => r.json()).then((j) => {
      setHasKey(!!(j.hasServerKey || store.getORKey()));
    }).catch(() => setHasKey(!!store.getORKey()));
  }, [symbol]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, busy]);

  async function send(raw?: string) {
    const text = (raw ?? input).trim();
    if (!text || busy) return;
    setInput(""); setBusy(true);
    const umsg: DMsg = { role: "user", text, time: nowHHMM() };
    const amsg: DMsg = { role: "assistant", text: "", time: nowHHMM() };
    const history = [...msgs, umsg, amsg];
    setMsgs(history);
    abort.current = new AbortController();
    try {
      let full = "";
      await streamChat(
        [
          { role: "system", content: `You are a terminal markets assistant. Terse uppercase lines, numbers first, no disclaimers. Security in focus: ${symbol}${px !== null ? ` @ ₹${px}` : ""}.` },
          ...history.slice(-12, -1).map((m) => ({ role: m.role, content: m.text }) as { role: "user" | "assistant"; content: string }),
        ],
        {
          model: store.getORModel(),
          apiKey: store.getORKey(),
          signal: abort.current.signal,
          onToken: (t) => {
            full += t;
            const snapshot = full;
            setMsgs((prev) => {
              const next = [...prev];
              next[next.length - 1] = { ...next[next.length - 1], text: snapshot };
              return next;
            });
          },
        }
      );
      if (!full) throw new Error("empty reply");
    } catch (e: any) {
      const msg = e?.name === "AbortError" ? "STOPPED." : `AI ERR: ${e.message}`;
      setMsgs((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        next[next.length - 1] = { ...last, text: last.text || msg };
        return next;
      });
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  function runTemplate() {
    if (tpl === "BLANK") return;
    send(TEMPLATES[tpl].replaceAll("{TICKER}", symbol).replaceAll("{PX}", px !== null ? String(px) : "?"));
  }

  function exportChat() {
    const txt = msgs.map((m) => `[${m.time}] ${m.role.toUpperCase()}:\n${m.text}`).join("\n\n");
    const blob = new Blob([`DESK CHAT — ${symbol}\n\n${txt}`], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `desk-chat-${symbol}-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const approxTokens = Math.round(msgs.reduce((s, m) => s + m.text.length, 0) / 4);
  const sug = [
    `ANALYZE ${symbol}`,
    `TOP 3 RISKS — ${symbol}`,
    px !== null ? `LEVELS ABOVE ${px}` : "KEY LEVELS",
    "BULL VS BEAR CASE",
  ];

  return (
    <div className="panel panel-glow">
      <p className="p-head">
        {mode === "tasks" ? "Task executor" : "AI chat"} — {symbol}{px !== null ? ` @ ₹${px.toLocaleString("en-IN")}` : ""}
        <span className="faint" style={{ marginLeft: 8 }}>
          {hasKey === null ? "" : hasKey ? "● KEY OK" : "○ NO KEY — SET IN CONFIG"}
        </span>
      </p>
      {mode === "tasks" && (
        <div className="toolbar" style={{ marginBottom: 10 }}>
          {Object.keys(TEMPLATES).map((t) => (
            <button key={t} className={`pill${tpl === t ? " active" : ""}`} onClick={() => setTpl(t)}>{t}</button>
          ))}
          <button className="btn" onClick={runTemplate} disabled={busy || tpl === "BLANK"}>EXECUTE</button>
        </div>
      )}
      <div ref={listRef} style={{ display: "grid", gap: 8, marginBottom: 10, maxHeight: 460, overflowY: "auto" }}>
        {msgs.length === 0 && (
          <div>
            <p className="muted" style={{ fontSize: 12.5, margin: "0 0 4px 0" }}>
              STREAMING REPLIES · {px !== null ? "LIVE QUOTE ATTACHED" : "QUOTE LOADING…"} · HISTORY STAYS IN THIS TAB ONLY.
            </p>
            <div className="pills" style={{ marginTop: 8 }}>
              {sug.map((s) => (
                <button key={s} className="pill" style={{ fontSize: 11.5 }} onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "ai-msg-you" : "ai-msg-ai"}>
            <div className="faint" style={{ fontSize: 10.5 }}>{m.role === "user" ? "YOU" : "DESK"} · {m.time}</div>
            <pre>{m.text}{busy && i === msgs.length - 1 && m.role === "assistant" ? "▊" : ""}</pre>
          </div>
        ))}
      </div>
      <div className="toolbar">
        <input
          className="box" value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          placeholder="MESSAGE DESK… + ENTER" style={{ flex: 2 }}
        />
        {busy
          ? <button className="ghost" onClick={() => abort.current?.abort()}>STOP</button>
          : <button className="btn" onClick={() => send()}>SEND</button>}
      </div>
      <div className="toolbar" style={{ marginTop: 8 }}>
        <span className="faint" style={{ fontSize: 11 }}>
          {msgs.length >> 1} TURNS · ~{approxTokens.toLocaleString("en-IN")} TOKENS
        </span>
        <button className="ghost" style={{ padding: "4px 10px", fontSize: 11, marginLeft: "auto" }} onClick={exportChat} disabled={!msgs.length}>EXPORT</button>
        <button
          className="ghost" style={{ padding: "4px 10px", fontSize: 11 }}
          onClick={() => { if (!msgs.length || confirm("CLEAR SESSION?")) { abort.current?.abort(); setBusy(false); setMsgs([]); } }}
          disabled={!msgs.length}
        >CLEAR</button>
      </div>
    </div>
  );
}
