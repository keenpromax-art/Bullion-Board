"use client";

// NOTIFICATIONS (spec §S9) — ALERTS / EVENTS / NEWS groups, swipe-dismiss,
// opt-in Web Notifications, honest footer. Serverless = no push worker, so the
// copy says exactly that instead of pretending to deliver in the background.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { store, type Alert } from "@/lib/store";
import { droidStore } from "../lib/droidStore";
import { useApi, useMounted } from "../lib/quotes";
import type { DroidNotif } from "../lib/types";
import { ago, istClock } from "../lib/format";
import { Badge, ErrorState, H, Note, Skeleton } from "../ui/Pills";
import SwipeRow from "../ui/SwipeRow";
import { getOpenPing, setOpenPing, fireOpenPing, registerOpenPing } from "../lib/openAlarm";

interface NewsResp {
  count?: number;
  items?: Array<{ id?: string | number; title: string; link?: string; source?: string; ago?: string; label?: "BULL" | "BEAR" | "NEUT" }>;
}

interface EventRow {
  kind: "DIVIDEND" | "SPLIT";
  date: string;
  detail: string;
  symbol: string;
}

export default function Notifications() {
  const router = useRouter();
  const mounted = useMounted();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [notifs, setNotifs] = useState<DroidNotif[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [evErr, setEvErr] = useState("");
  const [perm, setPerm] = useState<string>("default");
  const [ping, setPing] = useState(false);
  const [pingNote, setPingNote] = useState("");
  const news = useApi<NewsResp>("/api/news?feed=wire");

  const hydrate = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      setAlerts(store.getAlerts());
    } catch {
      setAlerts([]);
    }
    setNotifs(droidStore.getNotifs());
    setPing(getOpenPing().enabled);
    try {
      setPerm(typeof Notification !== "undefined" ? Notification.permission : "unsupported");
    } catch {
      setPerm("unsupported");
    }
  }, []);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // corporate events for the first few watchlist symbols — fail-open per leg
  useEffect(() => {
    if (!mounted) return;
    let alive = true;
    const syms = (droidStore.getLists()[0]?.symbols ?? []).filter((s) => !s.startsWith("^")).slice(0, 5);
    if (!syms.length) return;
    (async () => {
      const rows: EventRow[] = [];
      let failures = 0;
      const cutoff = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
      await Promise.all(
        syms.map(async (s) => {
          try {
            const r = await fetch(`/api/events?symbol=${encodeURIComponent(s)}`, { cache: "no-store" });
            const j = await r.json();
            if (!r.ok || j?.error) throw new Error(String(j?.error ?? "events off"));
            const divs: Array<{ date: string; amount?: number }> = j.dividends ?? [];
            const splits: Array<{ date: string; ratio?: string }> = j.splits ?? [];
            for (const d of divs.filter((x) => x.date >= cutoff).slice(0, 1))
              rows.push({ kind: "DIVIDEND", date: d.date, detail: `₹${d.amount ?? 0} / SHARE`, symbol: s });
            for (const sp of splits.filter((x) => x.date >= cutoff).slice(0, 1))
              rows.push({ kind: "SPLIT", date: sp.date, detail: String(sp.ratio ?? "—"), symbol: s });
          } catch {
            failures++;
          }
        })
      );
      if (!alive) return;
      rows.sort((a, b) => (a.date < b.date ? 1 : -1));
      setEvents(rows);
      setEvErr(failures ? `${failures} SYMBOL LEG(S) DID NOT ANSWER — EVENTS SHOW PARTIAL.` : "");
    })();
    return () => {
      alive = false;
    };
  }, [mounted]);

  const unread = notifs.filter((n) => !n.read).length;
  const armed = useMemo(() => alerts.filter((a) => a.active && !a.triggered), [alerts]);
  const hit = useMemo(() => alerts.filter((a) => a.triggered), [alerts]);

  async function askPerm() {
    try {
      if (typeof Notification === "undefined") return;
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p === "granted") {
        droidStore.pushNotif({ kind: "EVENT", title: "BELL ENABLED", detail: "ALERTS WILL RING WHILE THE APP IS OPEN." });
        hydrate();
      }
    } catch {
      setPerm("unsupported");
    }
  }

  return (
    <div>
      <H right={<span className="dx-faint" style={{ fontSize: 10 }}>IST {istClock()}</span>}>NOTIFICATIONS</H>

      {mounted && unread > 0 ? (
        <div className="dx-inline" style={{ marginBottom: 8 }}>
          <Badge kind="fnc">{unread} UNREAD</Badge>
          <button
            className="dx-btn dx-ghost"
            style={{ minHeight: 30, fontSize: 10 }}
            onClick={() => {
              droidStore.markAllRead();
              hydrate();
            }}
          >
            MARK ALL READ
          </button>
        </div>
      ) : null}

      <H>ALERTS</H>
      {!mounted ? (
        <Skeleton rows={2} height={54} />
      ) : !alerts.length ? (
        <div className="dx-state">
          <div className="dx-state-t">NO ALERTS ARMED</div>
          <div className="dx-state-d">LONG-PRESS A WATCHLIST ROW OR USE ⏰ ON ANY SECURITY PAGE.</div>
          <Link className="dx-btn" href="/watchlist">OPEN WATCHLIST</Link>
        </div>
      ) : (
        <div className="dx-list">
          {[...hit, ...armed].map((a) => (
            <SwipeRow
              key={`${a.symbol}-${a.price}`}
              onTap={() => router.push(`/s/${encodeURIComponent(a.symbol)}`)}
              actions={[
                {
                  key: "clear",
                  label: "CLEAR",
                  color: "#ff453a",
                  onClick: () => {
                    try {
                      store.setAlerts(store.getAlerts().filter((x) => !(x.symbol === a.symbol && x.price === a.price)));
                    } catch {
                      /* ignore */
                    }
                    hydrate();
                  },
                },
              ]}
            >
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span className="dx-sym dx-ellipsis">{a.symbol.replace(/\.(NS|BO)$/, "")}</span>
                <span className="dx-name dx-ellipsis">
                  {a.cond.toUpperCase()} {a.price}
                </span>
              </span>
              <span className="dx-right">
                <span className={`dx-badge ${a.triggered ? "dx-up" : "dx-mute"}`}>{a.triggered ? "TRIGGERED" : "ARMED"}</span>
              </span>
            </SwipeRow>
          ))}
        </div>
      )}

      <H>EVENTS · LAST 12 MONTHS</H>
      {events.length ? (
        <div className="dx-list">
          {events.map((e, i) => (
            <Link key={`${e.symbol}-${e.date}-${i}`} href={`/s/${encodeURIComponent(e.symbol)}`} className="dx-row">
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span className="dx-sym">{e.symbol.replace(/\.(NS|BO)$/, "")} · {e.kind}</span>
                <span className="dx-name dx-ellipsis">{e.date} · {e.detail}</span>
              </span>
              <span className="dx-right dx-faint" style={{ fontSize: 10 }}>DIVIDENDS / SPLITS</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="dx-state">
          <div className="dx-state-t">NO RECENT CORPORATE ACTIONS</div>
          <div className="dx-state-d">
            THE DIVIDEND AND SPLIT FEED RETURNED NOTHING FOR YOUR WATCHLIST IN THE LAST 12 MONTHS.
            {evErr ? ` ${evErr}` : ""}
          </div>
        </div>
      )}

      <H right={<button className="dx-btn dx-ghost" style={{ minHeight: 28, fontSize: 10 }} onClick={news.refresh}>⟳</button>}>
        NEWS
      </H>
      {news.loading && !news.data ? (
        <Skeleton rows={3} height={64} />
      ) : news.error && !news.data ? (
        <ErrorState what="WIRE" retry={news.refresh} detail={news.error} />
      ) : (
        <div className="dx-list">
          {(news.data?.items ?? []).slice(0, 8).map((n, i) => (
            <a key={n.id ?? i} className="dx-row" href={n.link} target="_blank" rel="noreferrer">
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span className="dx-sym dx-ellipsis" style={{ fontSize: 12.5 }}>{n.title}</span>
                <span className="dx-name">{n.source ?? "WIRE"} · {n.ago ?? ""}</span>
              </span>
              <span className={`dx-right ${n.label === "BULL" ? "dx-up" : n.label === "BEAR" ? "dx-down" : "dx-faint"}`} style={{ fontSize: 10 }}>
                {n.label ?? "NEUT"}
              </span>
            </a>
          ))}
        </div>
      )}

      <H>DELIVERY</H>
      <div className="dx-card">
        <div className="dx-inline">
          <span className="dx-faint" style={{ fontSize: 11 }}>
            BROWSER BELL: {perm === "granted" ? "GRANTED" : perm === "denied" ? "BLOCKED" : perm === "unsupported" ? "UNSUPPORTED" : "NOT ENABLED"}
          </span>
          <span className="dx-spacer" />
          {perm === "default" ? (
            <button className="dx-btn" onClick={askPerm}>ENABLE 🔔</button>
          ) : null}
        </div>
        <Note>
          FIRES WHILE THE APP IS OPEN — THIS IS A SERVERLESS PWA WITH NO PUSH WORKER, SO NOTHING IS
          DELIVERED IN THE BACKGROUND. PRICE ALERTS ARE EVALUATED AGAINST THE LIVE TAPE WHEN YOU HAVE
          THE APP OPEN.
        </Note>
      </div>

      <H>OPENING PING</H>
      <div className="dx-card">
        <div className="dx-inline">
          <span className="dx-faint" style={{ fontSize: 11 }}>
            DAILY 9:00 IST — MODULE 109 OPENING NUMBER AS A NOTIFICATION
          </span>
          <span className="dx-spacer" />
          {ping ? (
            <button className="dx-btn dx-ghost" onClick={() => { setOpenPing(false); setPing(false); setPingNote(""); }}>
              ARMED ON — TAP TO DISARM
            </button>
          ) : (
            <button className="dx-btn" onClick={async () => {
              setOpenPing(true); setPing(true);
              try {
                if (typeof Notification !== "undefined" && Notification.permission !== "granted") {
                  const r = await Notification.requestPermission();
                  setPerm(String(r));
                  if (r !== "granted") { setOpenPing(false); setPing(false); setPingNote("ALLOW BROWSER NOTIFICATIONS FIRST."); return; }
                }
              } catch { /* unsupported */ }
              setPingNote(await registerOpenPing());
            }}>
              ENABLE 🔔
            </button>
          )}
          <button className="dx-btn dx-ghost" style={{ fontSize: 10 }} onClick={async () => {
            const ok = await fireOpenPing();
            setPingNote(ok ? "TEST NOTIFICATION FIRED" : "NO NOTIFICATION — CHECK BELL PERMISSION OR NO TAPE RIGHT NOW");
          }}>
            TEST
          </button>
        </div>
        {pingNote ? <Note>{pingNote}</Note> : null}
        <Note>
          ON ANDROID CHROME (INSTALLED PWA) THE SERVICE WORKER WAKES FOR ITS DAILY SYNC AND POSTS THE
          OPENING SCORE; ON EVERY OTHER RUNTIME IT POSTS WHILE THE APP IS OPEN AT 9AM IST. NO NUMBER
          IS FABRICATED — IF THE TAPE IS OFF THE PING IS SKIPPED, NOT PADDED WITH A GUESS.
        </Note>
      </div>

      <div className="dx-note" style={{ marginTop: 12 }}>
        STORED LOCALLY · LAST EVENT {notifs[0] ? ago(notifs[0].ts) : "—"} · TAP AN ALERT TO CLEAR IT.
      </div>
    </div>
  );
}
