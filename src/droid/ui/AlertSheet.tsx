"use client";

// Alert creation sheet (spec §S13/§18) — writes the SAME Alert shape the
// desktop /alerts desk reads (iss.alerts), so both surfaces stay in sync.

import { useEffect, useState } from "react";
import { store } from "@/lib/store";
import Sheet from "./Sheet";
import { inr } from "../lib/format";

export default function AlertSheet({
  open,
  onClose,
  symbol,
  current,
}: {
  open: boolean;
  onClose: () => void;
  symbol: string;
  current?: number | null;
}) {
  const [cond, setCond] = useState<"above" | "below">("above");
  const [price, setPrice] = useState("");
  const [saved, setSaved] = useState<null | { price: number; cond: string; current: number | null }>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) {
      setSaved(null);
      setErr("");
      setCond("above");
      setPrice(current && isFinite(current) ? String(Math.round(current * 1.01)) : "");
    }
  }, [open, current]);

  function save() {
    const p = Number(String(price).replace(/,/g, ""));
    if (!isFinite(p) || p <= 0) {
      setErr("ENTER A VALID PRICE");
      return;
    }
    try {
      const list = store.getAlerts();
      const id = list.reduce((m, a) => Math.max(m, a.id), 0) + 1;
      list.push({
        id,
        symbol,
        cond,
        price: p,
        active: true,
        triggered: false,
        created: new Date().toISOString(),
      });
      store.setAlerts(list);
      setSaved({ price: p, cond, current: current ?? null });
      setErr("");
    } catch {
      setErr("STORAGE UNAVAILABLE");
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={saved ? "ALERT CREATED" : `SET ALERT · ${symbol.replace(/\.(NS|BO)$/, "")}`}
      half
      footer={
        saved ? (
          <button className="dx-btn" style={{ flex: 1 }} onClick={onClose}>
            DONE
          </button>
        ) : (
          <>
            <button className="dx-btn" style={{ flex: 1 }} onClick={save}>
              CREATE ALERT
            </button>
            <button className="dx-btn dx-ghost" onClick={onClose}>
              CANCEL
            </button>
          </>
        )
      }
    >
      {saved ? (
        <div>
          <div className="dx-sec-px" style={{ fontSize: 24 }}>{symbol.replace(/\.(NS|BO)$/, "")}</div>
          <div className="dx-sec-px" style={{ fontSize: 30, color: "var(--dx-amber)" }}>{inr(saved.price, 2)}</div>
          <div className="dx-sec-meta" style={{ marginTop: 4 }}>
            {saved.cond === "above" ? "ABOVE" : "BELOW"} · CURRENT {saved.current ? inr(saved.current, 2) : "—"}
          </div>
          <div className="dx-note" style={{ marginTop: 12 }}>
            YOU&apos;LL BE NOTIFIED WHEN THE CONDITION IS TRIGGERED WHILE THE APP IS OPEN.
            ARMED ALERTS ALSO SYNC TO THE DESKTOP ALERTS DESK.
          </div>
        </div>
      ) : (
        <div className="dx-col">
          <div className="dx-pills">
            <button className={`dx-pill${cond === "above" ? " dx-on" : ""}`} onClick={() => setCond("above")}>
              PRICE ABOVE
            </button>
            <button className={`dx-pill${cond === "below" ? " dx-on" : ""}`} onClick={() => setCond("below")}>
              PRICE BELOW
            </button>
          </div>
          <div className="dx-searchbar">
            <span className="dx-amber">₹</span>
            <input
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="TARGET PRICE"
              aria-label="Target price"
            />
          </div>
          {current && isFinite(current) ? (
            <div className="dx-note">CURRENT LAST {inr(current, 2)}</div>
          ) : null}
          {err ? <div className="dx-note" style={{ color: "var(--dx-red)" }}>{err}</div> : null}
          <div className="dx-note">
            BASIC PRICE TRIGGERS TODAY. VOLUME / RSI / EVENT CONDITIONS ARRIVE WITH THE ALERTS DESK PUSH.
          </div>
        </div>
      )}
    </Sheet>
  );
}
