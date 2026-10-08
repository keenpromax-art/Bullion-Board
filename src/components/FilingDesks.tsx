"use client";

// Filings desk — module 117. The one place a company's regulatory record is
// read: the index of what was filed, the statements those filings carry, the
// statements EXACTLY as the issuer printed them, and the MD&A prose.
//
// Anatomy: cells strip -> p-head panels -> verdict banner -> faint footnotes.
// Every panel: loading / empty / error + retry. Legs fail open and say so.
// Derived series in useMemo. Nothing here invents a number.
//
// The two registries are not symmetric and the desk says which one answered:
//   SEC EDGAR  full XBRL, 2009+, as-filed rendered statements, MD&A prose
//   NSE        integrated-filing XBRL (income, EPS, segments, auditor,
//              narrative) plus a filed-PDF link; the balance sheet is absent
//              from Q1/Q3 filings by SEBI's own rule and renders "—"
// A line the filing does not carry is "—", never 0, and the coverage panel
// names how many lines that is.

import { useEffect, useMemo, useRef, useState } from "react";
import type { AsFiledTable, FilingRecord, StatementSet, XbrlCoverage } from "@/lib/types";
import { funcCode } from "@/lib/terminal";
import { store } from "@/lib/store";
import { chatComplete, aiSystem, NO_INVENT } from "@/lib/ai";
import { HBars, LineChart } from "@/components/charts";
import { downloadCSV } from "@/components/ModuleDesks";

const ID = "117";

// ------------------------------------------------------------------ formats

const DASH = "—";

function isNum(v: unknown): v is number {
  return typeof v === "number" && isFinite(v);
}

/** Money in the desk's unit: US in $ millions, India in ₹ Crore. */
function money(v: number | null | undefined, unit: string): string {
  if (!isNum(v)) return DASH;
  if (unit.includes("CRORE") || unit.includes("Cr")) {
    const a = Math.abs(v);
    if (a >= 1e5) return `${v >= 0 ? "" : "-"}${(a / 1e5).toFixed(2)}L Cr`;
    return v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  }
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

function per(v: number | null | undefined, unit: "perShare" | "count" | "ratio", digits = 2): string {
  if (!isNum(v)) return DASH;
  if (unit === "perShare") return v.toFixed(digits);
  if (unit === "count") return v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v.toFixed(0);
  return v.toFixed(digits);
}

function pct(v: number | null | undefined, digits = 1): string {
  if (!isNum(v)) return DASH;
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

function tone(v: number | null | undefined): string {
  if (!isNum(v) || v === 0) return "";
  return v > 0 ? "pos" : "neg";
}

const shortDay = (iso: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || DASH;
  const [y, m] = iso.split("-");
  const M = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${M[Number(m) - 1] ?? m}-${y}`;
};

// ------------------------------------------------------------------- hooks

interface Leg<T> {
  data: T | null;
  err: string;
  loading: boolean;
  reload: () => void;
}

/**
 * Race-safe fetch. `seq` stops a slow earlier response from overwriting a
 * newer one — switching ticker fast is the normal way this desk is used.
 */
function useLeg<T>(url: string | null, enabled = true): Leg<T> {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(!!url && enabled);
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    if (!url || !enabled) {
      setData(null);
      setErr("");
      setLoading(false);
      return;
    }
    const my = ++seq.current;
    setLoading(true);
    setErr("");
    fetch(url)
      .then(async (r) => {
        const j = await r.json();
        if (my !== seq.current) return;
        if (j?.ok === false) setErr(String(j.error ?? `HTTP ${r.status}`));
        else setData(j as T);
      })
      .catch((e) => {
        if (my === seq.current) setErr(e?.message ?? "network");
      })
      .finally(() => {
        if (my === seq.current) setLoading(false);
      });
  }, [url, enabled, nonce]);

  return { data, err, loading, reload: () => setNonce((n) => n + 1) };
}

const contact = (): string => store.getSecContact();

export function useFilingContact() {
  const [c, setC] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => setC(store.getSecContact()), []);
  function save() {
    store.setSecContact(c.trim());
    setMsg(store.getSecContact() ? "SAVED — SENT ON EVERY EDGAR REQUEST" : "CLEARED — EDGAR WILL ASK FOR ONE");
    setBusy(true);
    window.setTimeout(() => setBusy(false), 1200);
  }
  return { c, setC, save, busy, msg };
}

// ------------------------------------------------------------- primitives

function Head({ sub, right }: { sub: string; right?: string }) {
  return (
    <div className="panel panel-glow">
      <p className="p-head">
        {ID} · {funcCode(ID)} &lt;GO&gt;{right ? <span className="faint"> — {right}</span> : null}
      </p>
      <p className="muted" style={{ fontSize: 11.5, margin: "4px 0 0 0" }}>{sub}</p>
    </div>
  );
}

function Pills<T extends string>({ opts, val, set }: { opts: readonly T[]; val: T; set: (v: T) => void }) {
  return (
    <div className="pills">
      {opts.map((o) => (
        <button key={o} className={`pill${o === val ? " active" : ""}`} onClick={() => set(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

function Cells({ items }: { items: Array<{ l: string; v: string; s?: string; cls?: string }> }) {
  return (
    <div className="cells">
      {items.map((c) => (
        <div className="cell" key={c.l}>
          <div className="lbl">{c.l}</div>
          <div className={`val ${c.cls ?? ""}`} style={{ fontSize: 15 }}>
            {c.v}
          </div>
          {c.s ? <div className="sub">{c.s}</div> : null}
        </div>
      ))}
    </div>
  );
}

function LegBar({
  err,
  loading,
  retry,
  partial,
  errors,
}: {
  err?: string;
  loading?: boolean;
  retry?: () => void;
  partial?: boolean;
  errors?: Record<string, string | null | undefined>;
}) {
  const named = Object.entries(errors ?? {}).filter(([, v]) => !!v);
  if (err) {
    return (
      <p className="neg" style={{ fontSize: 12.5 }}>
        ERR: {err}{" "}
        {retry ? (
          <button className="ghost" onClick={retry}>
            ↻ RETRY
          </button>
        ) : null}
      </p>
    );
  }
  if (loading) return <span className="muted" style={{ fontSize: 12 }}>READING FILINGS…</span>;
  if (partial || named.length) {
    return (
      <p className="warn" style={{ fontSize: 11.5, margin: "4px 0 0 0" }}>
        PARTIAL — {named.length ? named.map(([k, v]) => `${k.toUpperCase()}: ${v}`).join(" · ") : "ONE SOURCE LEG DID NOT ANSWER"}
      </p>
    );
  }
  return null;
}

function Coverage({ cov }: { cov: XbrlCoverage }) {
  if (!cov) return null;
  const pctCov = cov.canonical ? Math.round((cov.resolved.length / cov.canonical) * 100) : 0;
  const cls = pctCov >= 80 ? "pos" : pctCov >= 50 ? "" : "warn";
  return (
    <div className="fil-cov">
      <div className="fil-cov-bar">
        <span style={{ width: `${pctCov}%`, background: pctCov >= 80 ? "var(--green)" : pctCov >= 50 ? "var(--amber)" : "var(--faint)" }} />
      </div>
      <span className={cls}>
        {cov.resolved.length}/{cov.canonical} TAGGED
      </span>
    </div>
  );
}

function Foot({ children }: { children: React.ReactNode }) {
  return (
    <p className="faint" style={{ fontSize: 10.5, lineHeight: 1.6, margin: "10px 0 0 0" }}>
      {children}
    </p>
  );
}

// ------------------------------------------------------------------- props

export interface FilingsDeskProps {
  symbol: string;
  /** Deep-link the desk into a mode. */
  initialMode?: Mode;
  onOpen?: (funcId: string, symbol: string) => void;
}

type Mode = "INDEX" | "STATEMENTS" | "AS-FILED" | "MD&A";
const MODES = ["INDEX", "STATEMENTS", "AS-FILED", "MD&A"] as const;

type BlockKey = "is" | "bs" | "cf";
const BLOCKS: Array<{ k: BlockKey; label: string }> = [
  { k: "is", label: "INCOME" },
  { k: "bs", label: "BALANCE SHEET" },
  { k: "cf", label: "CASH FLOW" },
];

interface XbrlPayload {
  ok: boolean;
  region: "US" | "IN";
  venue: string;
  entity: string;
  basis?: string;
  taxonomy: string;
  documents?: { fetched: number; failed: number; facts: number; contexts: number };
  partial?: boolean;
  errors?: Record<string, string | null>;
  annual: StatementSet;
  quarterly: StatementSet;
  ltm?: { periods: StatementSet["periods"]; is: StatementSet["is"]; cf: StatementSet["cf"] } | null;
  derived: Array<{ label: string; values: (number | null)[] }>;
  caveat?: string | null;
  error?: string;
}

interface IndexPayload {
  ok: boolean;
  symbol: string;
  region: "US" | "IN";
  venue: string | null;
  entity?: string | null;
  cik?: string | null;
  sicDescription?: string | null;
  fiscalYearEnd?: string | null;
  foreignIssuer?: boolean;
  from: string;
  to: string;
  total: number;
  withXbrl: number;
  partial: boolean;
  errors?: Record<string, string | null>;
  caveat?: string | null;
  filings: FilingRecord[];
  error?: string;
}

interface AsFiledPayload {
  ok: boolean;
  accession: string;
  tables: AsFiledTable[];
  xlsx: string | null;
  partial: boolean;
  errors?: Record<string, string | null>;
  caveat?: string | null;
  noteReportCount?: number;
  error?: string;
}

interface MdaPayload {
  ok: boolean;
  entity: string;
  accession: string;
  form: string;
  filedAt: string;
  period: string;
  item: string;
  doc: string;
  chars: number;
  paragraphs: string[];
  caveat?: string | null;
  error?: string;
}

interface StatusPayload {
  ok: boolean;
  hasContact: boolean;
  contactHint: string;
}

// --------------------------------------------------------------------- AI

function AiBlock({ label, context, prompt }: { label: string; context: string; prompt: string }) {
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    setOut("");
    try {
      const txt = await chatComplete(
        [
          { role: "system", content: prompt },
          { role: "user", content: `${context} ${NO_INVENT}` },
        ],
        { apiKey: store.getORKey(), model: store.getORModel() }
      );
      setOut(txt);
    } catch (e: any) {
      setOut(`AI ERR: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="panel">
      <p className="p-head">AI analyst — {funcCode(ID)} · {label}</p>
      <div className="toolbar">
        <button className="btn" onClick={run} disabled={busy}>
          {busy ? "RUNNING…" : "◈ RUN AI"}
        </button>
        {!store.getORKey() ? <span className="faint" style={{ fontSize: 11 }}>NO OPENROUTER KEY — SET IN ⚙ SET</span> : null}
      </div>
      {out ? <pre className="ai" style={{ marginTop: 8 }}>{out}</pre> : null}
    </div>
  );
}

// -------------------------------------------------------------- statements

function StatementPanel({
  set,
  basis,
  showDerived,
  only,
}: {
  set: StatementSet;
  basis: "A" | "Q";
  showDerived: boolean;
  /** Render one block. All three when null. */
  only?: BlockKey | null;
}) {
  const derived = useMemo(() => {
    // Recomputed client-side from the resolved lines rather than trusting a
    // second copy off the wire; `deriveLines` is pure and cheap.
    const n = set.periods.length;
    const g = (b: StatementSet["is"], k: string): (number | null)[] => {
      const l = b.lines.find((x) => x.key === k);
      return l && l.values.length === n ? l.values : new Array(n).fill(null);
    };
    const rev = g(set.is, "revenue");
    const ni = g(set.is, "net_income");
    const ebit = g(set.is, "operating_income");
    const ocf = g(set.cf, "ocf");
    const capex = g(set.cf, "capex").map((v) => (v === null ? null : -v));
    const assets = g(set.bs, "total_assets");
    const eq = g(set.bs, "common_equity");
    const fcf = ocf.map((x, i) => (x === null || capex[i] === null ? null : x - (capex[i] as number)));
    const div = (a: (number | null)[], b: (number | null)[], mult = 1) =>
      a.map((x, i) => (x === null || !b[i] ? null : mult === 1 ? x / (b[i] as number) : (x / (b[i] as number)) * 100));
    const yoyOf = (v: (number | null)[]) =>
      v.map((x, i) => (i === 0 || x === null || !v[i - 1] ? null : ((x - (v[i - 1] as number)) / Math.abs(v[i - 1] as number)) * 100));
    return [
      { label: "Revenue YoY %", values: yoyOf(rev) },
      { label: "Operating Margin %", values: div(ebit, rev, 100) },
      { label: "Net Margin %", values: div(ni, rev, 100) },
      { label: "FCF", values: fcf },
      { label: "FCF Margin %", values: div(fcf, rev, 100) },
      { label: "Return On Equity %", values: div(ni, eq, 100) },
      { label: "Return On Assets %", values: div(ni, assets, 100) },
    ];
  }, [set]);

  if (!set.periods.length) {
    return (
      <div className="panel">
        <p className="p-head">Statements — {set.entity || "—"}</p>
        <p className="muted">
          NO USABLE PERIODS IN THE FILINGS READ FOR {basis === "A" ? "ANNUAL" : "QUARTERLY"} BASIS. THE XBRL CARRIES NO FACTS THIS REGISTRANT FILED AS {basis === "A" ? "A 10-K" : "A 10-Q"} DURATION.
        </p>
      </div>
    );
  }

  const unit = set.unit;
  const cell = (v: number | null, u: StatementSet["is"]["lines"][number]["unit"]) => {
    if (!isNum(v)) return <span className="faint">{DASH}</span>;
    if (u === "perShare" || u === "count") return <>{per(v, u)}</>;
    return <>{money(v, unit)}</>;
  };

  const exportCsv = (bk: BlockKey) => {
    const blk = set[bk];
    const head = ["LINE", "XBRL TAG", ...set.periods.map((p) => p.end)];
    const rows = blk.lines.map((l) => [l.label, l.tag ?? "—", ...l.values.map((v) => (v === null ? "" : String(v)))]);
    downloadCSV(`filings_${set.region}_${bk}_${basis}.csv`, head, rows);
  };

  return (
    <>
      {BLOCKS.filter((b) => !only || b.k === only).map(({ k, label }) => {
        const blk = set[k];
        const cov = set.coverage?.[k];
        return (
          <div className="panel" key={k}>
            <p className="p-head">
              {label} — {set.entity} <span className="faint">· {set.periods.length} PERIODS · {unit}</span>
            </p>
            <div className="toolbar" style={{ marginBottom: 8 }}>
              <Coverage cov={cov} />
              <span style={{ flex: 1 }} />
              <button className="ghost" onClick={() => exportCsv(k)}>
                ⤓ CSV
              </button>
            </div>
            {!blk.lines.length ? (
              <p className="muted">NOTHING TAGGED IN THIS BLOCK BY {set.taxonomy.toUpperCase()}.</p>
            ) : (
              <div className="scrollx">
                <table className="plain">
                  <thead>
                    <tr>
                      <th>LINE</th>
                      <th>TAG</th>
                      {set.periods.map((p) => (
                        <th key={p.end} style={{ textAlign: "right" }}>
                          {shortDay(p.end)}
                          {p.kind === "Q" ? <span className="faint"> Q</span> : null}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {blk.lines.map((l) => (
                      <tr key={l.key} className={l.restated ? "active" : undefined} title={l.restated ? "A LATER FILING CHANGED THIS PERIOD — SEE RESTATEMENTS PANEL" : undefined}>
                        <td>{l.label}</td>
                        <td className="faint" style={{ fontSize: 10 }}>
                          {l.tag ?? DASH}
                        </td>
                        {l.values.map((v, i) => (
                          <td key={i} style={{ textAlign: "right" }}>
                            {cell(v, l.unit)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {cov?.caveat ? <Foot>{cov.caveat}</Foot> : null}
          </div>
        );
      })}

      {showDerived ? (
        <div className="panel">
          <p className="p-head">Derived — computed here from the resolved lines above</p>
          <div className="scrollx">
            <table className="plain">
              <thead>
                <tr>
                  <th>METRIC</th>
                  {set.periods.map((p) => (
                    <th key={p.end} style={{ textAlign: "right" }}>
                      {shortDay(p.end)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {derived.map((d) => (
                  <tr key={d.label}>
                    <td>{d.label}</td>
                    {d.values.map((v, i) => (
                      <td key={i} style={{ textAlign: "right" }} className={d.label.includes("Margin") || d.label.includes("Return") || d.label.includes("YoY") ? tone(v) : ""}>
                        {d.label === "FCF" ? cell(v, "money") : pct(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Foot>
            MARGIN / RETURN ROWS ARE PERCENTAGES · "FCF" IS OCF LESS CAPEX AND NEEDS BOTH · A RATIO WITH NO DENOMINATOR READS "—" · NOTHING ON THIS TABLE
            CAME FROM THE FILING: IT IS ARITHMETIC ON FILED FIGURES.
          </Foot>
        </div>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------- index panel

function IndexPanel({ symbol, idx, onPick }: { symbol: string; idx: IndexPayload; onPick: (f: FilingRecord) => void }) {
  const [fam, setFam] = useState("ALL");
  const [q, setQ] = useState("");

  const fams = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of idx.filings) m.set(f.family, (m.get(f.family) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [idx.filings]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return idx.filings.filter(
      (f) => (fam === "ALL" || f.family === fam) && (!needle || f.title.toLowerCase().includes(needle) || f.form.toLowerCase().includes(needle))
    );
  }, [idx.filings, fam, q]);

  return (
    <div className="panel">
      <p className="p-head">
        Filing record — {idx.region === "US" ? "SEC EDGAR" : "NSE INDIA"} · {idx.entity ?? symbol}
      </p>
      <div className="toolbar" style={{ marginBottom: 8 }}>
        <input className="box" placeholder="FILTER FORM OR SUBJECT…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter filings" />
        <Pills opts={["ALL", ...fams.map(([k]) => k)]} val={fam} set={setFam} />
        <span className="faint" style={{ fontSize: 11 }}>
          {idx.total} FILED · {idx.withXbrl} WITH XBRL · {idx.from} → {idx.to}
        </span>
      </div>

      {rows.length ? (
        <div className="scrollx" style={{ maxHeight: 460, overflowY: "auto" }}>
          <table className="plain">
            <thead>
              <tr>
                <th>DATE</th>
                <th>FAMILY</th>
                <th>FORM / SUBJECT</th>
                <th>PERIOD</th>
                <th>ACCESSION</th>
                <th style={{ textAlign: "right" }}>DOC</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 160).map((f) => (
                <tr key={f.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{f.date}</td>
                  <td>
                    <span className={`fil-fam fil-fam-${f.family.toLowerCase()}`}>{f.family}</span>
                  </td>
                  <td>
                    <button className="fil-link" onClick={() => onPick(f)} title="OPEN THIS FILING IN THE AS-FILED / MD&A PANEL">
                      {f.title}
                    </button>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{f.period || DASH}</td>
                  <td className="faint" style={{ fontSize: 10.5 }}>{f.accession}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {f.xbrl ? <span className="badge ok">XBRL</span> : null}
                    {f.html ? (
                      <a className="fil-link" href={f.html} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                        ↗
                      </a>
                    ) : f.pdf ? (
                      <a className="fil-link" href={f.pdf} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                        PDF ↗
                      </a>
                    ) : (
                      <span className="faint">{DASH}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">NO FILINGS MATCH THIS FILTER — WIDEN THE FAMILY PILLS OR CLEAR THE SEARCH.</p>
      )}

      {idx.caveat ? <p className="warn" style={{ fontSize: 11.5, margin: "8px 0 0 0" }}>{idx.caveat}</p> : null}
      <Foot>
        {rows.length < idx.filings.length ? `SHOWING ${Math.min(rows.length, 160)} OF ${rows.length} FILTERED · ` : ""}
        SEC COLUMN HEADERS AND ACCESSION NUMBERS ARE EDGAR&apos;S OWN · NSE ACCESSIONS ARE THE EXCHANGE&apos;S SEQUENCE IDS, NOT EDGAR-STYLE ACCESSIONS · A
        ROW MARKED XBRL HAS AN INSTANCE DOCUMENT; CLICKING ITS TITLE OPENS THE FILED STATEMENTS WHERE EDGAR PUBLISHES RENDERED ONES.
      </Foot>
    </div>
  );
}

// ------------------------------------------------------------------- desk

export function FilingsDesk({ symbol, initialMode, onOpen }: FilingsDeskProps) {
  const [mode, setMode] = useState<Mode>(initialMode ?? "INDEX");
  const [accn, setAccn] = useState("");
  const [basis, setBasis] = useState<"A" | "Q">("A");
  const [block, setBlock] = useState<BlockKey>("is");
  const [indBasis, setIndBasis] = useState<"Consolidated" | "Standalone">("Consolidated");
  const ua = contact();

  const q = (extra: Record<string, string> = {}) => {
    const sp = new URLSearchParams({ symbol, ...extra });
    if (ua) sp.set("secua", ua);
    return sp.toString();
  };

  const status = useLeg<StatusPayload>(`/api/filings/status${ua ? `?secua=${encodeURIComponent(ua)}` : ""}`);
  const idx = useLeg<IndexPayload>(`/api/filings/index?${q({ months: "24" })}`);
  const xbrl = useLeg<XbrlPayload>(`/api/filings/xbrl?${q(indBasis ? { basis: indBasis } : {})}`);
  const asFiled = useLeg<AsFiledPayload>(
    accn ? `/api/filings/asfiled?${q({ accn })}` : null,
    mode === "AS-FILED"
  );
  const mda = useLeg<MdaPayload>(`/api/filings/mda?${q(accn ? { accn } : {})}`, mode === "MD&A");

  const region = xbrl.data?.region ?? idx.data?.region ?? (symbol.endsWith(".NS") || symbol.endsWith(".BO") ? "IN" : "US");
  const entity = xbrl.data?.entity ?? idx.data?.entity ?? symbol;
  const isIndia = region === "IN";

  const set = xbrl.data ? (basis === "A" ? xbrl.data.annual : xbrl.data.quarterly) : null;
  // Hoisted so the nested chart/table callbacks do not each have to re-narrow
  // `xbrl.data`, which TypeScript cannot carry into a closure.
  const unitLabel = xbrl.data?.annual.unit ?? set?.unit ?? "USD";

  // Restatement flags are worth naming individually: a changed historical
  // figure is the single most consequential thing a filing can do quietly.
  const restatements = useMemo(() => {
    if (!xbrl.data) return [] as Array<{ line: string; tag: string }>;
    const out: Array<{ line: string; tag: string }> = [];
    for (const k of ["is", "bs", "cf"] as BlockKey[]) {
      for (const l of xbrl.data[basis === "A" ? "annual" : "quarterly"][k].lines) {
        if (l.restated) out.push({ line: l.label, tag: l.tag ?? DASH });
      }
    }
    return out;
  }, [xbrl.data, basis]);

  const revSeries = useMemo(() => {
    if (!set) return { labels: [] as string[], values: [] as (number | null)[], ebit: [] as (number | null)[], ocf: [] as (number | null)[] };
    const g = (k: string) => set.is.lines.find((l) => l.key === k)?.values ?? new Array(set.periods.length).fill(null);
    const c = (k: string) => set.cf.lines.find((l) => l.key === k)?.values ?? new Array(set.periods.length).fill(null);
    return {
      labels: [...set.periods].reverse().map((p) => shortDay(p.end)),
      values: [...g("revenue")].reverse(),
      ebit: [...g("operating_income")].reverse(),
      ocf: [...c("ocf")].reverse(),
    };
  }, [set]);

  const coverageCells = useMemo((): { total: number; canon: number; pct: number } => {
    if (!xbrl.data) return { total: 0, canon: 0, pct: 0 };
    const s = xbrl.data[basis === "A" ? "annual" : "quarterly"];
    const total = Object.values(s.coverage).reduce((a, c) => a + (c?.resolved.length ?? 0), 0);
    const canon = Object.values(s.coverage).reduce((a, c) => a + (c?.canonical ?? 0), 0);
    return { total, canon, pct: canon ? Math.round((total / canon) * 100) : 0 };
  }, [xbrl.data, basis]);

  const notes = set?.notes ?? [];
  const anyLoading = idx.loading || xbrl.data === null;
  const rootErr = idx.err || (xbrl.err && idx.err ? xbrl.err : "");

  const aiContext = useMemo(() => {
    if (!set || !set.periods.length) return "";
    const parts: string[] = [`ENTITY: ${set.entity}. REGION: ${set.region}. TAXONOMY: ${set.taxonomy}. UNIT: ${set.unit}. PERIODS: ${set.periods.map((p) => p.end).join(", ")}.`];
    for (const k of ["is", "bs", "cf"] as BlockKey[]) {
      for (const l of set[k].lines) {
        const vals = l.values.map((v) => (isNum(v) ? money(v, set.unit) : DASH));
        if (vals.some((v) => v !== DASH)) parts.push(`${l.label}: ${vals.join(" | ")}`);
      }
    }
    const noteText = notes.slice(0, 6).map((n) => `${n.label}: ${n.value}`).join(" · ");
    if (noteText) parts.push(`FILING DISCLOSURES: ${noteText}`);
    return parts.join("\n");
  }, [set, notes]);

  // ---------------------------------------------------------------- states

  if (!status.data && !status.err && status.loading) {
    return <div className="grid"><p className="muted">OPENING FILINGS DESK…</p></div>;
  }

  return (
    <div className="grid" style={{ gap: 10 }}>
      <Head
        right={`${region} · ${isIndia ? "NSE" : "SEC EDGAR"}`}
        sub={`REGULATORY FILINGS, ANNUAL AND QUARTERLY · ${idx.data?.entity ?? entity} · ${
          isIndia
            ? "NSE INTEGRATED-FILING XBRL + FILED PDFs"
            : "SEC EDGAR XBRL + AS-FILED RENDERED STATEMENTS + MD&A"
        }`}
      />

      {status.data && !status.data.hasContact && region === "US" ? (
        <div className="panel">
          <p className="p-head">EDGAR contact — not set</p>
          <ContactEditor />
        </div>
      ) : null}

      <Cells
        items={[
          { l: "REGISTRY", v: region === "US" ? "SEC EDGAR" : "NSE", s: isIndia ? "integrated filing" : `CIK ${idx.data?.cik ?? "—"}` },
          { l: "FILINGS", v: idx.data ? String(idx.data.total) : DASH, s: idx.data ? `${idx.data.withXbrl} with XBRL` : "index leg" },
          {
            l: "XBRL COVERAGE",
            v: xbrl.data ? `${coverageCells.pct}%` : xbrl.loading ? "…" : DASH,
            s: xbrl.data ? `${coverageCells.total}/${coverageCells.canon} lines` : "statements leg",
            cls: coverageCells.pct >= 80 ? "pos" : coverageCells.pct >= 50 ? "" : "warn",
          },
          { l: "PERIODS", v: set ? String(set.periods.length) : DASH, s: set ? `${shortDay(set.periods[set.periods.length - 1]?.end ?? "")} → ${shortDay(set.asOf ?? "")}` : "axis" },
          {
            l: "LATEST FILED",
            v: idx.data?.filings?.[0]?.date ?? DASH,
            s: idx.data?.filings?.[0]?.form ?? "index",
          },
          {
            l: "RESTATEMENTS",
            v: restatements.length ? String(restatements.length) : "0",
            s: restatements.length ? "changed by a later filing" : "none flagged",
            cls: restatements.length ? "warn" : "pos",
          },
        ]}
      />

      <div className="toolbar">
        <Pills opts={MODES} val={mode} set={setMode} />
        {isIndia ? (
          <Pills opts={["Consolidated", "Standalone"] as const} val={indBasis} set={(v) => { setIndBasis(v); }} />
        ) : null}
        <Pills opts={["ANNUAL", "QUARTERLY"] as const} val={basis === "A" ? "ANNUAL" : "QUARTERLY"} set={(v) => setBasis(v === "ANNUAL" ? "A" : "Q")} />
        <span style={{ flex: 1 }} />
        <button className="ghost" onClick={() => { idx.reload(); xbrl.reload(); asFiled.reload(); mda.reload(); }}>
          ↻ RETRY ALL
        </button>
      </div>

      {rootErr ? (
        <div className="panel">
          <p className="neg">
            ERR: {rootErr}
          </p>
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            THE DESK STOPS HERE BECAUSE THE REGISTRY COULD NOT IDENTIFY THIS TICKER. A .BO LISTING CANNOT BE READ SERVER-SIDE (BSE ANSWERS 403
            WITHOUT A BROWSER SESSION); A US TICKER THAT IS NOT AN EDGAR REGISTRANT HAS NO FILINGS TO SHOW.
          </p>
          <div className="toolbar" style={{ marginTop: 8 }}>
            <button className="ghost" onClick={() => idx.reload()}>↻ RETRY</button>
            <button className="ghost" onClick={() => onOpen?.("43", symbol)}>OPEN DOCUMENTS HUB (43)</button>
            <button className="ghost" onClick={() => onOpen?.("12", symbol)}>OPEN STATEMENTS (12)</button>
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------------- INDEX mode */}
      {mode === "INDEX" && idx.data ? (
        <>
          <LegBar err={idx.err} loading={idx.loading} retry={idx.reload} partial={idx.data.partial} errors={idx.data.errors} />
          <IndexPanel
            symbol={symbol}
            idx={idx.data}
            onPick={(f) => {
              setAccn(f.accession);
              setMode(isIndia ? "STATEMENTS" : "AS-FILED");
            }}
          />
          {xbrl.data?.documents ? (
            <div className="panel">
              <p className="p-head">XBRL documents read — {xbrl.data.documents.fetched} parsed · {xbrl.data.documents.failed} failed</p>
              <div className="kv">
                <span className="muted">Instances fetched</span>
                <strong>{xbrl.data.documents.fetched}</strong>
              </div>
              <div className="kv">
                <span className="muted">Facts extracted</span>
                <strong>{xbrl.data.documents.facts.toLocaleString("en-IN")}</strong>
              </div>
              <div className="kv">
                <span className="muted">Contexts resolved</span>
                <strong>{xbrl.data.documents.contexts.toLocaleString("en-IN")}</strong>
              </div>
              <Foot>
                ONE NSE XBRL DOCUMENT COVERS ONE PERIOD, SO THE TIME SERIES IS MERGED ACROSS SEVERAL FILINGS. PER PERIOD THE DOCUMENT CARRYING
                THE MOST STATEMENT FACTS WINS — NOT THE MOST RECENT ONE, BECAUSE NSE FILES A GOVERNANCE DOCUMENT AFTER THE FINANCIALS DOCUMENT
                FOR THE SAME PERIOD AND IT CARRIES NO STATEMENT LINES.
              </Foot>
            </div>
          ) : null}
        </>
      ) : null}

      {/* --------------------------------------------------- STATEMENTS mode */}
      {mode === "STATEMENTS" ? (
        <>
          <LegBar err={xbrl.err} loading={xbrl.loading} retry={xbrl.reload} partial={xbrl.data?.partial} errors={xbrl.data?.errors} />
          {xbrl.data ? (
            <>
              <div className="toolbar">
                <Pills opts={BLOCKS.map((b) => b.label) as unknown as readonly string[]} val={BLOCKS.find((b) => b.k === block)?.label ?? "INCOME"} set={(v) => setBlock(BLOCKS.find((b) => b.label === v)?.k ?? "is")} />
                <span style={{ flex: 1 }} />
                {xbrl.data.ltm ? <span className="badge ok">LTM AVAILABLE</span> : <span className="faint" style={{ fontSize: 11 }}>LTM NEEDS 4 SINGLE QUARTERS</span>}
              </div>

              {xbrl.data.ltm && xbrl.data.ltm.is.lines.length ? (
                <div className="panel">
                  <p className="p-head">Last twelve months — sum of the last four filed quarters</p>
                  <table className="plain">
                    <tbody>
                      {xbrl.data.ltm.is.lines
                        .filter((l) => ["revenue", "gross_profit", "operating_income", "net_income", "eps_diluted"].includes(l.key))
                        .map((l) => (
                          <tr key={l.key}>
                            <td>{l.label}</td>
                            <td style={{ textAlign: "right" }}>
                              {isNum(l.values[0]) ? (l.unit === "perShare" ? per(l.values[0], "perShare") : money(l.values[0], unitLabel)) : DASH}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  <Foot>
                    LTM IS ONLY SHOWN WHEN ALL FOUR QUARTERS ARE FILED. A THREE-QUARTER SUM LABELLED LTM WOULD BE A LIE, SO IT IS NOT
                    COMPUTED AT ALL.
                  </Foot>
                </div>
              ) : null}

              <StatementPanel set={set ?? xbrl.data.annual} basis={basis} showDerived={false} only={block} />
              <div className="panel">
                <p className="p-head">Charts — revenue vs operating income vs operating cash flow</p>
                {revSeries.values.some(isNum) ? (
                  <LineChart
                    series={[
                      { label: "REVENUE", color: "var(--sec)", values: revSeries.values },
                      { label: "OPERATING INCOME", color: "var(--amber)", values: revSeries.ebit },
                      { label: "OPERATING CASH FLOW", color: "var(--cyan)", values: revSeries.ocf },
                    ]}
                    height={150}
                    yFmt={(v) => money(v, unitLabel)}
                    xLabels={revSeries.labels.length ? [revSeries.labels[0], revSeries.labels[Math.floor(revSeries.labels.length / 2)], revSeries.labels[revSeries.labels.length - 1]] : undefined}
                    symbol={symbol}
                    desk="FILINGS"
                  />
                ) : (
                  <p className="muted">NO SERIES TO PLOT — THE RESOLVED LINES CARRY NO VALUES FOR THIS AXIS.</p>
                )}
                <Foot>
                  SERIES GAPS ARE DRAWN AS GAPS, NOT AS ZERO. WHERE A QUARTERLY BASIS IS SHOWN, Q4 IS ABSENT BECAUSE 10-Q COVERS Q1–Q3 ONLY AND
                  Q4 IS NOT FILED AS A QUARTER.
                </Foot>
              </div>
              <DerivedPanel derived={xbrl.data.derived} />
              <RestatementPanel rows={restatements} />
              <NotesPanel notes={notes} />
              {xbrl.data.caveat ? <Foot>{xbrl.data.caveat}</Foot> : null}
            </>
          ) : xbrl.loading ? (
            <p className="muted">READING XBRL…</p>
          ) : null}
        </>
      ) : null}

      {/* ---------------------------------------------------- AS-FILED mode */}
      {mode === "AS-FILED" ? (
        <>
          <LegBar err={asFiled.err} loading={asFiled.loading} retry={asFiled.reload} partial={asFiled.data?.partial} errors={asFiled.data?.errors} />
          {!accn ? (
            <div className="panel">
              <p className="p-head">As-filed statements — no filing chosen</p>
              <p className="muted">
                PICK A FILING IN THE INDEX PANEL AND THIS READS THE STATEMENT EXACTLY AS THE ISSUER PRINTED IT — ITS OWN CAPTION, ITS OWN
                COLUMN SPANS, ITS OWN FOOTNOTE MARKERS, AND THE XBRL TAG BEHIND EVERY LINE.
              </p>
              <div className="toolbar" style={{ marginTop: 8 }}>
                <button className="ghost" onClick={() => setMode("INDEX")}>← OPEN INDEX</button>
              </div>
            </div>
          ) : asFiled.data ? (
            <>
              {asFiled.data.caveat ? <p className="warn" style={{ fontSize: 11.5 }}>{asFiled.data.caveat}</p> : null}
              <div className="toolbar">
                <span className="badge fnc">{asFiled.data.accession}</span>
                {asFiled.data.xlsx ? (
                  <a className="ghost" href={asFiled.data.xlsx} target="_blank" rel="noreferrer">
                    ⤓ EVERY STATEMENT + NOTE AS XLSX
                  </a>
                ) : null}
                <span className="faint" style={{ fontSize: 11 }}>
                  {asFiled.data.noteReportCount ?? 0} NOTE REPORTS IN THIS FILING
                </span>
              </div>
              {asFiled.data.tables.map((t) => (
                <div className="panel" key={t.report}>
                  <p className="p-head">
                    {t.shortName} <span className="faint">· {t.report}</span>
                  </p>
                  {t.caption ? <p className="faint" style={{ fontSize: 10.5, margin: "0 0 8px 0" }}>{t.caption}</p> : null}
                  <div className="scrollx">
                    <table className="plain">
                      <thead>
                        <tr>
                          <th>AS PRINTED</th>
                          <th>TAG</th>
                          {t.cols.map((c, i) => (
                            <th key={i} style={{ textAlign: "right" }}>
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {t.rows.map((r, i) => (
                          <tr key={i}>
                            <td>{r.label}</td>
                            <td className="faint" style={{ fontSize: 10 }}>
                              {r.tag ?? DASH}
                            </td>
                            {t.cols.map((_, ci) => (
                              <td key={ci} style={{ textAlign: "right" }}>
                                {r.cells[ci] ?? <span className="faint">{DASH}</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
              <Foot>
                FIGURES ARE STRINGS, NOT NUMBERS: THEY ARE THE ISSUER&apos;S PRINTED TEXT, CURRENCY SIGNS AND PARENTHESES INCLUDED. A
                PARENTHESIS MEANS NEGATIVE. NOTE SCHEDULES USE SPANNED COLUMNS, SO THEIR VALUES ARE POSITIONAL AND MAY NOT LINE UP WITH THE
                HEADER EXACTLY.
              </Foot>
            </>
          ) : null}
        </>
      ) : null}

      {/* ---------------------------------------------------------- MD&A mode */}
      {mode === "MD&A" ? (
        <>
          <LegBar err={mda.err} loading={mda.loading} retry={mda.reload} />
          {isIndia ? (
            <div className="panel">
              <p className="p-head">MD&amp;A — Indian issuers file it as a disclosure, not as an Item</p>
              <p className="muted">
                THERE IS NO ITEM 7 FOR AN NSE FILER. MANAGEMENT&apos;S OWN COMMENTARY ARRIVES AS A &quot;MANAGEMENT DISCUSSION&quot; OR &quot;INTEGRATED
                FILING&quot; DISCLOSURE AND IS SHOWN, WITH ITS FILED PROSE, IN THE INDEX PANEL — PRESS FILTERS FOR THE COMMENTARY FAMILY.
              </p>
              <div className="toolbar" style={{ marginTop: 8 }}>
                <button className="ghost" onClick={() => setMode("INDEX")}>← OPEN INDEX</button>
                <button className="ghost" onClick={() => onOpen?.("43", symbol)}>OPEN DOCUMENTS HUB (43)</button>
              </div>
            </div>
          ) : mda.data ? (
            <>
              <div className="panel">
                <p className="p-head">
                  Management&apos;s discussion — {mda.data.item} of {mda.data.form} {mda.data.accession}
                </p>
                <Cells
                  items={[
                    { l: "FORM", v: mda.data.form, s: `${mda.data.period} period` },
                    { l: "FILED", v: mda.data.filedAt, s: "acceptance date" },
                    { l: "SECTION", v: mda.data.item, s: "as numbered by the issuer" },
                    { l: "LENGTH", v: `${mdaDataChars(mda.data.chars)}`, s: "characters of filed prose" },
                  ]}
                />
                <div className="toolbar" style={{ marginTop: 10 }}>
                  <a className="ghost" href={mda.data.doc} target="_blank" rel="noreferrer">
                    OPEN THE FILED DOCUMENT ↗
                  </a>
                  <button className="ghost" onClick={() => setAccn("")}>READ THE LATEST INSTEAD</button>
                </div>
                {mda.data.caveat ? <Foot>{mda.data.caveat}</Foot> : null}
              </div>
              <div className="panel">
                <p className="p-head">Filed prose — verbatim</p>
                <div className="fil-prose">
                  {mda.data.paragraphs.slice(0, 60).map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </div>
                {mda.data.paragraphs.length > 60 ? (
                  <Foot>SHOWING THE FIRST 60 OF {mda.data.paragraphs.length} EXTRACTED PARAGRAPHS. THE FILED DOCUMENT IS THE FULL VERSION.</Foot>
                ) : null}
              </div>
              <AiBlock
                label="MD&A read"
                prompt={aiSystem.filingBriefUs()}
                context={`FORM ${mda.data.form}, PERIOD ENDED ${mda.data.period}, ITEM ${mda.data.item}.\n${mda.data.paragraphs.slice(0, 40).join("\n")}`}
              />
            </>
          ) : null}
        </>
      ) : null}

      {/* ------------------------------------------------------- AI statement */}
      {mode === "STATEMENTS" && aiContext ? (
        <AiBlock label="statement read" prompt={aiSystem.filingCompare()} context={aiContext} />
      ) : null}
    </div>
  );
}

function mdaDataChars(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

function DerivedPanel({ derived }: { derived: Array<{ label: string; values: (number | null)[] }> }) {
  const rows = (derived ?? []).slice(0, 17);
  if (!rows.length) return null;
  const n = Math.max(...rows.map((r) => r.values.length));
  return (
    <div className="panel">
      <p className="p-head">Analytics — both bases, computed server-side from the same resolved lines</p>
      <div className="fil-der">
        {rows.map((r) => (
          <div className="kv" key={r.label}>
            <span className="muted">{r.label}</span>
            <strong>
              {r.values.slice(0, 6).map((v) => (
                <span key={Math.random()} className={r.label.includes("%") ? tone(v) : ""} style={{ marginLeft: 10 }}>
                  {r.label === "Free Cash Flow" ? money(v, "") : pct(v)}
                </span>
              ))}
            </strong>
          </div>
        ))}
      </div>
      <Foot>
        FIRST SIX COLUMNS OF THE ANNUAL BASIS FOLLOWED BY NOTHING ELSE · "—" MEANS A LEG OF THE RATIO WAS NOT TAGGED · FCF IS IN ABSOLUTE
        UNITS, EVERY OTHER ROW IS A PERCENT.
      </Foot>
    </div>
  );
}

function RestatementPanel({ rows }: { rows: Array<{ line: string; tag: string }> }) {
  return (
    <div className="panel">
      <p className="p-head">Restatements — periods a later filing changed</p>
      {rows.length ? (
        <table className="plain">
          <thead>
            <tr>
              <th>LINE</th>
              <th>TAG</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.line} className="active">
                <td>{r.line}</td>
                <td className="faint" style={{ fontSize: 10 }}>
                  {r.tag}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">
          NONE FLAGGED. WHERE A PERIOD WAS FILED ONCE AND NEVER REFILED, THE VALUE ABOVE IS THE VALUE AS FILED. A PERIOD FILED TWICE WITH THE
          SAME FIGURE IS NOT A RESTATEMENT AND IS NOT FLAGGED.
        </p>
      )}
      <Foot>
        EDGAR&apos;S COMPANYFACTS KEEPS EVERY FILING OF A PERIOD. THE DESK KEEPS THE MOST RECENT AND FLAGS THE LINE WHEN AN EARLIER FILING
        DISAGREED. A RESTATEMENT IS NOT AUTOMATICALLY BAD — IT IS USUALLY A SEGMENT RECLASSIFICATION — BUT IT MUST BE VISIBLE.
      </Foot>
    </div>
  );
}

function NotesPanel({ notes }: { notes: StatementSet["notes"] }) {
  if (!notes.length) return null;
  const numeric = notes.filter((n) => n.num !== null);
  const text = notes.filter((n) => n.num === null);
  return (
    <>
      {numeric.length ? (
        <div className="panel">
          <p className="p-head">Disclosed ratios and segment figures — as filed</p>
          <HBars
            rows={numeric.slice(0, 18).map((n) => ({
              label: n.label,
              value: n.num as number,
              display: n.value.length > 14 ? `${n.value.slice(0, 14)}…` : n.value,
              color: "var(--amber)",
            }))}
          />
          <Foot>
            THESE ARE THE REGISTRANT&apos;S OWN FILED FIGURES, NOT OUR ARITHMETIC · PURE-UNIT RATIOS IN THE SEBI TAXONOMY CARRY NO DECLARED
            SCALE AND ARE SHOWN EXACTLY AS FILED · SEGMENTS ARE NUMBERED IN FILE ORDER BECAUSE THE TAXONOMY MEMBER NAMES ARE INDICES, NOT
            THE ISSUER&apos;S SEGMENT NAMES.
          </Foot>
        </div>
      ) : null}
      {text.length ? (
        <div className="panel">
          <p className="p-head">Narrative disclosures in the filing — auditor, basis, notes</p>
          <table className="plain">
            <tbody>
              {text.slice(0, 14).map((n) => (
                <tr key={n.key}>
                  <td style={{ whiteSpace: "nowrap", verticalAlign: "top" }}>{n.label}</td>
                  <td style={{ fontSize: 12, lineHeight: 1.55 }}>{n.value.length > 900 ? `${n.value.slice(0, 900)}…` : n.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Foot>
            FILED PROSE, TAG STRIPPED · THE NARRATIVE BLOCKS ARE THE ISSUER&apos;S OWN EXPLANATORY TEXT, NOT A SUMMARY WRITTEN HERE.
          </Foot>
        </div>
      ) : null}
    </>
  );
}

function ContactEditor() {
  const { c, setC, save, msg } = useFilingContact();
  return (
    <>
      <p className="muted" style={{ fontSize: 12 }}>
        EDGAR ASKS EVERY AUTOMATED CALLER FOR A DESCRIPTIVE USER-AGENT WITH A CONTACT ADDRESS, AND BLOCKS REQUESTS THAT DO NOT CARRY ONE. SET IT
        ONCE AND IT IS SENT WITH EVERY EDGAR REQUEST FROM THIS BROWSER. IT IS A PERSONAL ADDRESS, SO IT IS EXCLUDED FROM SETTINGS EXPORT.
      </p>
      <div className="toolbar" style={{ marginTop: 8 }}>
        <input className="box" placeholder="you@yourdomain.com" value={c} onChange={(e) => setC(e.target.value)} aria-label="EDGAR contact email" />
        <button className="btn" onClick={save}>SAVE</button>
        {msg ? <span className="faint" style={{ fontSize: 11 }}>{msg}</span> : null}
      </div>
      <Foot>
        SERVER-SIDE DEPLOYS CAN SET THE SAME VALUE AS THE <code>SEC_CONTACT</code> ENVIRONMENT VARIABLE. PARAM WINS OVER ENV, ENV OVER NONE.
      </Foot>
    </>
  );
}

export default FilingsDesk;