// Single app-level keyboard shortcut dispatcher (careful to avoid
// double-handling inside inputs/textareas). Callers in the terminal shell
// register intent callbacks; this module owns the key wiring only.

export interface ShortcutIntents {
  focusCommand: () => void;
  clearOrBlur: () => void;
  closeFocused: () => void;
  maximizeFocused: () => void;
  focusPanelIndex: (i: number) => void;
  cycleFocus: (dir: 1 | -1) => void;
  triggerFunctionKey: (key: string) => void;
}

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = (el.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export function installShortcuts(intents: ShortcutIntents): () => void {
  function onKey(e: KeyboardEvent) {
    const el = document.activeElement;
    const typing = isTypingTarget(el);
    const inCommand = el && (el as HTMLElement).dataset?.cmdline === "true";

    // F1–F12: trigger function-key bar when command line is not focused.
    if (/^F\d{1,2}$/.test(e.key.toUpperCase()) && !inCommand) {
      const k = e.key.toUpperCase();
      const n = Number(k.slice(1));
      if (n >= 1 && n <= 12) {
        // Don't fight browser-reserved keys: if the browser consumes it
        // (help, devtools), our preventDefault is a no-op fallback.
        try { e.preventDefault(); } catch { /* noop */ }
        intents.triggerFunctionKey(k);
        return;
      }
    }

    // ` or Ctrl/Cmd+K — focus command line from anywhere.
    if ((e.key === "`" && !typing) || ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K"))) {
      e.preventDefault();
      intents.focusCommand();
      return;
    }
    // Esc — clear command line if focused, else blur active input.
    if (e.key === "Escape") {
      intents.clearOrBlur();
      return;
    }
    if (typing && !inCommand) return; // never hijack desk form fields.

    // Ctrl/Cmd+W — close focused panel (confirm if last).
    if ((e.ctrlKey || e.metaKey) && (e.key === "w" || e.key === "W")) {
      e.preventDefault();
      intents.closeFocused();
      return;
    }
    // Ctrl/Cmd+M — maximize/restore focused panel.
    if ((e.ctrlKey || e.metaKey) && (e.key === "m" || e.key === "M")) {
      e.preventDefault();
      intents.maximizeFocused();
      return;
    }
    // Ctrl/Cmd+1..9 — jump focus to panel N.
    if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key)) {
      e.preventDefault();
      intents.focusPanelIndex(Number(e.key) - 1);
      return;
    }
    // Tab / Shift+Tab — cycle focus when command line isn't focused.
    if (e.key === "Tab" && !inCommand && !typing) {
      e.preventDefault();
      intents.cycleFocus(e.shiftKey ? -1 : 1);
    }
  }
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
