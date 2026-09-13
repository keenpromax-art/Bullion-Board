// Backup & restore — moves all browser state across devices without accounts.
// Everything the app persists lives under `iss.*` (store, AI sessions,
// reader, ochain logs…) and `bb.*` (workspaces, command history). A backup
// is a JSON snapshot of those keys; restore writes them back verbatim.

export const BACKUP_VERSION = 1;

const PREFIXES = ["iss.", "bb."];
const SECRET_KEYS = ["iss.openrouter.key", "iss.fred.key"];

export interface BackupFile {
  app: "bullion-board";
  version: number;
  exportedAt: string;
  secrets: boolean;
  data: Record<string, string>;
}

export function collectBackup(includeSecrets: boolean): BackupFile {
  const data: Record<string, string> = {};
  if (typeof window !== "undefined") {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || !PREFIXES.some((p) => k.startsWith(p))) continue;
      if (!includeSecrets && SECRET_KEYS.includes(k)) continue;
      const v = window.localStorage.getItem(k);
      if (v !== null) data[k] = v;
    }
  }
  return {
    app: "bullion-board",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    secrets: includeSecrets,
    data,
  };
}

export function downloadBackup(includeSecrets: boolean): number {
  const b = collectBackup(includeSecrets);
  const d = b.exportedAt.slice(0, 10);
  const blob = new Blob([JSON.stringify(b)], { type: "application/json;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `bullion-board-backup-${d}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return Object.keys(b.data).length;
}

export function parseBackup(text: string): Record<string, string> {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error("NOT A VALID JSON FILE");
  }
  const b = j as Partial<BackupFile>;
  if (!b || b.app !== "bullion-board" || typeof b.data !== "object" || b.data === null) {
    throw new Error("NOT A BULLION BOARD BACKUP");
  }
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(b.data)) {
    if (typeof k !== "string" || typeof v !== "string") continue;
    if (!PREFIXES.some((p) => k.startsWith(p))) continue;
    data[k] = v;
  }
  if (Object.keys(data).length === 0) throw new Error("BACKUP HOLDS NO APP KEYS");
  return data;
}

export function restoreBackup(data: Record<string, string>): number {
  if (typeof window === "undefined") return 0;
  let n = 0;
  for (const [k, v] of Object.entries(data)) {
    try {
      window.localStorage.setItem(k, v);
      n++;
    } catch {
      /* quota — keep what landed */
    }
  }
  return n;
}
