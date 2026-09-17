"use client";

// Notes desk — research log shared by the /notes page and the terminal NOTE
// panel. Single implementation, both surfaces stay in sync. Device-local
// (localStorage via store); nothing leaves the browser.

import { Fragment, useEffect, useMemo, useState } from "react";
import { store } from "@/lib/store";
import type { Note } from "@/lib/types";
import { formatTimestamp, truncate } from "@/lib/utils";

function loadNotes(): Note[] {
  try {
    const ns = store.getNotes();
    return Array.isArray(ns) ? ns : [];
  } catch {
    return [];
  }
}

function nextId(notes: Note[]): number {
  return notes.length ? Math.max(...notes.map((x) => x.id)) + 1 : 1;
}

function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  for (const t of raw.split(",")) {
    const v = t.trim().toUpperCase().replace(/\s+/g, "-").slice(0, 24);
    if (v) seen.add(v);
  }
  return [...seen].slice(0, 8);
}

function stamp(): string {
  return new Date().toISOString();
}

export function downloadNotes(notes: Note[]): void {
  const txt = notes
    .map((n) => `#${n.id} ${n.pinned ? "[PINNED] " : ""}${n.title}\nSEC: ${n.ticker ?? "GEN"}${n.tags.length ? ` · TAGS: ${n.tags.join(", ")}` : ""}\nCREATED: ${n.created} · MODIFIED: ${n.modified}\n\n${n.content}`)
    .join("\n\n---\n\n");
  const blob = new Blob([`RESEARCH NOTES — ${notes.length} RECORDS — EXPORTED ${stamp()}\n\n${txt}`], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `notes-${stamp().slice(0, 10)}-${notes.length}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.modified < b.modified ? 1 : -1));
}

export function NotesDesk({ symbol }: { symbol?: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [title, setTitle] = useState("");
  const [ticker, setTicker] = useState("");
  const [tags, setTags] = useState("");
  const [content, setContent] = useState("");
  const [search, setSearch] = useState("");
  const [secFilter, setSecFilter] = useState("ALL");
  const [openId, setOpenId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [hint, setHint] = useState("");

  useEffect(() => {
    setNotes(loadNotes());
    if (symbol) setTicker((t) => t || symbol);
    const onStore = () => setNotes(loadNotes());
    window.addEventListener("storage", onStore);
    return () => window.removeEventListener("storage", onStore);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  function save(ns: Note[]) {
    setNotes(ns);
    try { store.setNotes(ns); } catch { /* quota — state still updates */ }
  }

  function add() {
    if (!content.trim()) { setHint("WRITE THE THESIS FIRST — EMPTY NOTES ARE NOT SAVED."); return; }
    setHint("");
    const now = stamp();
    save([...notes, {
      id: nextId(notes), title: title.trim().toUpperCase() || "UNTITLED",
      content: content.trim(), ticker: ticker.trim().toUpperCase() || null,
      tags: parseTags(tags), pinned: false, created: now, modified: now,
    }]);
    setTitle(""); setContent(""); setTags("");
  }

  function togglePin(n: Note) {
    save(notes.map((x) => (x.id === n.id ? { ...x, pinned: !x.pinned, modified: stamp() } : x)));
  }

  function remove(n: Note) {
    if (!confirm(`DELETE NOTE #${n.id} "${truncate(n.title, 30)}"?`)) return;
    save(notes.filter((x) => x.id !== n.id));
    if (openId === n.id) setOpenId(null);
  }

  function saveEdit(n: Note) {
    if (!editText.trim()) { setHint("EDITED THESIS IS EMPTY — SAVE CANCELLED."); return; }
    setHint("");
    save(notes.map((x) => (x.id === n.id ? { ...x, content: editText.trim(), modified: stamp() } : x)));
    setEditId(null);
  }

  const secs = useMemo(() => {
    const m = new Map<string, number>();
    notes.forEach((n) => m.set(n.ticker ?? "GEN", (m.get(n.ticker ?? "GEN") ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [notes]);

  const shown = useMemo(() => {
    const q = search.trim().toUpperCase();
    return sortNotes(notes.filter((n) => {
      if (secFilter !== "ALL" && (n.ticker ?? "GEN") !== secFilter) return false;
      if (!q) return true;
      return (n.title + " " + n.content + " " + (n.ticker ?? "") + " " + n.tags.join(" ")).toUpperCase().includes(q);
    }));
  }, [notes, search, secFilter]);

  const pinned = notes.filter((n) => n.pinned).length;

  return (
    <div className="grid" style={{ gap: 10 }}>
      <div className="cells">
        <div className="cell"><div className="lbl">Records</div><div className="val" style={{ fontSize: 16 }}>{notes.length}</div><div className="sub">device-local</div></div>
        <div className="cell"><div className="lbl">Pinned</div><div className="val" style={{ fontSize: 16 }}>{pinned}</div><div className="sub">top of list</div></div>
        <div className="cell"><div className="lbl">Sec covered</div><div className="val" style={{ fontSize: 16 }}>{secs.length}</div><div className="sub">tickers + gen</div></div>
      </div>

      <div className="panel panel-glow">
        <p className="p-head">New note{symbol ? <> · {symbol}</> : null}</p>
        <div className="grid grid-3">
          <input className="box" value={title} onChange={(e) => setTitle(e.target.value.toUpperCase())} onKeyDown={(e) => e.stopPropagation()} placeholder="TITLE…" aria-label="Note title" />
          <input className="box" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} onKeyDown={(e) => e.stopPropagation()} placeholder="SEC (OPTIONAL)…" aria-label="Security" />
          <input className="box" value={tags} onChange={(e) => setTags(e.target.value.toUpperCase())} onKeyDown={(e) => e.stopPropagation()} placeholder="TAGS, COMMA…" aria-label="Tags" />
        </div>
        <textarea
          className="box" value={content} onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) add(); }}
          placeholder="THESIS… (CTRL+ENTER TO SAVE)" rows={4} style={{ width: "100%", marginTop: 8 }} aria-label="Note thesis"
        />
        <div className="toolbar" style={{ marginTop: 8 }}>
          <button className="btn" onClick={add}>+ NEW NOTE</button>
          <span className="faint" style={{ fontSize: 11 }}>CTRL+ENTER SAVES · TAGS SEARCHABLE</span>
        </div>
        {hint && <p className="neg" style={{ fontSize: 12, margin: "6px 0 0 0" }}>{hint}</p>}
      </div>

      <div className="panel">
        <p className="p-head">Records — {shown.length}/{notes.length}</p>
        <div className="toolbar" style={{ marginBottom: 8 }}>
          <input className="box" value={search} onChange={(e) => setSearch(e.target.value.toUpperCase())} onKeyDown={(e) => e.stopPropagation()} placeholder="SEARCH TITLE / THESIS / TAG…" aria-label="Search notes" style={{ flex: 2, minWidth: 160 }} />
          <button className="ghost" onClick={() => downloadNotes(shown)} disabled={!shown.length}>↓ EXPORT</button>
        </div>
        {secs.length > 0 && (
          <div className="pills" style={{ marginBottom: 8 }}>
            {["ALL", ...secs.map(([s]) => s)].map((s) => (
              <button key={s} className={`pill${secFilter === s ? " active" : ""}`} onClick={() => setSecFilter(s)}>
                {s}{s !== "ALL" ? ` ${secs.find(([k]) => k === s)?.[1] ?? ""}` : ""}
              </button>
            ))}
          </div>
        )}
        {shown.length > 0 ? (
          <div className="scrollx">
            <table className="plain">
              <thead><tr><th style={{ textAlign: "right" }}>#</th><th>PIN</th><th>SEC</th><th style={{ textAlign: "left" }}>TITLE</th><th>TAGS</th><th>MODIFIED</th><th style={{ textAlign: "right" }}>ACT</th></tr></thead>
              <tbody>
                {shown.map((n) => (
                  <Fragment key={n.id}>
                    <tr>
                      <td style={{ textAlign: "right" }} className="faint">{n.id}</td>
                      <td>{n.pinned ? "📌" : <span className="faint">—</span>}</td>
                      <td>{n.ticker ? <a href={`/module/1?symbol=${encodeURIComponent(n.ticker)}`}><span className="sec">{n.ticker}</span></a> : <span className="faint">GEN</span>}</td>
                      <td style={{ textAlign: "left" }}>
                        <a href="#" onClick={(e) => { e.preventDefault(); setOpenId((o) => (o === n.id ? null : n.id)); }} title={openId === n.id ? "Collapse" : "Expand thesis"}>
                          <strong>{openId === n.id ? "▾ " : "▸ "}{truncate(n.title, 44)}</strong>
                        </a>
                      </td>
                      <td>{n.tags.length ? n.tags.slice(0, 3).join(" · ") : <span className="faint">—</span>}</td>
                      <td className="faint">{formatTimestamp(n.modified)}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button className="ghost" onClick={() => togglePin(n)} title={n.pinned ? "Unpin" : "Pin to top"}>PIN</button>{" "}
                        <button className="ghost" onClick={() => remove(n)} title="Delete note">DEL</button>
                      </td>
                    </tr>
                    {openId === n.id && (
                      <tr key={`${n.id}-open`}>
                        <td colSpan={7} style={{ textAlign: "left", background: "rgba(255,160,40,0.04)" }}>
                          {editId === n.id ? (
                            <div>
                              <textarea className="box" value={editText} onChange={(e) => setEditText(e.target.value)} onKeyDown={(e) => e.stopPropagation()} rows={5} style={{ width: "100%" }} aria-label="Edit thesis" />
                              <div className="toolbar" style={{ marginTop: 6 }}>
                                <button className="btn" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => saveEdit(n)}>SAVE</button>
                                <button className="ghost" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => setEditId(null)}>CANCEL</button>
                              </div>
                            </div>
                          ) : (
                            <div>
                              <p style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap", margin: "0 0 6px 0" }}>{n.content}</p>
                              <div className="faint" style={{ fontSize: 11 }}>
                                CREATED {formatTimestamp(n.created)}{n.tags.length ? ` · TAGS ${n.tags.join(" · ")}` : ""}
                                {n.ticker ? <> · <a href={`/module/1?symbol=${encodeURIComponent(n.ticker)}`}>OPEN {n.ticker} DESK →</a></> : null}
                                {" · "}<a href="#" onClick={(e) => { e.preventDefault(); setEditText(n.content); setEditId(n.id); }}>EDIT THESIS</a>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : notes.length > 0 ? (
          <p className="muted">NO MATCH FOR “{search.trim().toUpperCase()}”{secFilter !== "ALL" ? ` IN ${secFilter}` : ""} —{" "}
            <button className="ghost" style={{ marginLeft: 6, padding: "2px 10px" }} onClick={() => { setSearch(""); setSecFilter("ALL"); }}>CLEAR</button>
          </p>
        ) : (
          <p className="muted">NO RECORDS — LOG FIRST THESIS ABOVE.</p>
        )}
      </div>
    </div>
  );
}

export function NotesMini({ symbol }: { symbol?: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");

  useEffect(() => { setNotes(loadNotes()); }, []);

  function add() {
    if (!text.trim()) return;
    const now = stamp();
    const next = [...notes, {
      id: nextId(notes), title: title.trim().toUpperCase() || "UNTITLED", content: text.trim(),
      ticker: symbol ? symbol.toUpperCase() : null, tags: [], pinned: false, created: now, modified: now,
    }];
    setNotes(next);
    try { store.setNotes(next); } catch { /* quota */ }
    setTitle(""); setText("");
  }

  const shown = sortNotes(notes).slice(0, 8);

  return (
    <div className="grid" style={{ gap: 8 }}>
      <div className="toolbar">
        <input className="box" value={title} onChange={(e) => setTitle(e.target.value.toUpperCase())} onKeyDown={(e) => e.stopPropagation()} placeholder="TITLE…" aria-label="Note title" style={{ flex: 1 }} />
      </div>
      <textarea
        className="box" value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) add(); }}
        placeholder={`THESIS ON ${symbol ?? "DESK"}… (CTRL+ENTER)`} rows={3} style={{ width: "100%" }} aria-label="Note thesis"
      />
      <div className="toolbar">
        <button className="btn" onClick={add} disabled={!text.trim()}>+ NEW NOTE</button>
        <a href="/notes" style={{ fontSize: 12, marginLeft: "auto" }}>FULL DESK →</a>
      </div>
      {shown.map((n) => (
        <div key={n.id} className="kv">
          <span className="muted">#{n.id} {n.pinned ? "📌 " : ""}{n.ticker ?? "GEN"} · {n.title}</span>
          <strong style={{ fontSize: 12 }}>{truncate(n.content, 80)}</strong>
        </div>
      ))}
      {notes.length === 0 && <p className="muted">NO RECORDS — LOG FIRST THESIS ABOVE.</p>}
    </div>
  );
}
