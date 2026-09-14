"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Book Reader — PDF library with per-book page memory. Binaries live in
// IndexedDB (too big for localStorage); library index + last-page map live
// in localStorage. Rendering via pinned pdf.js CDN build.

const PDFJS_VER = "3.11.174";
const PDFJS_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VER}/pdf.min.js`;
const PDFJS_WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VER}/pdf.worker.min.js`;

const LIB_KEY = "iss.book.library";
const PROG_KEY = "iss.book.progress";

interface BookEntry {
  id: string;
  title: string;
  url: string; // "" until attached (upload or pasted link)
  pages: number; // last known page count
  preset?: boolean;
}

const PRESETS: BookEntry[] = [
  { id: "wsp-redbook", title: "WSP RED BOOK — IB INTERVIEW Q&A", url: "", pages: 0, preset: true },
];

// ---------- tiny storage layer ----------

function readJSON<T>(key: string, fb: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fb;
  } catch {
    return fb;
  }
}

function writeJSON(key: string, val: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* quota — progress loss only */
  }
}

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("bb-books", 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("files")) req.result.createObjectStore("files");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(id: string, blob: Blob): Promise<void> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put(blob, id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function idbGet(id: string): Promise<Blob | undefined> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readonly");
    const rq = tx.objectStore("files").get(id);
    rq.onsuccess = () => { db.close(); resolve(rq.result as Blob | undefined); };
    rq.onerror = () => { db.close(); reject(rq.error); };
  });
}

async function idbDel(id: string): Promise<void> {
  const db = await idb();
  return new Promise((resolve) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); resolve(); };
  });
}

// ---------- pdf.js loader ----------

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-pdfjs="${PDFJS_VER}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.pdfjs = PDFJS_VER;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("PDF ENGINE CDN FAILED"));
    document.head.appendChild(s);
  });
}

async function ensurePdfJs(): Promise<any> {
  const w = window as any;
  if (w.pdfjsLib?.getDocument) return w.pdfjsLib;
  await loadScript(PDFJS_URL);
  if (!w.pdfjsLib?.getDocument) throw new Error("PDF ENGINE FAILED TO INIT");
  w.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  return w.pdfjsLib;
}

// ---------- reader ----------

export function BookReader() {
  const [library, setLibrary] = useState<BookEntry[]>(() => {
    if (typeof window === "undefined") return PRESETS;
    const saved = readJSON<BookEntry[]>(LIB_KEY, []);
    const ids = new Set(saved.map((b) => b.id));
    return [...saved, ...PRESETS.filter((p) => !ids.has(p.id))];
  });
  const [activeId, setActiveId] = useState<string>(() => {
    if (typeof window === "undefined") return PRESETS[0].id;
    return readJSON<string>("iss.book.active", PRESETS[0].id);
  });
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.25);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<any>(null);
  const renderTask = useRef<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const active = library.find((b) => b.id === activeId) ?? library[0] ?? PRESETS[0];

  useEffect(() => { writeJSON(LIB_KEY, library.filter((b) => !b.preset || b.url)); }, [library]);
  useEffect(() => { writeJSON("iss.book.active", activeId); }, [activeId]);

  const renderPage = useCallback(async (doc: any, n: number, sc: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try { await renderTask.current?.cancel?.(); } catch { /* superseded */ }
    try {
      const pg = await doc.getPage(n);
      const vp = pg.getViewport({ scale: sc });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = "100%";
      canvas.style.height = "auto";
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const task = doc === docRef.current
        ? pg.render({ canvasContext: ctx, viewport: vp, transform: [dpr, 0, 0, dpr, 0, 0] })
        : null;
      renderTask.current = task;
      await task?.promise;
    } catch (e: any) {
      if (e?.name !== "RenderingCancelledException") throw e;
    }
  }, []);

  const openBook = useCallback(async (book: BookEntry, atPage?: number) => {
    setErr(""); setStatus("LOADING ENGINE…"); setBusy(true);
    setNumPages(0);
    try {
      const lib = await ensurePdfJs();
      setStatus(`OPENING ${book.title}…`);
      let data: Uint8Array | null = null;
      let src: any = null;
      const blob = await idbGet(book.id).catch(() => undefined);
      if (blob) {
        data = new Uint8Array(await blob.arrayBuffer());
        src = { data };
      } else if (book.url) {
        src = { url: book.url, withCredentials: false };
      } else {
        throw new Error("NO FILE ATTACHED — UPLOAD THE PDF OR PASTE A LINK BELOW");
      }
      if (docRef.current) { try { await docRef.current.destroy(); } catch { /* ignore */ } }
      const doc = data ? await lib.getDocument({ data }).promise : await lib.getDocument(src).promise;
      docRef.current = doc;
      const total: number = doc.numPages;
      setNumPages(total);
      setLibrary((prev) => prev.map((b) => (b.id === book.id ? { ...b, pages: total } : b)));
      const saved = readJSON<Record<string, number>>(PROG_KEY, {});
      const start = Math.min(Math.max(atPage ?? saved[book.id] ?? 1, 1), total);
      setPage(start);
      setStatus("");
      await renderPage(doc, start, scale);
    } catch (e: any) {
      const msg = /fetch|network|CORS|credentials|Failed to fetch/i.test(e.message ?? "")
        ? `${e.message} — DIRECT LINKS OFTEN BLOCK CROSS-SITE READS; UPLOAD THE FILE INSTEAD`
        : e.message;
      setErr(msg);
      setStatus("");
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderPage, scale]);

  // Open active book on mount / switch.
  useEffect(() => {
    if (active) openBook(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Persist page as you read.
  useEffect(() => {
    if (!active || page < 1) return;
    const saved = readJSON<Record<string, number>>(PROG_KEY, {});
    saved[active.id] = page;
    writeJSON(PROG_KEY, saved);
  }, [page, active]);

  async function go(n: number) {
    if (!docRef.current || !numPages) return;
    const next = Math.min(Math.max(n, 1), numPages);
    setPage(next);
    setErr("");
    try {
      await renderPage(docRef.current, next, scale);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function zoom(f: number) {
    const next = Math.min(3, Math.max(0.6, Math.round((scale + f) * 100) / 100));
    setScale(next);
    if (docRef.current && numPages) {
      try { await renderPage(docRef.current, page, next); } catch { /* ignore */ }
    }
  }

  function fitWidth() {
    const wrap = wrapRef.current;
    const doc = docRef.current;
    if (!wrap || !doc || !numPages) return;
    doc.getPage(page).then(async (pg: any) => {
      const w = wrap.clientWidth - 4;
      const base = pg.getViewport({ scale: 1 });
      const next = Math.min(3, Math.max(0.6, w / base.width));
      setScale(Math.round(next * 100) / 100);
      try { await renderPage(doc, page, Math.round(next * 100) / 100); } catch { /* ignore */ }
    }).catch(() => {});
  }

  async function onUpload(f: File | undefined) {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") { setErr("ONLY PDF FILES — EXPORT OTHERS AS PDF FIRST"); return; }
    setErr(""); setStatus(`STORING ${f.name.toUpperCase()} LOCALLY…`); setBusy(true);
    try {
      await idbPut(active.id, f);
      setStatus("");
      await openBook({ ...active, url: "" }, 1);
    } catch (e: any) {
      setErr(`STORE FAILED: ${e.message}`);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  function attachUrl() {
    const u = urlDraft.trim();
    if (!u) return;
    setUrlDraft("");
    const next = { ...active, url: u };
    setLibrary((prev) => prev.map((b) => (b.id === active.id ? next : b)));
    idbDel(active.id).catch(() => {});
    openBook(next, 1);
  }

  function addBook() {
    const title = newTitle.trim().toUpperCase() || `BOOK ${library.length + 1}`;
    const id = `custom-${Date.now().toString(36)}`;
    const entry: BookEntry = { id, title, url: "", pages: 0 };
    setNewTitle("");
    setLibrary((prev) => [...prev, entry]);
    setActiveId(id);
  }

  function removeBook(id: string) {
    const b = library.find((x) => x.id === id);
    if (!b || b.preset) return;
    if (!confirm(`REMOVE ${b.title} (FILE + PROGRESS)?`)) return;
    idbDel(id).catch(() => {});
    setLibrary((prev) => prev.filter((x) => x.id !== id));
    if (activeId === id) setActiveId(PRESETS[0].id);
  }

  function onKey(e: React.KeyboardEvent) {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
    if (e.key === "ArrowRight") { e.preventDefault(); go(page + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(page - 1); }
    else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoom(0.25); }
    else if (e.key === "-") { e.preventDefault(); zoom(-0.25); }
  }

  const prog = readJSON<Record<string, number>>(PROG_KEY, {});

  return (
    <div className="grid" style={{ gap: 10 }} onKeyDown={onKey} tabIndex={0} aria-label="Book reader">
      <div className="toolbar">
        <select
          className="box" value={active.id} onChange={(e) => setActiveId(e.target.value)}
          aria-label="Book" style={{ maxWidth: 260 }}
        >
          {library.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}{(prog[b.id] ?? 0) > 1 ? ` · P${prog[b.id]}` : ""}{b.url || b.id === activeId ? "" : " · NO FILE"}
            </option>
          ))}
        </select>
        <input
          className="box" value={newTitle} onChange={(e) => setNewTitle(e.target.value.toUpperCase())}
          placeholder="+ NEW SHELF SLOT (TITLE)" aria-label="New book title" style={{ maxWidth: 220 }}
          onKeyDown={(e) => { if (e.key === "Enter") addBook(); e.stopPropagation(); }}
        />
        <button className="ghost" onClick={addBook} title="Add a shelf slot">+ ADD</button>
        {!active.preset && (
          <button className="ghost" onClick={() => removeBook(active.id)} title="Remove book, file and progress">✕ DROP</button>
        )}
      </div>

      {!active.url && (
        <div className="panel">
          <p className="p-head">{active.title} — attach the PDF once, it stays on this device</p>
          <div className="toolbar">
            <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>UPLOAD PDF</button>
            <input
              ref={fileRef} type="file" accept=".pdf,application/pdf" style={{ display: "none" }}
              onChange={(e) => { onUpload(e.target.files?.[0]); e.target.value = ""; }}
            />
            <input
              className="box" value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)}
              placeholder="…OR PASTE A DIRECT PDF LINK + LINK" aria-label="PDF link" style={{ flex: 1, minWidth: 200 }}
              onKeyDown={(e) => { if (e.key === "Enter") attachUrl(); e.stopPropagation(); }}
            />
            <button className="ghost" onClick={attachUrl} disabled={busy || !urlDraft.trim()}>LINK</button>
          </div>
          <p className="faint" style={{ fontSize: 11, margin: "8px 0 0 0" }}>
            UPLOADS PERSIST IN THIS BROWSER (INDEXEDDB) WITH YOUR LAST PAGE. PASSWORD-/LOGIN-WALLED LINKS (SCRIBD ETC.) WON&apos;T LOAD CROSS-SITE — UPLOAD THE FILE INSTEAD.
          </p>
        </div>
      )}

      {(active.url || numPages > 0) && (
        <div className="panel">
          <div className="toolbar">
            <button className="ghost" onClick={() => go(page - 1)} disabled={busy || page <= 1} title="Previous page (←)">← PREV</button>
            <span className="sec" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
              P {numPages ? `${page}/${numPages}` : `${page}…`}
            </span>
            <input
              className="box" inputMode="numeric" aria-label="Go to page"
              style={{ maxWidth: 76 }} placeholder="GO…"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const v = parseInt((e.target as HTMLInputElement).value, 10);
                  if (isFinite(v)) go(v);
                  (e.target as HTMLInputElement).value = "";
                }
                e.stopPropagation();
              }}
            />
            <button className="ghost" onClick={() => go(page + 1)} disabled={busy || (numPages > 0 && page >= numPages)} title="Next page (→)">NEXT →</button>
            <button className="ghost" onClick={() => zoom(-0.25)} title="Zoom out (-)">−</button>
            <span className="faint" style={{ fontSize: 11 }}>{Math.round(scale * 100)}%</span>
            <button className="ghost" onClick={() => zoom(0.25)} title="Zoom in (+)">+</button>
            <button className="ghost" onClick={fitWidth} title="Fit page width">FIT</button>
            <button className="ghost" onClick={() => fileRef.current?.click()} title="Replace attached PDF">⇪ FILE</button>
          </div>
          {status && <p className="muted">{status}</p>}
          {err && <p className="neg">READER ERR: {err}</p>}
          <div ref={wrapRef} style={{ marginTop: 8, background: "#000", border: "1px solid var(--grid)", borderRadius: 3, overflow: "hidden" }}>
            <canvas ref={canvasRef} style={{ width: "100%", height: "auto", display: "block" }} />
          </div>
          <p className="faint" style={{ fontSize: 10.5, margin: "6px 0 0 0" }}>←/→ PAGES · +/− ZOOM · PAGE AUTOSAVES PER BOOK</p>
        </div>
      )}
    </div>
  );
}
