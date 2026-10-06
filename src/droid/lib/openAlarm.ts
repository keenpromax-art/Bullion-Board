// Daily 9:00 IST "opening number" ping. Two delivery paths:
// 1. Periodic Background Sync (Android Chrome PWA) — the SW fires for us
//    roughly once a day while permission is granted and storage is warm.
// 2. In-page check while the app is open/foreground-ish (best-effort timer,
//    so a phone sitting at the morning desk still catches 9am).
// Serverless = no push worker, so the copy in Notifications says so plainly.

const K = "bb.droid.openping.v1";

interface OpenPing {
  enabled: boolean;
  lastShown: string; // YYYY-MM-DD (IST)
}

function read(): OpenPing {
  if (typeof window === "undefined") return { enabled: false, lastShown: "" };
  try {
    const raw = localStorage.getItem(K);
    if (!raw) return { enabled: false, lastShown: "" };
    const p = JSON.parse(raw) as OpenPing;
    return { enabled: !!p.enabled, lastShown: typeof p.lastShown === "string" ? p.lastShown : "" };
  } catch {
    return { enabled: false, lastShown: "" };
  }
}

function write(p: OpenPing) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(K, JSON.stringify(p)); } catch { /* quota */ }
}

export function getOpenPing(): OpenPing {
  return read();
}

export function setOpenPing(enabled: boolean) {
  write({ ...read(), enabled });
}

const CALL_TEXT: Record<string, string> = {
  GREEN: "GAP UP",
  RED: "GAP DOWN",
  FLAT: "STAND ASIDE",
  NO_DATA: "NO CALL",
};

function istParts(): { date: string; hour: number } {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  return { date: `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`, hour: d.getHours() };
}

export async function fireOpenPing(): Promise<boolean> {
  try {
    const r = await fetch("/api/opening", { cache: "no-store" });
    if (!r.ok) throw new Error("opening failed");
    const j = await r.json();
    const op = j?.predict;
    if (!op) return false;
    const call = CALL_TEXT[op.verdict] ?? op.verdict ?? "—";
    const edge = typeof op.edge === "number" && isFinite(op.edge) ? `${op.edge >= 0 ? "+" : ""}${op.edge.toFixed(2)}` : "—";
    const gap = typeof op.expectedGapPct === "number" && isFinite(op.expectedGapPct) ? `${op.expectedGapPct >= 0 ? "+" : ""}${op.expectedGapPct.toFixed(2)}%` : "—";
    const conf = typeof op.confidence === "number" && isFinite(op.confidence) ? `${Math.round(op.confidence * 100)}%` : "—";
    const title = `OPENING CALL: ${call}`;
    const body = `EDGE ${edge} · EXP GAP ${gap} · CONF ${conf} · MODULE 109`;
    let shown = false;
    try {
      const reg = await navigator.serviceWorker?.ready;
      if (reg?.showNotification) {
        await reg.showNotification(title, { body, tag: "openping-daily" });
        shown = true;
      }
    } catch { /* fall through */ }
    if (!shown && typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body, tag: "openping-daily" });
      shown = true;
    }
    if (shown) {
      const p = read();
      p.lastShown = istParts().date;
      write(p);
    }
    return shown;
  } catch {
    return false;
  }
}

// Hook from the DroidShell heartbeat — fires at 9am IST once per calendar day.
export async function checkOpenPing(): Promise<void> {
  const p = read();
  if (!p.enabled) return;
  if (typeof Notification !== "undefined" && Notification.permission !== "granted") return;
  const now = istParts();
  if (now.hour < 9 || now.hour > 11) return;
  if (p.lastShown === now.date) return;
  await fireOpenPing();
}

export async function registerOpenPing(): Promise<string> {
  try {
    const reg = await navigator.serviceWorker?.ready;
    const anyReg = reg as any;
    if (anyReg?.periodicSync) {
      const status = await anyReg.periodicSync.getStatus?.().catch(() => undefined);
      try {
        await anyReg.periodicSync.register("openping-daily", { minInterval: 12 * 60 * 60 * 1000 });
        return status && status !== "granted" ? "PERIODIC SYNC REGISTERED (BACKUP)" : "PERIODIC SYNC ARMED";
      } catch {
        return "PERIODIC SYNC REFUSED — FALLING BACK TO APP-OPEN DELIVERY";
      }
    }
    return "PERIODIC SYNC UNSUPPORTED — PING FIRES WHILE THE APP IS OPEN";
  } catch {
    return "PERIODIC SYNC UNAVAILABLE — PING FIRES WHILE THE APP IS OPEN";
  }
}
