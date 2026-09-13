"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ModuleInfo } from "@/lib/types";
import { funcCode } from "@/lib/terminal";
import { deskLink } from "@/lib/functionMenus";
import { MODULE_MAP } from "@/lib/modules";
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

// Function directory: favorite tiles on top + dense FNC | DESK | DESCRIPTION table.
// Clicking a row/tile opens its desk directly for the active ticker.
// Star (★) toggles a favorite — favorites persist in localStorage (iss.favorites)
// and sync across panels via the `storage` event.
export default function FunctionDirectory({
  ticker,
  modules,
  total,
}: {
  ticker: string;
  modules: ModuleInfo[];
  total: number;
}) {
  const router = useRouter();
  const [favs, setFavs] = useState<string[]>(() => readFavs());
  const [favsOnly, setFavsOnly] = useState(false);

  useEffect(() => {
    setFavs(readFavs());
    function onStorage(e: StorageEvent) {
      if (e.key === "iss.favorites") setFavs(readFavs());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggleFav = useCallback((id: string) => {
    try {
      setFavs(store.toggleFavorite(id));
    } catch {
      /* quota — ignore */
    }
  }, []);

  const favSet = useMemo(() => new Set(favs.map((f) => f.toUpperCase())), [favs]);
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

  function open(mod: ModuleInfo) {
    router.push(deskLink(mod, ticker));
  }

  function openFav(id: string) {
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
        Function directory — {counts}
        <span className="faint" style={{ fontWeight: 400 }}>
          {" "}
          · CLICK A ROW TO OPEN ITS DESK
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
          <p className="fav-head">★ FAVORITES — CLICK A TILE TO OPEN</p>
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
                title={`${resolved.code} — OPEN ${resolved.label.toUpperCase()} FOR ${ticker}`}
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

      <table className="fntbl fndir">
        <thead>
          <tr>
            <th style={{ width: 36 }} title="TOGGLE FAVORITE">
              ★
            </th>
            <th style={{ width: 72 }}>FNC</th>
            <th style={{ width: 300 }}>DESK</th>
            <th>DESCRIPTION</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((m) => {
            const code = funcCode(m.id);
            const isFav = favSet.has(m.id.toUpperCase());
            return (
              <tr
                key={m.id}
                onClick={() => open(m)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    open(m);
                  }
                }}
                tabIndex={0}
                title={`${code} — OPEN ${m.label.toUpperCase()} FOR ${ticker}`}
                className={isFav ? "fav-row" : undefined}
              >
                <td className="favcell">
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
                  >
                    {isFav ? "★" : "☆"}
                  </button>
                </td>
                <td className="fnc">{code}</td>
                <td className="desk">{m.label}</td>
                <td className="desc">{m.description}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {visible.length === 0 && (
        <p className="muted">{favsOnly ? "NO FAVORITES MATCH — STAR A ROW TO PIN IT HERE." : "NO FUNCTIONS MATCH — CLEAR THE FILTER."}</p>
      )}
    </div>
  );
}
