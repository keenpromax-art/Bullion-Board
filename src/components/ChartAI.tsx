"use client";

import { useState } from "react";
import { store } from "@/lib/store";

// AI commentary strip for any chart in the terminal.
//
// It takes the SERIES, not an image: the numbers go to /api/ai/chart, which
// computes its own descriptive statistics server-side and hands the model
// finished arithmetic. A model cannot read a chart, so asking one to describe
// one produces confident nonsense; asking it to state numbers we already
// computed does not. The prompt forbids shape description for the same reason.
//
// Deliberately opt-in per chart rather than automatic. This renders inside
// panels as small as a 4-up tile, and a workspace of four would otherwise fire
// four calls nobody asked for, with the strip pushing the chart it annotates out
// of view in the panels that are already tight.

export interface ChartSeriesPayload {
  label: string;
  values: (number | null)[];
  vol?: number | null;
}

export function ChartAI({
  series,
  symbol,
  desk,
  label,
  context,
}: {
  series: ChartSeriesPayload[];
  symbol?: string;
  desk?: string;
  label?: string;
  context?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");

  const usable = series.filter(
    (s) => s.values.filter((v) => typeof v === "number" && isFinite(v)).length >= 2
  );

  async function run() {
    if (busy) return;
    setOpen(true);
    setBusy(true);
    setErr("");
    setText("");
    try {
      const r = await fetch("/api/ai/chart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Falls back to the active ticker so commentary carries security
        // context at every call site without threading a prop through fifty-odd
        // charts. The caller's own value always wins when it passes one.
        body: JSON.stringify({
          series,
          symbol: symbol || store.getTicker(),
          desk,
          label,
          context,
          // The reader's own key when they set one, exactly as chatComplete
          // does. Without this this strip silently fell back to the server key
          // and became the only AI surface that ignored a user's override.
          apiKey: store.getORKey(),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      // A 200 carrying an error means "nothing to describe" rather than a
      // failure — fewer than two real points on every series is a legitimate
      // answer, not a fault, and must not read as one.
      if (j?.error) { setErr(String(j.error)); return; }
      setText(String(j.text ?? "").trim());
    } catch (e: any) {
      setErr(e?.message ?? "COMMENTARY UNAVAILABLE");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setText("");
    setErr("");
  }

  if (usable.length === 0) return null;

  if (!open) {
    return (
      <button className="cai-btn" onClick={run} title="Read this chart from its plotted series values">
        ◈ AI READ
      </button>
    );
  }

  return (
    <div className="cai">
      <div className="cai-head">
        <span className="cai-t">AI READ · FROM SERIES VALUES</span>
        <button className="cai-x" onClick={close} aria-label="Dismiss commentary">✕</button>
      </div>
      {busy && <p className="cai-busy">COMPUTING STATS · ASKING MODEL…</p>}
      {!busy && err && (
        <>
          <p className="cai-err">{err}</p>
          <button className="cai-btn" onClick={run}>RETRY</button>
        </>
      )}
      {!busy && text && (
        <>
          <p className="cai-txt">{text}</p>
          <p className="cai-foot">
            FIGURES ARE COMPUTED FROM THE PLOTTED SERIES; THE MODEL ONLY PHRASES THEM. NOT ADVICE.
          </p>
        </>
      )}
    </div>
  );
}