"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ModuleInfo } from "@/lib/types";
import { funcCode } from "@/lib/terminal";
import { deskLink } from "@/lib/functionMenus";
import { MODULE_MAP, CATEGORIES } from "@/lib/modules";
import { PSEUDO_DESKS } from "@/lib/terminal/functionKeyMap";
import { store } from "@/lib/store";

function resolveFav(id: string): { code: string; label: string } | null {
  const mod = MODULE_MAP[id];
  if (mod) return { code: funcCode(mod.id), label: mod.label };
  const pseudo = PSEUDO_DESKS[id];
  if (pseudo) return { code: id, label: pseudo.label };
  return null;
}

function readFavs(): string[] {
  try {
    return store.getFavorites();
  } catch {
    return [];
  }
}

// Function directory: Bloomberg-style grouped menu (category columns, numbered
// rows) + favorite tiles on top. Clicking a row/tile opens its desk directly
// for the active ticker. Group collapse persists in localStorage
// (bb.dir.collapsed). Star (★) toggles a favorite — favorites persist in
// localStorage (iss.favorites) and sync across panels via `storage`.
export default function FunctionDirectory({
  ticker,
  modules,
  total,
  onPickHere,
  onPickNew,
}: {
  ticker: string;
  modules: ModuleInfo[];
  total: number;
  onPickHere?: (mod: ModuleInfo) => void;
  onPickNew?: (mod: ModuleInfo) => void;
}) {
  const router = useRouter();
  const [favs, setFavs] = useState<string[]>(() => readFavs());
  const [favsOnly, setFavsOnly] = useState(false);
  const [ctx, setCtx] = useState<{ id: string; x: number; y: number } | null>(null);
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("bb.dir.collapsed");
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    setFavs(readFavs());
    function onStorage(e: StorageEvent) {
      if (e.key === "iss.favorites") setFavs(readFavs());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Custom row menu replaces the browser menu inside terminal panels.
  useEffect(() => {
    if (!ctx) return;
    function onDoc(e: MouseEvent) {
      if ((e.target as HTMLElement | null)?.closest?.(".dir-menu")) return;
      setCtx(null);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setCtx(null); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [ctx]);

  const ctxMod = ctx ? modules.find((m) => m.id === ctx.id) ?? null : null;

  const toggleFav = useCallback((id: string) => {
    try {
      setFavs(store.toggleFavorite(id));
    } catch {
      /* quota — ignore */
    }
  }, []);

  const favSet = useMemo(() => new Set(favs.map((f) => f.toUpperCase())), [favs]);
  const ctxIsFav = ctxMod ? favSet.has(ctxMod.id.toUpperCase()) : false;
  const favMods = useMemo(
    () =>
      favs
        .map((id) => ({ id, resolved: resolveFav(id) }))
        .filter((x): x is { id: string; resolved: { code: string; label: string } } => !!x.resolved),
    [favs]
  );

  const counts = useMemo(() => `${modules.length}/${total}`, [modules.length, total]);

  const visible = useMemo(
    () => (favsOnly ? modules.filter((m) => favSet.has(m.id.toUpperCase())) : modules),
    [modules, favsOnly, favSet]
  );

  const collapsedSet = useMemo(() => new Set(collapsed), [collapsed]);
  const toggleGroup = useCallback((cat: string) => {
    setCollapsed((prev) => {
      const next = prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat];
      try {
        localStorage.setItem("bb.dir.collapsed", JSON.stringify(next));
      } catch {
        /* quota — ignore */
      }
      return next;
    });
  }, []);

  // Bloomberg menu: category columns in registry order, numbered rows.
  const groups = useMemo(() => {
    const order = CATEGORIES.length ? CATEGORIES : Array.from(new Set(modules.map((m) => m.category)));
    return order
      .map((cat) => ({ cat, rows: visible.filter((m) => m.category === cat) }))
      .filter((g) => g.rows.length > 0);
  }, [visible, modules]);

  function open(mod: ModuleInfo) {
    // External apps (http…) open in a new tab — never navigate away.
    if (/^https?:\/\//i.test(mod.route)) {
      window.open(deskLink(mod, ticker), "_blank", "noopener");
      return;
    }
    // Inside the terminal workspace (onPickHere provided) a left-click
    // replaces the currently selected (focused) panel in place — it must
    // never navigate away to a full page. Standalone usage falls back
    // to deep-link navigation.
    if (onPickHere) {
      onPickHere(mod);
      return;
    }
    router.push(deskLink(mod, ticker));
  }

  function openFav(id: string) {
    // Inside the workspace favorites also open in the focused panel.
    if (onPickHere) {
      const mod = MODULE_MAP[id];
      if (mod) {
        onPickHere(mod);
        return;
      }
      // Pseudo-desks (DIR/NOTE/…) have no ModuleInfo — forward the id
      // directly; DirectoryMini only reads `.id` so this opens in place.
      onPickHere({ id } as ModuleInfo);
      return;
    }
    const mod = MODULE_MAP[id];
    if (mod) {
      open(mod);
      return;
    }
    // Pseudo-desks (DIR/NOTE) have no module route — deep-link the terminal.
    router.push(`/?symbol=${encodeURIComponent(ticker)}&func=${encodeURIComponent(id)}`);
  }

  return (
    <div className="panel fndir-panel">
      <p className="p-head">
        Function menu — {counts}
        <span className="faint" style={{ fontWeight: 400 }}>
          {" "}
          · {onPickHere ? "CLICK A ROW TO OPEN IN FOCUSED PANEL" : "CLICK A ROW TO OPEN ITS DESK"}{onPickHere ? " · RIGHT-CLICK FOR OPTIONS" : ""}
        </span>
        <span style={{ flex: 1 }} />
        <button
          className={`ghost fav-filter${favsOnly ? " active" : ""}`}
          onClick={() => setFavsOnly((v) => !v)}
          aria-pressed={favsOnly}
          title={favsOnly ? "SHOW ALL FUNCTIONS" : "SHOW FAVORITES ONLY"}
        >
          {favsOnly ? "★ FAVS" : "☆ FAVS"}
        </button>
      </p>

      {favMods.length > 0 && (
        <div className="fav-wrap" aria-label="Favorite functions">
          <p className="fav-head">{onPickHere ? "★ FAVORITES — CLICK A TILE TO OPEN IN FOCUSED PANEL" : "★ FAVORITES — CLICK A TILE TO OPEN"}</p>
          <div className="fav-tiles">
            {favMods.map(({ id, resolved }) => (
              <div
                key={id}
                className="fav-tile"
                onClick={() => openFav(id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openFav(id);
                  }
                }}
                tabIndex={0}
                role="button"
                title={`${resolved.code} — ${onPickHere ? "OPEN IN FOCUSED PANEL" : "OPEN"} ${resolved.label.toUpperCase()} FOR ${ticker}`}
              >
                <span className="fav-tile-code">{resolved.code}</span>
                <span className="fav-tile-label">{resolved.label.toUpperCase()}</span>
                <button
                  className="fav-tile-x"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFav(id);
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                  title={`REMOVE ${resolved.code} FROM FAVORITES`}
                  aria-label={`Remove ${resolved.label} from favorites`}
                >
                  ★
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bbmenu" role="menu" aria-label="Function menu by category">
        {groups.map(({ cat, rows }) => {
          const shut = collapsedSet.has(cat);
          return (
            <section key={cat} className="bbgroup" aria-label={cat}>
              <button
                className="bbgroup-head"
                onClick={() => toggleGroup(cat)}
                aria-expanded={!shut}
                title={shut ? `EXPAND ${cat.toUpperCase()}` : `COLLAPSE ${cat.toUpperCase()}`}
              >
                <span className="bbgroup-arrow">{shut ? "▸" : "▾"}</span>
                <span className="bbgroup-name">{cat}</span>
                <span className="bbgroup-count">{rows.length}</span>
              </button>
              {!shut && (
                <div className="bbgroup-rows">
                  {rows.map((m, i) => {
                    const code = funcCode(m.id);
                    const isFav = favSet.has(m.id.toUpperCase());
                    return (
                      <div
                        key={m.id}
                        role="menuitem"
                        tabIndex={0}
                        onClick={() => open(m)}
                        onContextMenu={onPickHere ? (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setCtx({
                            id: m.id,
                            x: Math.min(e.clientX, window.innerWidth - 250),
                            y: Math.min(e.clientY, window.innerHeight - 160),
                          });
                        } : undefined}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            open(m);
                          }
                        }}
                        title={`${code} — ${m.label.toUpperCase()} · ${m.description}`}
                        className={`bbrow${isFav ? " fav" : ""}`}
                      >
                        <button
                          className={`fav-star${isFav ? " active" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFav(m.id);
                          }}
                          onKeyDown={(e) => e.stopPropagation()}
                          title={isFav ? `REMOVE ${code} FROM FAVORITES` : `MAKE ${code} A FAVORITE TILE`}
                          aria-label={isFav ? `Remove ${m.label} from favorites` : `Make ${m.label} a favorite`}
                          aria-pressed={isFav}
                          tabIndex={-1}
                        >
                          {isFav ? "★" : "☆"}
                        </button>
                        <span className="bbnum">{String(i + 1).padStart(2, "0")}</span>
                        <span className="bbcode">{code}</span>
                        <span className="bblabel">{m.label}</span>
                        <span className="bbarrow">›</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {visible.length === 0 && (
        <p className="muted">{favsOnly ? "NO FAVORITES MATCH — STAR A ROW TO PIN IT HERE." : "NO FUNCTIONS MATCH — CLEAR THE FILTER."}</p>
      )}
      {ctx && ctxMod && onPickHere && (
        <div className="dir-menu" role="menu" aria-label={`Actions for ${ctxMod.label}`} style={{ left: ctx.x, top: ctx.y }}>
          <button role="menuitem" onClick={() => { setCtx(null); onPickHere(ctxMod); }}>
            ▸ OPEN HERE — {funcCode(ctxMod.id)} FOR {ticker}
          </button>
          {onPickNew && (
            <button role="menuitem" onClick={() => { setCtx(null); onPickNew(ctxMod); }}>
              ⧉ OPEN IN NEW PANEL
            </button>
          )}
          <button role="menuitem" onClick={() => { setCtx(null); toggleFav(ctxMod.id); }}>
            {ctxIsFav ? "★ REMOVE FROM FAVORITES" : "☆ MAKE FAVORITE TILE"}
          </button>
        </div>
      )}
    </div>
  );
}
