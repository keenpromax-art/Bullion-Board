"use client";

// Politician Portfolio Tracker — module 118.
//
// The one place a trader reads what public office-holders have disclosed, across
// the four jurisdictions that actually publish it. Each regime answers a
// DIFFERENT question and the desk never pretends otherwise: the header strip
// always names which register is on screen and what a reader may and may not
// conclude from it.
//
// Anatomy: cells strip -> p-head panels -> verdict banner (panel-glow) -> faint
// footnotes. Every panel has loading / empty / error + retry. Legs run in
// parallel and fail OPEN with a named reason. Derived series live in useMemo.
// No number on this desk is inferred, mid-pointed or carried between
// jurisdictions.

import { useEffect, useMemo, useState } from "react";
import { useDeskFetch } from "@/lib/useDeskFetch";
import { BarChart, HBars, LineChart } from "@/components/charts";
import { funcCode } from "@/lib/terminal";
import { store } from "@/lib/store";
import { chatComplete, aiSystem, NO_INVENT } from "@/lib/ai";
import { downloadCSV } from "@/components/ModuleDesks";
import type { HouseFiling, SenateIndexRow, UkClass, UkInterest, UkMember } from "@/lib/politicians";

const ID = "118";
const DASH = "—";

// ------------------------------------------------------------------ formats

function isNum(v: unknown): v is number {
  return typeof v === "number" && isFinite(v);
}

/** ₹ from a raw rupee figure. Indian declared totals run to thousands of crore. */
function inr(v: number | null | undefined): string {
  if (!isNum(v)) return DASH;
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(a >= 1e9 ? 0 : 2)} Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)} L`;
  return `${sign}₹${a.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function gbp(v: number | null | undefined): string {
  if (!isNum(v)) return DASH;
  return `£${v.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

function pct(v: number | null | undefined, digits = 1): string {
  if (!isNum(v)) return DASH;
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

/** Age of a filing date. Reads YYYY-MM-DD, tolerates an ISO timestamp. */
function ago(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  if (isNaN(d.getTime())) return DASH;
  const v = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (v < 1) return "TODAY";
  if (v < 31) return `${v}D AGO`;
  if (v < 365) return `${Math.round(v / 30)} MO AGO`;
  return `${(v / 365).toFixed(1)} Y AGO`;
}

function cls(v: number | null | undefined): string {
  if (!isNum(v) || v === 0) return "";
  return v > 0 ? "pos" : "neg";
}

const CLASS_TONE: Record<UkClass, string> = {
  DIRECTORSHIP: "var(--sec)",
  EMPLOYMENT: "var(--amber)",
  SECURITIES: "var(--green)",
  PROPERTY: "var(--sec)",
  GIFT: "var(--sub)",
  POLICY: "var(--faint)",
  OTHER: "var(--grid)",
};

// -------------------------------------------------------------------- hooks

type Leg<T> = import("@/lib/useDeskFetch").Leg<T>;

// -------------------------------------------------------------- primitives

function Head({ right }: { right?: string }) {
  return (
    <div className="panel panel-glow">
      <p className="p-head">
        {ID} · {funcCode(ID)} &lt;GO&gt;
        {right ? <span className="faint"> — {right}</span> : null}
      </p>
      <p className="muted" style={{ fontSize: 11.5, margin: "4px 0 0 0" }}>
        STOCK ACT (US HOUSE + SENATE) · REGISTER OF FINANCIAL INTERESTS (UK) · ECI AFFIDAVITS VIA ADR (INDIA)
      </p>
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

function Cells({ items }: { items: Array<{ l: string; v: string; s?: string; c?: string }> }) {
  return (
    <div className="cells">
      {items.map((c) => (
        <div className="cell" key={c.l}>
          <div className="lbl">{c.l}</div>
          <div className={`val ${c.c ?? ""}`} style={{ fontSize: 15 }}>
            {c.v}
          </div>
          {c.s ? <div className="sub">{c.s}</div> : null}
        </div>
      ))}
    </div>
  );
}

function LegBar({ err, loading, retry, hint = "READING" }: { err?: string; loading?: boolean; retry?: () => void; hint?: string }) {
  if (err) {
    return (
      <p className="neg" style={{ fontSize: 12.5 }}>
        {err}{" "}
        {retry ? (
          <button className="ghost" onClick={retry}>
            ↻ RETRY
          </button>
        ) : null}
      </p>
    );
  }
  if (loading) return <span className="muted" style={{ fontSize: 12 }}>{hint}…</span>;
  return null;
}

function Foot({ children }: { children: React.ReactNode }) {
  return (
    <p className="faint" style={{ fontSize: 10.5, lineHeight: 1.6, margin: "10px 0 0 0" }}>
      {children}
    </p>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="muted" style={{ fontSize: 12.5 }}>{children}</p>;
}

function AI({ regime, prompt, enabled }: { regime: string; prompt: string; enabled: boolean }) {
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setOut(""); }, [prompt]);
  async function run() {
    setBusy(true);
    setOut("");
    try {
      setOut(
        await chatComplete(
          [
            { role: "system", content: aiSystem.poliPortfolio(regime) },
            { role: "user", content: `${prompt} ${NO_INVENT}` },
          ],
          { apiKey: store.getORKey(), model: store.getORModel() }
        )
      );
    } catch (e) {
      setOut(`AI ERR: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="toolbar">
        <button className="btn" onClick={run} disabled={busy || !enabled}>
          {busy ? "RUNNING…" : "READ THE RECORD"}
        </button>
        {!enabled && <span className="faint" style={{ fontSize: 11 }}>LOAD A SUBJECT FIRST</span>}
      </div>
      {out && <pre className="ai" style={{ marginTop: 8 }}>{out}</pre>}
    </div>
  );
}

// -------------------------------------------------------------------- modes

export type PoliMode = "REGIME" | "US" | "UK" | "INDIA";
export const POLI_MODES: readonly PoliMode[] = ["REGIME", "US", "UK", "INDIA"];

const MODE_BLURB: Record<PoliMode, string> = {
  REGIME: "FOUR REGISTERS · FOUR DIFFERENT QUESTIONS · WHAT EACH ONE CAN AND CANNOT ANSWER",
  US: "STOCK ACT PERIODIC TRANSACTION REPORTS · HOUSE REGISTER + SENATE eFD",
  UK: "REGISTER OF MEMBERS' FINANCIAL INTERESTS · REGISTRABLE INTERESTS, NOT A PORTFOLIO",
  INDIA: "ELECTION COMMISSION AFFIDAVITS VIA ADR · DECLARED WEALTH AT ELECTION TIME, NEVER TRADE-LEVEL",
};

// =================================================================== REGIME

interface SourcesPayload {
  sources: Array<{
    id: string;
    label: string;
    authority: string;
    cadence: string;
    granularity: string;
    machine: string;
    caveat: string;
    url: string;
    bookLevel: string;
  }>;
  probe?: Record<string, { live: boolean; rows: number; note: string }>;
}

function RegimePanel() {
  const [probeOn, setProbeOn] = useState(false);
  const url = `/api/politicians/sources${probeOn ? "?probe=1" : ""}`;
  const { data, err, loading, reload } = useDeskFetch<SourcesPayload>(url);

  return (
    <div className="grid" style={{ gap: 10 }}>
      <div className="panel">
        <p className="p-head">DISCLOSURE REGIMES</p>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          A STOCK ACT PTR, A REGISTRABLE INTEREST AND A SWORN ELECTION AFFIDAVIT ARE THREE DIFFERENT
          INSTRUMENTS. A DESK THAT ADDS THEM UP IS WRONG. EACH CARD BELOW STATES WHAT ITS REGISTRY
          ACTUALLY SERVES A MACHINE.
        </p>
        <LegBar err={err} loading={loading} retry={reload} hint="READING SOURCE REGISTER" />
        <div style={{ marginTop: 8 }}>
          <Pills opts={["REGISTER", "PROBE LIVE"] as const} val={probeOn ? "PROBE LIVE" : "REGISTER"} set={(v) => setProbeOn(v === "PROBE LIVE")} />
        </div>
        {data && (
          <div className="grid" style={{ gap: 8, marginTop: 10 }}>
            {data.sources.map((s) => {
              const p = data.probe?.[s.id];
              return (
                <div key={s.id} className="panel" style={{ padding: 10 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                    <strong className="sec" style={{ fontSize: 13 }}>{s.label}</strong>
                    <span className={`badge ${p ? (p.live ? "ok" : "bad") : "fnc"}`}>
                      <span className="dot" />{p ? (p.live ? `LIVE · ${p.rows} ROWS` : "UNREACHABLE") : s.bookLevel}
                    </span>
                  </div>
                  <div className="kv"><span className="muted">Authority</span><strong style={{ fontSize: 11.5 }}>{s.authority}</strong></div>
                  <div className="kv"><span className="muted">Cadence</span><strong style={{ fontSize: 11.5 }}>{s.cadence}</strong></div>
                  <div className="kv"><span className="muted">Granularity</span><strong style={{ fontSize: 11.5 }}>{s.granularity}</strong></div>
                  <div className="kv"><span className="muted">Machine layer</span><strong style={{ fontSize: 11.5 }}>{s.machine}</strong></div>
                  {p && <div className="kv"><span className="muted">Probe</span><strong style={{ fontSize: 11.5 }} className={p.live ? "pos" : "neg"}>{p.note}</strong></div>}
                  <p className="warn" style={{ fontSize: 11, lineHeight: 1.55, margin: "8px 0 6px 0" }}>{s.caveat}</p>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11.5 }}>
                    OPEN THE PRIMARY SOURCE ↗
                  </a>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {data && (
        <div className="panel">
          <p className="p-head">WHAT A CROSS-JURISDICTION BOOK COULD AND COULD NOT CONTAIN</p>
          <table className="plain">
            <thead>
              <tr><th>REGIME</th><th>UNIT OF RECORD</th><th>VALUE FILED AS</th><th style={{ textAlign: "right" }}>USABLE AS A BOOK?</th></tr>
            </thead>
            <tbody>
              <tr><td>US HOUSE</td><td>ONE FILING PER DOCUMENT</td><td>NOT IN THE INDEX</td><td style={{ textAlign: "right" }}>NO — INDEX + LINKED FILINGS ONLY</td></tr>
              <tr><td>US SENATE</td><td>ONE FILING PER DOCUMENT</td><td>NOT IN THE INDEX</td><td style={{ textAlign: "right" }}>NO — INDEX PAGED, ASSET LINES GATED</td></tr>
              <tr><td>UK</td><td>ONE REGISTRABLE INTEREST</td><td>USUALLY NONE</td><td style={{ textAlign: "right" }}>NO — NO SIZE, NO TOTAL POSSIBLE</td></tr>
              <tr><td>INDIA</td><td>ONE SWORN TOTAL PER ELECTION</td><td>A POINT-IN-TIME TOTAL</td><td style={{ textAlign: "right" }}>NO — NOT TRANSACTIONAL</td></tr>
            </tbody>
          </table>
          <p className="warn" style={{ fontSize: 11.5, lineHeight: 1.6, margin: "10px 0 0 0" }}>
            VERDICT — NOT ONE OF THE FOUR PUBLISHES A MACHINE-READABLE, TICKER-LEVEL POSITION BOOK.
            THE HOUSE PUTS ITS ASSET LINES IN A PDF AND PUBLISHES NO OPEN FEED FOR THEM; THE SENATE
            PAGES AN INDEX OF FILINGS AND PUTS ITS ASSET LINES BEHIND A USE-AGREEMENT; THE UK REGISTERS
            PROSE WITH NO SIZE; INDIA FILES A TOTAL, NEVER A TRADE. A DESK THAT SHOWED YOU A UNIFIED
            BOOK ACROSS ALL FOUR WOULD BE FILLING AT LEAST ONE LEG FROM ITSELF. THIS DESK READS WHAT
            EACH REGISTRY SERVES AND LINKS THE PRIMARY DOCUMENT FOR EVERYTHING ELSE.
          </p>
          <Foot>
            USE THE REGISTRIES FOR WHAT THEY ARE GOOD FOR: THE HOUSE AND SENATE REGISTERS ARE THE ONLY
            PROMPT, NEAR-REAL-TIME TRADE SIGNALS; THE UK REGISTER IS THE BEST-IN-CLASS CONFLICT-OF-
            INTEREST CHECK; THE ADR AFFIDAVITS ARE THE ONLY ELECTION-CYCLE VIEW OF DECLARED WEALTH.
            NONE OF THEM IS A BACKTESTABLE PORTFOLIO.
          </Foot>
        </div>
      )}
    </div>
  );
}

// ======================================================================= US

interface UsPayload {
  name: string;
  state: string | null;
  filings: HouseFiling[];
  houseCount: number;
  years: string[];
  ptrCount: number;
  senate: { rows: SenateIndexRow[]; scanned: number; total: number | null; from: string | null; to: string | null } | null;
  senateAgreement: string;
  errors: Record<string, string | null>;
  partial: boolean;
}

const HOUSE_STATES = ["", "CA", "NY", "TX", "FL", "IL", "WA", "MA", "NJ", "OH", "PA", "GA", "NC", "MI"];

function UsPanel() {
  const [term, setTerm] = useState("");
  const [name, setName] = useState("");
  const [state, setState] = useState("");
  const { data, err, loading, reload } = useDeskFetch<UsPayload>(
    name ? `/api/politicians/us?name=${encodeURIComponent(name)}&state=${encodeURIComponent(state)}` : null
  );

  const byYear = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of data?.filings ?? []) m.set(f.year, (m.get(f.year) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => Number(b[0]) - Number(a[0]));
  }, [data]);

  const yearsCovered = data?.years.length ?? 0;
  const latestYear = data?.years[0];
  const sinceNewest = latestYear ? Math.max(0, new Date().getFullYear() - Number(latestYear)) : null;

  const senForms = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of data?.senate?.rows ?? []) m.set(r.reportType, (m.get(r.reportType) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  const prompt = useMemo(() => {
    if (!data) return "";
    return [
      `SUBJECT ${data.name.toUpperCase()}${data.state ? ` (${data.state})` : ""}.`,
      `US HOUSE CLERK REGISTER: ${data.houseCount} FILING(S) ACROSS ${yearsCovered} YEAR(S).`,
      `PTR COUNT ${data.ptrCount}. LATEST FILING YEAR ${latestYear ?? "?"}. NEWEST-FIRST GAP ${sinceNewest ?? "?"} YEAR(S).`,
      `PER-YEAR COUNTS ${byYear.map(([y, n]) => `${y}:${n}`).join(" ") || "NONE"}.`,
      data.senate
        ? `SENATE eFD INDEX: ${data.senate.rows.length} MATCHING ROW(S) INSIDE A WINDOW OF ${data.senate.scanned} PAGED ROWS SPANNING ${data.senate.from ?? "?"} TO ${data.senate.to ?? "?"}. FORM MIX ${senForms.map(([k, n]) => `${k}:${n}`).join(" ") || "NONE"}. THE INDEX CARRIES NO ASSET LINES OR VALUES.`
        : `SENATE eFD INDEX: NOT READ. ${data.errors.senate ?? ""}`,
      data.errors.house ? `HOUSE LEG REFUSED: ${data.errors.house}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }, [data, byYear, yearsCovered, latestYear, sinceNewest, senForms]);

  return (
    <div className="grid" style={{ gap: 10 }}>
      <div className="panel">
        <p className="p-head">US — STOCK ACT PERIODIC TRANSACTION REPORTS</p>
        <div className="toolbar">
          <input
            className="box"
            value={term}
            onChange={(e) => setTerm(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === "Enter" && term.trim()) setName(term.trim()); }}
            placeholder="MEMBER SURNAME — E.G. PELOSI"
            aria-label="Member surname"
          />
          <button className="btn" onClick={() => term.trim() && setName(term.trim())} disabled={!term.trim()}>
            READ
          </button>
          {name && (
            <button className="ghost" onClick={() => { setTerm(""); setName(""); }}>
              CLEAR
            </button>
          )}
        </div>
        <div style={{ marginTop: 8 }}>
          <Pills opts={HOUSE_STATES} val={state} set={setState} />
        </div>
        <LegBar err={err} loading={loading && !!name} retry={reload} hint="READING THE CLERK'S REGISTER" />
        {!name && !loading && (
          <Empty>
            THE HOUSE CLERK REGISTERS BY SURNAME, NOT BY TICKER. TYPE A SURNAME AND PRESS READ — THE
            STATE PILLS NARROW THE OFFICE; LEAVE THEM CLEAR FOR A FULL SEARCH.
          </Empty>
        )}
      </div>

      {data && (
        <>
          <Cells
            items={[
              { l: "Filings", v: String(data.houseCount), s: "CLERK REGISTER" },
              { l: "PTRs", v: String(data.ptrCount), s: "PERIODIC TXN", c: data.ptrCount > 0 ? "pos" : "" },
              { l: "Years", v: String(yearsCovered), s: "ON RECORD" },
              { l: "Newest", v: latestYear ?? DASH, s: sinceNewest !== null ? `${sinceNewest}Y AGO` : "FILING YEAR", c: sinceNewest !== null && sinceNewest > 1 ? "neg" : "pos" },
              { l: "Senate index", v: data.senate ? String(data.senate.rows.length) : DASH, s: data.senate ? `MATCH OF ${data.senate.scanned} PAGED` : "NOT READ", c: data.senate ? "pos" : "" },
              { l: "Legs failed", v: String(Object.values(data.errors).filter(Boolean).length), s: "OF 2", c: Object.values(data.errors).filter(Boolean).length ? "neg" : "pos" },
            ]}
          />

          {data.partial && (
            <p className="warn" style={{ fontSize: 11.5, margin: 0 }}>
              PARTIAL — {Object.entries(data.errors).filter(([, v]) => v).map(([k, v]) => `${k.toUpperCase()}: ${v}`).join(" · ")}
            </p>
          )}

          {byYear.length > 1 && (
            <div className="panel">
              <p className="p-head">Filings per year on record</p>
              <BarChart
                values={byYear.map(([, n]) => n)}
                labels={byYear.map(([y]) => y)}
                height={110}
                posColor="var(--amber)"
                negColor="var(--red)"
              />
              <Foot>
                A BAR IS A FILING, NOT A TRADE. A YEAR WITH MANY BARS IS A MEMBER WHO FILES OFTEN OR
                FILES AMENDMENTS — IT IS NOT A LARGER PORTFOLIO.
              </Foot>
            </div>
          )}

          <div className="panel">
            <p className="p-head">House Clerk register</p>
            <LegBar loading={loading} retry={reload} />
            {!loading && !data.filings.length && (
              <Empty>
                THE CLERK SERVED NO FILING FOR “{data.name.toUpperCase()}”. TRY THE SPELLING THE CLERK
                PRINTS (SURNAME FIRST, HONORIFICS INCLUDED) OR CLEAR THE STATE FILTER.
              </Empty>
            )}
            {data.filings.length > 0 && (
              <>
                <div className="scrollx" style={{ maxHeight: 340, overflowY: "auto" }}>
                  <table className="plain">
                    <thead>
                      <tr><th>Year</th><th>Filing</th><th>Office</th><th style={{ textAlign: "right" }}>Document</th></tr>
                    </thead>
                    <tbody>
                      {data.filings.map((f) => (
                        <tr key={f.doc}>
                          <td>{f.year}</td>
                          <td>{f.filing}</td>
                          <td>{f.office}</td>
                          <td style={{ textAlign: "right" }}>
                            <a href={f.doc} target="_blank" rel="noopener noreferrer">
                              FILED PDF ↗
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Foot>
                  EVERY ASSET LINE FOR A HOUSE MEMBER LIVES INSIDE THESE PDFs — THE CLERK PUBLISHES NO
                  MACHINE-READABLE PTR HOLDINGS FEED, SO THIS DESK LINKS THE FILED DOCUMENT RATHER THAN
                  PARSING IT INTO A POSITION BOOK. “AMENDMENT” SUPERSEDES THE ORIGINAL IT AMENDS;
                  READ THE AMENDMENT.
                </Foot>
              </>
            )}
          </div>

          <div className="panel">
            <p className="p-head">Senate eFD — disclosure index</p>
            {!data.senate && (
              <Empty>
                {data.errors.senate ??
                  "NO SENATE INDEX PAGE WAS READ. THIS HOST REFUSES SOME DATACENTRE NETWORKS WITH HTTP 403 — A REFUSAL IS NOT AN EMPTY RESULT."}
              </Empty>
            )}
            {data.senate && (
              <>
                <Cells
                  items={[
                    { l: "Rows matched", v: String(data.senate.rows.length), s: `SURNAME “${data.name.toUpperCase()}”`, c: data.senate.rows.length ? "pos" : "" },
                    { l: "Window", v: data.senate.from?.slice(0, 7) ?? DASH, s: `→ ${data.senate.to?.slice(0, 7) ?? "?"}` },
                    { l: "Paged", v: String(data.senate.scanned), s: `OF ${data.senate.total ?? "?"} ON INDEX` },
                    { l: "Asset lines", v: DASH, s: "BEHIND eFD's USE-AGREEMENT", c: "neg" },
                  ]}
                />
                {!data.senate.rows.length && (
                  <p className="warn" style={{ fontSize: 11.5, margin: "8px 0 0 0" }}>
                    NO INDEX ROW FOR “{data.name.toUpperCase()}” IN THE WINDOW {data.senate.from ?? "?"} TO{" "}
                    {data.senate.to ?? "?"} ({data.senate.scanned} ROWS PAGED). eFD HONOURS NO SERVER-SIDE
                    NAME FILTER WITHOUT ITS USE-AGREEMENT, SO A MISS HERE IS “NOT IN THIS WINDOW” — SEARCH
                    eFD DIRECTLY FOR THE FULL ARCHIVE.
                  </p>
                )}
                {data.senate.rows.length > 0 && (
                  <>
                    {senForms.length > 1 && (
                      <div style={{ marginTop: 10 }}>
                        <p className="p-head">Forms matched</p>
                        <HBars rows={senForms.map(([k, n]) => ({ label: k, value: n, display: String(n) }))} />
                      </div>
                    )}
                    <div className="scrollx" style={{ maxHeight: 300, overflowY: "auto", marginTop: 10 }}>
                      <table className="plain">
                        <thead>
                          <tr><th>Filed</th><th>Age</th><th>Form</th><th>Filer as eFD prints it</th><th style={{ textAlign: "right" }}>Report</th></tr>
                        </thead>
                        <tbody>
                          {data.senate.rows.slice(0, 80).map((r, i) => (
                            <tr key={`${r.doc ?? i}`}>
                              <td>{r.filed ?? DASH}</td>
                              <td>{ago(r.filed)}</td>
                              <td>{r.reportType}</td>
                              <td>{r.display}</td>
                              <td style={{ textAlign: "right" }}>
                                {r.doc ? (
                                  <a href={r.doc} target="_blank" rel="noopener noreferrer">OFFICIAL REPORT ↗</a>
                                ) : (
                                  DASH
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                <Foot>{data.senateAgreement}</Foot>
              </>
            )}
          </div>

          <div className="panel">
            <p className="p-head">AI read — {name.toUpperCase()}</p>
            <AI regime="US STOCK ACT (HOUSE REGISTER + SENATE eFD)" prompt={prompt} enabled={!!data.filings.length || !!data.senate} />
          </div>
        </>
      )}
    </div>
  );
}

// ======================================================================= UK

interface UkSearchPayload { q: string; members: UkMember[]; count: number }
interface UkInterestsPayload {
  id: number;
  interests: UkInterest[];
  count: number;
  byClass: Record<string, number>;
  categories: string[];
  pricedCount: number;
  pricedSum: number | null;
  doc: string;
}
interface UkRegisterPayload {
  from: string; to: string; count: number; byClass: Record<string, number>;
  members: number; totalResults: number; pageSize: number; doc: string;
}

function UkPanel() {
  const [term, setTerm] = useState("");
  const [q, setQ] = useState("");
  const [house, setHouse] = useState("");
  const [picked, setPicked] = useState<UkMember | null>(null);

  const search = useDeskFetch<UkSearchPayload>(q ? `/api/politicians/uk?q=${encodeURIComponent(q)}&house=${house}` : null);
  const sweep = useDeskFetch<UkRegisterPayload>("/api/politicians/ukregister");
  const interests = useDeskFetch<UkInterestsPayload>(picked ? `/api/politicians/ukinterests?id=${picked.id}` : null);
  // Held in a const so TypeScript keeps the narrowing inside the export
  // callback below — it does not survive into a closure over a property.
  const reg = interests.data;

  const classRows = useMemo(
    () =>
      Object.entries(reg?.byClass ?? sweep.data?.byClass ?? {})
        .map(([k, v]) => ({ label: k, value: v, display: String(v), color: CLASS_TONE[k as UkClass] }))
        .sort((a, b) => b.value - a.value),
    [reg, sweep.data]
  );

  const byCategory = useMemo(() => {
    const m = new Map<string, UkInterest[]>();
    for (const i of reg?.interests ?? []) {
      const arr = m.get(i.category) ?? [];
      arr.push(i);
      m.set(i.category, arr);
    }
    return [...m.entries()];
  }, [reg]);

  const prompt = useMemo(() => {
    if (!reg) return "";
    const mix = Object.entries(reg.byClass).map(([k, v]) => `${k}:${v}`).join(" ");
    return [
      `MEMBER ${picked?.name?.toUpperCase()} · ${picked?.party ?? "PARTY UNKNOWN"} · ${picked?.house ?? "?"} · ${picked?.status ?? "?"}.`,
      `REGISTERED INTERESTS ${reg.count} ACROSS ${reg.categories.length} CATEGORIES.`,
      `CLASS MIX ${mix}.`,
      reg.pricedCount
        ? `ONLY ${reg.pricedCount} ENTRY(IES) PRINT A FIGURE, TOTALLING ${gbp(reg.pricedSum)} — THE REST ARE PROSE.`
        : "NO ENTRY ON THIS PAGE PRINTS A FIGURE, SO NO EXPOSURE FIGURE EXISTS FOR THIS MEMBER.",
      "THE UK REGISTER COVERS REGISTRABLE INTERESTS ONLY. AN UNDECLARED BROKERAGE ACCOUNT OR SUB-THRESHOLD HOLDING IS INVISIBLE TO IT.",
    ].join(" ");
  }, [reg, picked]);

  return (
    <div className="grid" style={{ gap: 10 }}>
      <div className="panel">
        <p className="p-head">UK — Register of Members' Financial Interests</p>
        <div className="toolbar">
          <input
            className="box"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && term.trim()) { setQ(term.trim()); setPicked(null); } }}
            placeholder="MEMBER NAME — E.G. STARMER"
            aria-label="UK member name"
          />
          <button className="btn" onClick={() => { if (term.trim()) { setQ(term.trim()); setPicked(null); } }} disabled={!term.trim()}>
            SEARCH
          </button>
        </div>
        <div style={{ marginTop: 8 }}>
          <Pills opts={["", "1", "2"] as const} val={house} set={(v) => { setHouse(v); setPicked(null); }} />
        </div>
        <p className="faint" style={{ fontSize: 10.5, margin: "6px 0 0 0" }}>
          HOUSE 1 = COMMONS, 2 = LORDS. THE MEMBERS API IS THE OFFICIAL OPEN DATA FEED; THE REGISTER
          ITSELF IS PUBLISHED FORTNIGHTLY.
        </p>
        <LegBar err={search.err} loading={search.loading} retry={search.reload} hint="SEARCHING MEMBERS API" />
        {search.data && !search.loading && !search.data.members.length && (
          <Empty>THE MEMBERS API FOUND NO ONE MATCHING “{search.data.q.toUpperCase()}”. SPELL IT AS THE PARLIAMENT DOES (SURNAME OR FORENAME).</Empty>
        )}
        {!!search.data?.members.length && (
          <div className="scrollx" style={{ maxHeight: 220, overflowY: "auto", marginTop: 8 }}>
            <table className="plain">
              <thead>
                <tr><th>Member</th><th>Party</th><th>House</th><th>Since</th><th>Status</th><th style={{ textAlign: "right" }}>Register</th></tr>
              </thead>
              <tbody>
                {search.data.members.map((m) => (
                  <tr key={m.id} className={picked?.id === m.id ? "active" : ""}>
                    <td>{m.name}</td>
                    <td>{m.party ?? DASH}</td>
                    <td>{m.house}</td>
                    <td>{m.from ?? DASH}</td>
                    <td className={m.status === "SITTING" ? "pos" : ""}>{m.status}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="ghost" onClick={() => setPicked(m)}>OPEN</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <p className="p-head">Chamber sweep — interest-class mix</p>
        <LegBar err={sweep.err} loading={sweep.loading} retry={sweep.reload} hint="READING THE FORTNIGHTLY REGISTER" />
        {sweep.data && (
          <>
            <Cells
              items={[
                { l: "Members on page", v: String(sweep.data.members), s: `OF ${sweep.data.totalResults} IN WINDOW` },
                { l: "Interests", v: String(sweep.data.count), s: `IN THE FIRST ${sweep.data.pageSize} BUNDLES` },
                { l: "Window", v: sweep.data.from.slice(0, 7), s: `→ ${sweep.data.to.slice(0, 7)}` },
              ]}
            />
            <div style={{ marginTop: 10 }}>
              {classRows.length ? (
                <HBars rows={classRows} />
              ) : (
                <Empty>NO CATEGORIES CAME BACK IN THE WINDOW — THE REGISTER MAY BE EMPTY FOR THESE DATES.</Empty>
              )}
            </div>
            <Foot>
              COUNTS OF REGISTERED ENTRIES BY CLASS OVER THE FIRST PAGE OF THE FORTNIGHTLY REGISTER —
              {` ${sweep.data.members} MEMBER BUNDLES OF ${sweep.data.totalResults} IN THE WINDOW, NOT THE WHOLE CHAMBER.`}{" "}
              A COUNT IS NOT AN EXPOSURE: MOST ENTRIES PRINT NO FIGURE, SO THESE BARS SAY WHAT PEOPLE
              DECLARE, NOT WHAT IT IS WORTH.
            </Foot>
          </>
        )}
      </div>

      {picked && (
        <div className="panel panel-glow">
          <p className="p-head">
            {picked.name.toUpperCase()}
            <span className="faint"> — {picked.party ?? "PARTY —"} · {picked.house} · {picked.status}</span>
          </p>
          <LegBar err={interests.err} loading={interests.loading} retry={interests.reload} hint="READING REGISTERED INTERESTS" />
          {reg && (
            <>
              <Cells
                items={[
                  { l: "Interests", v: String(reg.count), s: "REGISTERED" },
                  { l: "Categories", v: String(reg.categories.length), s: "REGISTER CLASSES" },
                  { l: "With a figure", v: `${reg.pricedCount}/${reg.count}`, s: "ENTRIES PRINTED £", c: reg.pricedCount === 0 ? "neg" : "" },
                  { l: "Stated £", v: gbp(reg.pricedSum), s: "SUM OF PRINTED FIGURES ONLY" },
                  { l: "Since", v: picked.from ?? DASH, s: "IN HOUSE" },
                  { l: "Exposure", v: DASH, s: "NOT COMPUTABLE — NO SIZE FILED", c: "neg" },
                ]}
              />
              {reg.count === 0 && (
                <p className="warn" style={{ fontSize: 11.5, marginTop: 8 }}>
                  THIS MEMBER HAS NO ENTRY IN THE REGISTER — WHICH IS A REAL ANSWER (NO REGISTRABLE
                  INTEREST DECLARED), NOT A GAP. A BROKERAGE ACCOUNT IS NOT REGISTRABLE.
                </p>
              )}
              {!!byCategory.length && (
                <div style={{ marginTop: 10 }}>
                  {byCategory.map(([cat, list]) => (
                    <div key={cat} style={{ marginBottom: 10 }}>
                      <p className="p-head" style={{ margin: "0 0 4px 0" }}>
                        {cat}
                        <span className="faint"> — {list.length}</span>
                      </p>
                      {list.map((i) => (
                        <div key={i.id} style={{ padding: "6px 0", borderBottom: "1px dotted var(--grid)" }}>
                          <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3 }}>
                            <span className="badge" style={{ color: CLASS_TONE[i.cls], borderColor: CLASS_TONE[i.cls] }}>{i.cls}</span>
                            {i.entity && <span className="sec" style={{ fontSize: 12 }}>{i.entity}</span>}
                            {i.amount !== null && <span className="pos" style={{ fontSize: 12 }}>{gbp(i.amount)}</span>}
                            <span className="faint" style={{ fontSize: 10.5, marginLeft: "auto" }}>
                              {i.amended ? `AMENDED ${i.amended}` : i.registered ? `REG ${i.registered}` : ""}
                            </span>
                          </div>
                          <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.5, margin: 0, whiteSpace: "pre-wrap" }}>
                            {i.text}
                          </p>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              <Foot>
                VERBATIM FROM THE REGISTRAR, INCLUDING THE “(REGISTERED …)” TRAILER THE REGISTRAR
                PRINTS. CATEGORISATION AND THE ENTITY NAME ARE DERIVED BY THIS DESK; THE TEXT IS NOT.
                A SIZE APPEARS ONLY WHERE THE ENTRY PRINTS ONE.
              </Foot>
              <div style={{ marginTop: 10 }}>
                <div className="toolbar">
                  <a className="ghost" href={reg.doc} target="_blank" rel="noopener noreferrer" style={{ padding: "9px 16px", textDecoration: "none" }}>
                    OFFICIAL REGISTER PAGE ↗
                  </a>
                  <button
                    className="ghost"
                    onClick={() =>
                      downloadCSV(
                        `uk_register_${picked.id}`,
                        ["CATEGORY", "CLASS", "ENTITY", "AMOUNT_GBP", "REGISTERED", "AMENDED", "TEXT"],
                        reg.interests.map((i) => [
                          i.category,
                          i.cls,
                          i.entity ?? "",
                          i.amount ?? "",
                          i.registered ?? "",
                          i.amended ?? "",
                          i.text.replace(/\s+/g, " "),
                        ])
                      )
                    }
                  >
                    EXPORT CSV
                  </button>
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <p className="p-head">AI read — {picked.name.toUpperCase()}</p>
                <AI regime="UK REGISTER OF MEMBERS' FINANCIAL INTERESTS" prompt={prompt} enabled={reg.count > 0} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// =================================================================== INDIA

interface RosterRow {
  id: string; name: string; constituency: string; party: string;
  cases: number | null; education: string; assets: number | null;
  assetsBand: string | null; liabilities: number | null; doc: string;
}
interface RosterPayload {
  election: string; electionLabel: string;
  elections: Array<{ key: string; label: string; href: string }>;
  q: string | null; total: number; rows: RosterRow[]; shown: number; top: RosterRow[];
  cohort: { n: number; min: number; p25: number; median: number; p75: number; max: number } | null;
  crorepati: number; withCases: number; source: string; doc: string;
}
interface CandidatePayload {
  candidate: {
    id: string; name: string; party: string | null; constituency: string | null; age: number | null;
    profession: string | null; spouseProfession: string | null;
    assets: number | null; assetsBand: string | null; liabilities: number | null;
    history: Array<{ election: string; assets: number | null; band: string | null; cases: number | null }>;
    income: Array<{ relation: string; pan: string; fy: string; income: number | null }>;
    cases: number | null; caseNotes: string[]; doc: string;
  };
  net: number | null;
  cagr: { pct: number | null; from: string; to: string; years: number };
  selfIncome: number; incomeYears: number; caveat: string;
}

const ELECTION_OPTIONS = [
  { key: "LokSabha2024", label: "2024" },
  { key: "LokSabha2019", label: "2019" },
  { key: "ls2014", label: "2014" },
  { key: "ls2009", label: "2009" },
];

function IndiaPanel() {
  const [election, setElection] = useState("LokSabha2024");
  const [term, setTerm] = useState("");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"assets" | "net" | "cases">("assets");

  const roster = useDeskFetch<RosterPayload>(
    `/api/politicians/roster?election=${encodeURIComponent(election)}${q ? `&q=${encodeURIComponent(q)}` : ""}`
  );
  const detail = useDeskFetch<CandidatePayload>(
    picked ? `/api/politicians/candidate?election=${encodeURIComponent(election)}&id=${encodeURIComponent(picked)}` : null
  );

  const rows = useMemo(() => {
    const list = [...(roster.data?.rows ?? [])];
    if (sortBy === "net") list.sort((a, b) => (b.assets ?? -1) - (b.liabilities ?? 0) - ((a.assets ?? -1) - (a.liabilities ?? 0)));
    else if (sortBy === "cases") list.sort((a, b) => (b.cases ?? -1) - (a.cases ?? -1));
    return list;
  }, [roster.data, sortBy]);

  const declared = useMemo(() => {
    const h = detail.data?.candidate.history ?? [];
    const now = detail.data?.candidate.assets;
    const pts = [...h, { election: detail.data ? roster.data?.electionLabel ?? "" : "", assets: now ?? null, band: null, cases: detail.data?.candidate.cases ?? null }]
      .filter((d) => d.assets !== null)
      .map((d) => ({ ...d, year: Number(d.election.match(/(\d{4})/)?.[1] ?? NaN) }))
      .filter((d) => isFinite(d.year))
      .sort((a, b) => a.year - b.year);
    return pts;
  }, [detail.data, roster.data]);

  const income = useMemo(() => {
    const g = new Map<string, number>();
    for (const r of detail.data?.candidate.income ?? []) {
      if (r.relation !== "self" || r.income === null) continue;
      g.set(r.fy, r.income);
    }
    return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [detail.data]);

  const prompt = useMemo(() => {
    if (!detail.data) return "";
    const c = detail.data.candidate;
    return [
      `CANDIDATE ${c.name.toUpperCase()} · ${c.party ?? "PARTY —"} · ${c.constituency ?? "CONSTITUENCY —"} · AGE ${c.age ?? "?"}.`,
      `DECLARED ASSETS ${inr(c.assets)} (${c.assetsBand ?? "NO BAND"}), LIABILITIES ${inr(c.liabilities)}, DECLARED NET ${inr(detail.data.net)}.`,
      c.profession ? `SELF PROFESSION ${c.profession.toUpperCase()}.` : "",
      `ACROSS ${c.history.length + 1} DECLARATION(S), COMPOUND CHANGE ${pct(detail.data.cagr.pct)} PER YEAR (${detail.data.cagr.from || "?"} → ${detail.data.cagr.to || "?"}).`,
      `ITR INCOME SHOWN FOR ${detail.data.incomeYears} FINANCIAL YEAR(S). DECLARED CRIMINAL CASES ${c.cases ?? "?"}.`,
      c.caseNotes.length ? `CASE SUMMARY ${c.caseNotes.slice(0, 4).join(" | ")}.` : "",
      "THESE ARE SWORN TOTALS FILED AT ELECTION TIME, NOT TRANSACTIONS. NOTHING BETWEEN TWO ELECTIONS IS ON RECORD.",
    ].filter(Boolean).join(" ");
  }, [detail.data]);

  const c = detail.data?.candidate;

  return (
    <div className="grid" style={{ gap: 10 }}>
      <div className="panel">
        <p className="p-head">INDIA — ECI election affidavits via ADR</p>
        <div className="toolbar">
          <input
            className="box"
            value={term}
            onChange={(e) => setTerm(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === "Enter") { setQ(term.trim()); setPicked(null); } }}
            placeholder="NAME, CONSTITUENCY OR PARTY"
            aria-label="Search the elected house"
          />
          <button className="btn" onClick={() => { setQ(term.trim()); setPicked(null); }} disabled={!term.trim()}>FIND</button>
          {q && <button className="ghost" onClick={() => { setTerm(""); setQ(""); setPicked(null); }}>CLEAR</button>}
        </div>
        <div style={{ marginTop: 8, display: "flex", gap: 14, flexWrap: "wrap" }}>
          <Pills opts={ELECTION_OPTIONS.map((e) => e.key)} val={election} set={(k) => { setElection(k); setPicked(null); }} />
          <Pills opts={["assets", "net", "cases"] as const} val={sortBy} set={setSortBy} />
        </div>
        <LegBar err={roster.err} loading={roster.loading} retry={roster.reload} hint="READING THE ADR ELECTED-HOUSE TABLE" />
        {roster.data && (
          <>
            <p className="faint" style={{ fontSize: 10.5, margin: "8px 0 0 0" }}>
              ELECTION {roster.data.electionLabel} · {roster.data.total} WINNER ROW(S) PARSED
              {q ? ` · “${q}” MATCHES ${roster.data.shown} SHOWN` : " · SORTED BY DECLARED ASSETS"}
            </p>
            <div className="scrollx" style={{ maxHeight: 360, overflowY: "auto", marginTop: 8 }}>
              <table className="plain">
                <thead>
                  <tr>
                    <th>Candidate</th><th>Constituency</th><th>Party</th>
                    <th style={{ textAlign: "right" }}>Declared assets</th>
                    <th style={{ textAlign: "right" }}>Liabilities</th>
                    <th style={{ textAlign: "right" }}>Cases</th>
                    <th style={{ textAlign: "right" }}>Affidavit</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={picked === r.id ? "active" : ""}>
                      <td>{r.name}</td>
                      <td>{r.constituency}</td>
                      <td>{r.party}</td>
                      <td style={{ textAlign: "right" }}>{inr(r.assets)}</td>
                      <td style={{ textAlign: "right" }}>{inr(r.liabilities)}</td>
                      <td style={{ textAlign: "right" }} className={r.cases ? "neg" : ""}>{r.cases ?? DASH}</td>
                      <td style={{ textAlign: "right" }}>
                        <button className="ghost" onClick={() => setPicked(r.id)}>OPEN</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!rows.length && <Empty>NO WINNER MATCHES “{q}”. THE BOARD IS THE ELECTED HOUSE FOR THAT ELECTION ONLY.</Empty>}
          </>
        )}
      </div>

      {roster.data && (
        <div className="panel">
          <p className="p-head">Elected-house distribution — declared assets</p>
          <Cells
            items={[
              { l: "Winners", v: String(roster.data.total), s: "ROWS PARSED" },
              { l: "₹1 Cr+", v: String(roster.data.crorepati), s: "DECLARED", c: "pos" },
              { l: "With cases", v: String(roster.data.withCases), s: "DECLARED" },
              { l: "Median", v: inr(roster.data.cohort?.median ?? null), s: "DECLARED ASSET" },
              { l: "P25–P75", v: `${inr(roster.data.cohort?.p25 ?? null)} – ${inr(roster.data.cohort?.p75 ?? null)}`, s: "MIDDLE HALF" },
              { l: "Max", v: inr(roster.data.cohort?.max ?? null), s: "DECLARED" },
            ]}
          />
          <Foot>
            QUANTILES OVER THE WHOLE PARSED ELECTED HOUSE, NOT OVER THE CURRENT SEARCH — SO A FILTER
            NEVER REBASES THE DISTRIBUTION. EVERY FIGURE IS A SWORN TOTAL IN RUPEES, SELF + SPOUSE + HUF
            + DEPENDENTS, AS AT THE AFFIDAVIT DATE.
          </Foot>
          <div style={{ marginTop: 8 }}>
            <HBars
              rows={(roster.data.top ?? []).slice(0, 10).map((r) => ({
                label: r.name.length > 26 ? `${r.name.slice(0, 25)}…` : r.name,
                value: r.assets ?? 0,
                display: inr(r.assets),
              }))}
            />
          </div>
        </div>
      )}

      {picked && (
        <div className="panel panel-glow">
          <p className="p-head">
            {c?.name?.toUpperCase() ?? `CANDIDATE ${picked}`}
            {c?.party ? <span className="faint"> — {c.party} · {c.constituency ?? "CONSTITUENCY —"}</span> : null}
          </p>
          <LegBar err={detail.err} loading={detail.loading} retry={detail.reload} hint="READING THE AFFIDAVIT" />
          {detail.data && c && (
            <>
              <Cells
                items={[
                  { l: "Declared assets", v: inr(c.assets), s: c.assetsBand ?? "AS SWORN" },
                  { l: "Liabilities", v: inr(c.liabilities), s: "AS SWORN" },
                  { l: "Declared net", v: inr(detail.data.net), s: "ASSETS − LIABILITIES", c: (detail.data.net ?? 0) < 0 ? "neg" : "pos" },
                  { l: "Compound Δ", v: pct(detail.data.cagr.pct), s: detail.data.cagr.years > 0 ? "PER YEAR, DECLARED TOTALS" : "NEEDS 2+ ELECTIONS", c: cls(detail.data.cagr.pct) },
                  { l: "ITR years", v: String(detail.data.incomeYears), s: "INCOME ON RECORD" },
                  { l: "Declared cases", v: String(c.cases ?? DASH), s: "AFFIDAVIT", c: c.cases ? "neg" : "" },
                ]}
              />

              {c.age !== null && (
                <div className="grid grid-2" style={{ marginTop: 10 }}>
                  <div>
                    <div className="kv"><span className="muted">Age</span><strong>{c.age}</strong></div>
                    <div className="kv"><span className="muted">Self profession</span><strong style={{ fontSize: 11.5 }}>{c.profession ?? DASH}</strong></div>
                    <div className="kv"><span className="muted">Spouse profession</span><strong style={{ fontSize: 11.5 }}>{c.spouseProfession ?? DASH}</strong></div>
                  </div>
                  <div>
                    <div className="kv"><span className="muted">PAN declared</span><strong>{c.income.some((r) => r.pan === "Y") ? "YES" : "NO"}</strong></div>
                    <div className="kv"><span className="muted">Self ITR rows</span><strong>{detail.data.selfIncome}</strong></div>
                    <div className="kv"><span className="muted">Regime</span><strong style={{ fontSize: 11.5 }}>DECLARED TOTAL, NO TRADE REPORT</strong></div>
                  </div>
                </div>
              )}

              {declared.length > 1 && (
                <div style={{ marginTop: 10 }}>
                  <p className="p-head">Declared assets across every election on record</p>
                  <LineChart
                    series={[{ label: "DECLARED ASSETS (₹)", color: "var(--amber)", values: declared.map((d) => d.assets) }]}
                    xLabels={[declared[0]?.election ?? "", declared[Math.floor(declared.length / 2)]?.election ?? "", declared[declared.length - 1]?.election ?? ""]}
                    height={140}
                    yFmt={(v) => inr(v)}
                    desk={funcCode(ID)}
                    label="DECLARED ASSETS"
                  />
                  <Foot>
                    EACH POINT IS A SWORN TOTAL ON AN AFFIDAVIT, YEARS APART AND PRICED BY THE CANDIDATE
                    AT THAT MOMENT. THE LINE IS A DECLARATION HISTORY, NOT A PRICE SERIES — NOTHING
                    HAPPENING BETWEEN TWO ELECTIONS IS ON RECORD.
                  </Foot>
                </div>
              )}

              {income.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <p className="p-head">Total income shown in ITR — self</p>
                  <BarChart
                    values={income.map(([, v]) => v)}
                    labels={income.map(([fy]) => fy.replace(/\s*-\s*/g, "/"))}
                    height={120}
                    posColor="var(--amber)"
                    negColor="var(--red)"
                    desk={funcCode(ID)}
                  />
                  <Foot>
                    AS PRINTED IN THE AFFIDAVIT'S PAN/ITR TABLE, WHERE SOME YEARS ARE MARKED ** — THAT
                    IS ADR'S OWN READABILITY MARKER ON THE SCANNED FIGURE, NOT A DATA GAP.
                  </Foot>
                </div>
              )}

              {!!c.caseNotes.length && (
                <div style={{ marginTop: 10 }}>
                  <p className="p-head">Declared criminal cases — as printed</p>
                  {c.caseNotes.map((n, i) => (
                    <p key={i} className="muted" style={{ fontSize: 11.5, lineHeight: 1.5, margin: "0 0 4px 0" }}>{n}</p>
                  ))}
                  <Foot>
                    A DECLARED CASE COUNT IS AN AFFIDAVIT STATEMENT, NOT A FINDING OF GUILT, AND THE
                    CANDIDATE’S OWN DISCLOSURE IS THE ONLY SOURCE READ HERE.
                  </Foot>
                </div>
              )}

              <Foot>{detail.data.caveat}</Foot>

              <div className="toolbar" style={{ marginTop: 8 }}>
                <a className="ghost" href={c.doc} target="_blank" rel="noopener noreferrer" style={{ padding: "9px 16px", textDecoration: "none" }}>
                  OFFICIAL AFFIDAVIT PAGE ↗
                </a>
                <button
                  className="ghost"
                  onClick={() =>
                    downloadCSV(
                      `adr_declarations_${c.id}`,
                      ["ELECTION", "DECLARED_ASSETS_INR", "BAND", "DECLARED_CASES"],
                      (
                        c.history.length
                          ? c.history
                          : [{ election: roster.data?.electionLabel ?? "current", assets: c.assets, band: c.assetsBand, cases: c.cases }]
                      ).map((h) => [h.election, h.assets ?? "", h.band ?? "", h.cases ?? ""])
                    )
                  }
                >
                  EXPORT DECLARATIONS CSV
                </button>
              </div>

              <div style={{ marginTop: 10 }}>
                <p className="p-head">AI read — {c.name.toUpperCase()}</p>
                <AI regime="INDIA — ECI AFFIDAVIT VIA ADR (DECLARED WEALTH, NOT TRANSACTIONS)" prompt={prompt} enabled={c.assets !== null || !!c.history.length} />
              </div>
            </>
          )}
        </div>
      )}

      {roster.data && (
        <Foot>
          SOURCE: {roster.data.source}.{" "}
          <a href={roster.data.doc} target="_blank" rel="noopener noreferrer">OPEN ADR ↗</a> · INDIA
          PUBLISHES NO STOCK ACT EQUIVALENT — THESE ARE ELECTION-TIME DECLARATIONS AND ANNUAL
          DECLARATIONS OF ASSETS, SO A POSITION BOUGHT OR SOLD BETWEEN ELECTIONS LEAVES NO TRAIL.
        </Foot>
      )}
    </div>
  );
}

// ===================================================================== desk

export interface PoliDeskProps {
  initialMode?: PoliMode;
}

export function PoliDesk({ initialMode = "REGIME" }: PoliDeskProps) {
  const [mode, setMode] = useState<PoliMode>(initialMode);

  return (
    <div className="grid" style={{ gap: 10 }}>
      <Head />
      <div className="toolbar">
        <Pills opts={POLI_MODES} val={mode} set={setMode} />
        <span className="faint" style={{ fontSize: 10.5, marginLeft: "auto", textAlign: "right" }}>
          {MODE_BLURB[mode]}
        </span>
      </div>
      {mode === "REGIME" && <RegimePanel />}
      {mode === "US" && <UsPanel />}
      {mode === "UK" && <UkPanel />}
      {mode === "INDIA" && <IndiaPanel />}
    </div>
  );
}

export default PoliDesk;