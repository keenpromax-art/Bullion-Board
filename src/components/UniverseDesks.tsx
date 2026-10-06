"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { store } from "@/lib/store";

interface URow {
  symbol: string; name: string; exchange: string; region: string;
  sector: string; industry: string; currency: string; mcap: number | null;
}

interface UResp {
  builtAt: string; discovered: number; note: string;
  total: number; page: number; pages: number; size: number;
  facetRegions: string[]; facetSectors: string[]; facetExchanges: string[];
  rows: URow[];
}

const ctl: React.CSSProperties = {
  background: "#0b0b0e", color: "#e8e8ea", border: "1px solid var(--grid)",
  borderRadius: 3, padding: "5px 8px", font: "inherit", fontSize: 12,
};

const fmtMcap = (v: number | null) =>
  typeof v === "number" && isFinite(v)
    ? v >= 1e12 ? `${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : String(v)
    : "—";

function ageStr(builtAt: string): string {
  const ms = Date.now() - new Date(builtAt).getTime();
  if (!isFinite(ms)) return "—";
  const h = Math.floor(ms / 3600000);
  if (h < 1) return `${Math.floor(ms / 60000)}M AGO`;
  if (h < 24) return `${h}H AGO`;
  return `${Math.floor(h / 24)}D AGO`;
}

export default function UniverseDesk() {
  const [data, setData] = useState<UResp | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [qd, setQd] = useState("");
  const [region, setRegion] = useState("");
  const [sector, setSector] = useState("");
  const [exch, setExch] = useState("");
  const [sort, setSort] = useState<"symbol" | "name" | "mcap">("symbol");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [flash, setFlash] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const qs = new URLSearchParams();
      if (qd) qs.set("q", qd);
      if (region) qs.set("region", region);
      if (sector) qs.set("sector", sector);
      if (exch) qs.set("exch", exch);
      qs.set("sort", sort); qs.set("dir", dir); qs.set("page", String(page)); qs.set("size", "25");
      const r = await fetch(`/api/universe?${qs}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "universe failed");
      setData(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "universe failed");
    } finally {
      setLoading(false);
    }
  }, [qd, region, sector, exch, sort, dir, page]);

  useEffect(() => { load(); }, [load]);

  const runRefresh = async () => {
    setRefreshing(true);
    setFlash("");
    try {
      const r = await fetch("/api/universe/refresh", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "crawl failed");
      setFlash(`INDEX REBUILT — ${j.discovered} SYMBOLS · ${j.builtAt.slice(0, 10)}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "crawl failed");
    } finally {
      setRefreshing(false);
    }
  };

  const facets = useMemo(() => (data ? { r: data.facetRegions, s: data.facetSectors, e: data.facetExchanges } : null), [data]);

  return (
    <>
      {/* stat cells */}
      <div className="cells">
        <div className="cell"><div className="lbl">Discovered</div><div className="val">{data ? data.discovered.toLocaleString() : "—"}</div><div className="sub">world equities</div></div>
        <div className="cell"><div className="lbl">Matched</div><div className="val">{data ? data.total.toLocaleString() : "—"}</div><div className="sub">post-filter</div></div>
        <div className="cell"><div className="lbl">Regions</div><div className="val">{facets ? facets.r.length : "—"}</div><div className="sub">geographies</div></div>
        <div className="cell"><div className="lbl">Built</div><div className="val" style={{ fontSize: 15 }}>{data ? ageStr(data.builtAt) : "—"}</div><div className="sub">index age</div></div>
        <div className="cell"><div className="lbl">Page</div><div className="val">{data ? `${data.page}/${data.pages}` : "—"}</div><div className="sub">25 per page</div></div>
      </div>

      <div className="panel">
        <p className="p-head">Filters · query · sort</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <form onSubmit={(e) => { e.preventDefault(); setPage(1); setQd(q.trim().toUpperCase()); }} style={{ display: "flex", gap: 6 }}>
            <input style={{ ...ctl, width: 180 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="SYMBOL / NAME…" />
            <button className="btn" type="submit">SCAN</button>
          </form>
          <select style={ctl} value={region} onChange={(e) => { setRegion(e.target.value); setPage(1); }}>
            <option value="">REGION: ALL</option>
            {facetEdges(facets?.r)}
          </select>
          <select style={ctl} value={sector} onChange={(e) => { setSector(e.target.value); setPage(1); }}>
            <option value="">SECTOR: ALL</option>
            {facetEdges(facets?.s)}
          </select>
          <select style={ctl} value={exch} onChange={(e) => { setExch(e.target.value); setPage(1); }}>
            <option value="">EXCH: ALL</option>
            {facetEdges(facets?.e)}
          </select>
          <button className="ghost" onClick={() => { setQ(""); setQd(""); setRegion(""); setSector(""); setExch(""); setPage(1); setSort("symbol"); setDir("asc"); }}>RESET</button>
          <button className="ghost" onClick={runRefresh} disabled={refreshing}>{refreshing ? "CRAWLING…" : "REBUILD INDEX"}</button>
        </div>
        {flash && <p className="neg" style={{ color: "var(--amber, #ffa028)", marginTop: 6 }}>{flash}</p>}
      </div>

      {loading && !data && <p className="muted" style={{ padding: "8px 2px" }}>LOADING UNIVERSE…</p>}
      {err && (
        <div className="panel">
          <p className="p-head">World universe</p>
          <p className="neg">{err}</p>
          <button className="btn" onClick={load} style={{ marginTop: 6 }}>RETRY</button>
        </div>
      )}

      {data && (
        <div className="panel">
          <p className="p-head">WORLD EQUITY INDEX — PAGE {data.page} · {data.total.toLocaleString()} MATCH</p>
          <table className="plain">
            <thead>
              <tr>
                <th onClick={() => toggleSort("symbol", sort, dir, setSort, setDir)} style={{ cursor: "pointer" }}>
                  SYM {sortMark(sort, dir, "symbol")}
                </th>
                <th onClick={() => toggleSort("name", sort, dir, setSort, setDir)} style={{ cursor: "pointer" }}>
                  NAME {sortMark(sort, dir, "name")}
                </th>
                <th>EXCH</th><th>REGION</th><th>SECTOR</th><th>CCY</th>
                <th style={{ textAlign: "right", cursor: "pointer" }} onClick={() => toggleSort("mcap", sort, dir, setSort, setDir)}>
                  MCAP {sortMark(sort, dir, "mcap")}
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.symbol}>
                  <td>
                    <button
                      className="ghost"
                      style={{ color: "var(--yellow, #ffb000)" }}
                      onClick={() => { store.setTicker(r.symbol); setFlash(`TICKER SET — ${r.symbol} (OPEN ON ANY PANEL)`); }}
                    >
                      {r.symbol}
                    </button>
                  </td>
                  <td>{r.name}</td>
                  <td>{r.exchange}</td>
                  <td>{r.region}</td>
                  <td>{r.sector}</td>
                  <td>{r.currency}</td>
                  <td style={{ textAlign: "right" }}>{fmtMcap(r.mcap)}</td>
                  <td>
                    <a href={`/module/2?symbol=${encodeURIComponent(r.symbol)}`} target="_blank" rel="noopener" style={{ color: "var(--amber, #ffa028)" }}>
                      OPEN «GO»
                    </a>
                  </td>
                </tr>
              ))}
              {!data.rows.length && (
                <tr><td colSpan={8}><span className="muted">NO MATCH — TRY A LOOSER FILTER</span></td></tr>
              )}
            </tbody>
          </table>
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
            <button className="ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={data.page <= 1}>← PREV</button>
            <button className="ghost" onClick={() => setPage((p) => Math.min(data.pages, p + 1))} disabled={data.page >= data.pages}>NEXT →</button>
            <span className="muted" style={{ fontSize: 12 }}>INDEX AGE {ageStr(data.builtAt)} · {data.note.toUpperCase()}</span>
          </div>
        </div>
      )}
    </>
  );
}

function facetEdges(opts?: string[]) {
  return (opts ?? []).map((o) => <option key={o} value={o}>{o}</option>);
}

function toggleSort(key: "symbol" | "name" | "mcap", sort: string, dir: string, setSort: (v: "symbol" | "name" | "mcap") => void, setDir: (v: "asc" | "desc") => void) {
  if (sort === key) setDir(dir === "asc" ? "desc" : "asc");
  else { setSort(key); setDir("asc"); }
}

function sortMark(sort: string, dir: string, key: string) {
  return sort === key ? (dir === "asc" ? "▲" : "▼") : "";
}
