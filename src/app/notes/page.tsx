"use client";

import { useEffect, useState } from "react";
import { store } from "@/lib/store";
import type { Note } from "@/lib/types";
import { formatTimestamp, truncate } from "@/lib/utils";
import { CommandBar, StatusBar } from "@/components/TerminalChrome";
import OpenInWorkspace from "@/components/terminal/OpenInWorkspace";

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [title, setTitle] = useState("");
  const [ticker, setTicker] = useState("");
  const [content, setContent] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    setNotes(store.getNotes());
    setTicker(store.getTicker());
  }, []);

  function save(n: Note[]) {
    setNotes(n);
    store.setNotes(n);
  }

  function add() {
    const id = notes.length ? Math.max(...notes.map((x) => x.id)) + 1 : 1;
    const now = new Date().toISOString();
    save([...notes, { id, title: title || "UNTITLED", content, ticker: ticker || null, tags: [], pinned: false, created: now, modified: now }]);
    setTitle(""); setContent("");
  }

  const shown = notes
    .filter((n) => !search || (n.title + n.content + (n.ticker ?? "")).toUpperCase().includes(search.toUpperCase()))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.modified < b.modified ? 1 : -1));

  return (
    <>
      <CommandBar ticker={store.getTicker()} onTicker={(t) => setTicker(t)} />
      <main className="container grid">
        <div className="panel">
          <div className="toolbar">
            <OpenInWorkspace funcId="NOTE" symbol={ticker} />
            <a href="/terminal" className="ghost" style={{ padding: "9px 16px", textDecoration: "none" }}>TERMINAL ▦</a>
          </div>
        </div>
        <div className="panel">
          <p className="p-head">Notes — research log · {notes.length} records</p>
          <div className="grid grid-3">
            <input className="box" value={title} onChange={(e) => setTitle(e.target.value.toUpperCase())} placeholder="TITLE…" />
            <input className="box" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="SEC (OPTIONAL)…" />
            <input className="box" value={search} onChange={(e) => setSearch(e.target.value.toUpperCase())} placeholder="SEARCH…" />
          </div>
          <textarea className="box" value={content} onChange={(e) => setContent(e.target.value)} placeholder="THESIS…" rows={4} style={{ width: "100%", marginTop: 8 }} />
          <div style={{ marginTop: 8 }}><button className="btn" onClick={add}>+ NEW NOTE</button></div>
        </div>
        <div className="panel">
          <table className="plain">
            <thead><tr><th>ID</th><th>PIN</th><th>SEC</th><th>TITLE</th><th>MODIFIED</th><th style={{ textAlign: "right" }}>ACT</th></tr></thead>
            <tbody>
              {shown.map((n) => (
                <tr key={n.id}>
                  <td>#{n.id}</td>
                  <td>{n.pinned ? "📌" : <span className="faint">—</span>}</td>
                  <td>{n.ticker ? <span className="sec">{n.ticker}</span> : <span className="faint">GEN</span>}</td>
                  <td title={n.content}>{truncate(n.title, 40)}</td>
                  <td>{formatTimestamp(n.modified)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="ghost" onClick={() => save(notes.map((x) => x.id === n.id ? { ...x, pinned: !x.pinned, modified: new Date().toISOString() } : x))}>PIN</button>
                    {" "}
                    <button className="ghost" onClick={() => { if (confirm(`DELETE NOTE #${n.id}?`)) save(notes.filter((x) => x.id !== n.id)); }}>DEL</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <p className="muted">NO RECORDS — LOG FIRST THESIS ABOVE.</p>}
        </div>
      </main>
      <StatusBar ticker={ticker} extra="NOTES" />
    </>
  );
}
