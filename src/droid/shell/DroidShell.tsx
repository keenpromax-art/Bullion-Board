"use client";

// Bullion Droid app shell: TopBar + (tablet rail) + content + BottomNav +
// SW registration + install prompt. Desktop ≥1200px renders children through
// with a single terminal link — the terminal stays the desktop experience.

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { droidStore } from "../lib/droidStore";
import { useIsDesktop, useIsTablet, useMounted } from "../lib/quotes";
import RegisterSW from "./RegisterSW";
import InstallPrompt from "./InstallPrompt";
import { ALL_DESKS } from "../lib/categories";

const TABS = [
  { href: "/home", label: "HOME", ico: "⌂" },
  { href: "/markets", label: "MARKETS", ico: "▤" },
  { href: "/watchlist", label: "WATCH", ico: "★" },
  { href: "/research", label: "RESEARCH", ico: "◈" },
  { href: "/ai", label: "AI", ico: "✦" },
] as const;

const TITLES: Array<[RegExp, string]> = [
  [/^\/$/, "BULLION DROID"],
  [/^\/home/, "TODAY"],
  [/^\/markets/, "MARKET PULSE"],
  [/^\/watchlist/, "WATCHLIST"],
  [/^\/s\//, "SECURITY"],
  [/^\/research\/.+/, "RESEARCH MODE"],
  [/^\/research/, "RESEARCH"],
  [/^\/ai/, "ASK BULLION DROID"],
  [/^\/brief/, "MORNING BRIEF"],
  [/^\/notifications/, "NOTIFICATIONS"],
  [/^\/more/, "ALL DESKS"],
  [/^\/search/, "SEARCH"],
  [/^\/d\//, "DESK"],
];

const TOP_LEVEL = new Set(["/home", "/markets", "/watchlist", "/research", "/ai"]);

export default function DroidShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const mounted = useMounted();
  const isTablet = useIsTablet();
  const isDesktop = useIsDesktop();
  const [mode, setMode] = useState<"simple" | "pro">("simple");
  const [lite, setLite] = useState(false);
  const [unread, setUnread] = useState(0);

  const hydrate = useCallback(() => {
    try {
      const m = droidStore.getMode();
      setMode(m === "pro" ? "pro" : "simple");
      setLite(droidStore.isLite());
      setUnread(droidStore.unreadCount());
    } catch {
      /* storage unavailable */
    }
  }, []);

  useEffect(() => {
    hydrate();
    const onStorage = () => hydrate();
    window.addEventListener("storage", onStorage);
    const t = window.setInterval(() => setUnread(droidStore.unreadCount()), 30_000);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(t);
    };
  }, [hydrate]);

  const title = useMemo(() => {
    const hit = TITLES.find(([re]) => re.test(pathname));
    if (hit) return hit[1];
    if (/^\/d\//.test(pathname)) return "DESK";
    return "BULLION DROID";
  }, [pathname]);

  const showBack = mounted && !TOP_LEVEL.has(pathname) && pathname !== "/";

  // Desktop: children pass through — droid chrome stays out of the terminal.
  if (mounted && isDesktop) {
    return (
      <div className="dx" data-lite={lite ? "1" : "0"} id="droid-root">
        <div style={{ maxWidth: 980, margin: "0 auto", padding: "18px 16px 40px" }}>
          <div className="dx-inline" style={{ marginBottom: 14 }}>
            <span className="dx-amber" style={{ fontWeight: 700, letterSpacing: "0.06em" }}>
              ◈ BULLION DROID
            </span>
            <span className="dx-spacer" />
            <Link className="dx-btn dx-ghost" href="/terminal">
              OPEN TERMINAL ▦
            </Link>
          </div>
          {children}
        </div>
        <InstallPrompt />
      </div>
    );
  }

  return (
    <div className="dx" data-lite={lite ? "1" : "0"} id="droid-root">
      <header className="dx-topbar">
        {showBack ? (
          <button className="dx-iconbtn" aria-label="Back" onClick={() => router.back()}>
            ←
          </button>
        ) : (
          <span className="dx-brand" aria-hidden>
            <span className="dx-mark">◈</span>
            {pathname === "/home" ? <span>DROID</span> : null}
          </span>
        )}
        <span className={`dx-title${showBack ? "" : ""}`}>{title}</span>
        {mode === "pro" ? <span className="dx-mode-chip">PRO</span> : null}
        <Link className="dx-iconbtn" href="/search" aria-label="Search securities and desks">
          ⌕
        </Link>
        <Link className="dx-iconbtn" href="/notifications" aria-label="Notifications">
          ♢
          {unread > 0 ? <span className="dx-dot" /> : null}
        </Link>
      </header>

      <div className="dx-body">
        {isTablet ? (
          <aside className="dx-rail" aria-label="Navigation rail">
            <nav className="dx-col" style={{ gap: 2 }}>
              {TABS.map((t) => (
                <Link
                  key={t.href}
                  href={t.href}
                  className="dx-row"
                  style={
                    pathname.startsWith(t.href)
                      ? { borderColor: "var(--dx-amber)", color: "var(--dx-amber)" }
                      : undefined
                  }
                >
                  <span aria-hidden>{t.ico}</span>
                  <span style={{ fontSize: 12.5, letterSpacing: "0.06em" }}>{t.label}</span>
                </Link>
              ))}
              <Link href="/more" className="dx-row">
                <span aria-hidden>☰</span>
                <span style={{ fontSize: 12.5, letterSpacing: "0.06em" }}>ALL DESKS</span>
              </Link>
              <Link href="/brief" className="dx-row">
                <span aria-hidden>☀</span>
                <span style={{ fontSize: 12.5, letterSpacing: "0.06em" }}>MORNING BRIEF</span>
              </Link>
            </nav>
            <div className="dx-h">RECENT DESKS</div>
            <nav className="dx-col" style={{ gap: 2 }}>
              {ALL_DESKS.slice(0, 6).map((d) => (
                <Link key={d.m.id} href={`/d/${d.m.id}`} className="dx-row" style={{ minHeight: 42 }}>
                  <span style={{ fontSize: 12 }}>{d.m.label}</span>
                  <span className="dx-right dx-fnc" style={{ fontSize: 10 }}>{d.code}</span>
                </Link>
              ))}
            </nav>
            <div className="dx-note">SWIPE CONTENT TO MOVE BETWEEN SECTIONS.</div>
          </aside>
        ) : null}

        <main className="dx-scroll dx-page">{children}</main>
      </div>

      <nav className="dx-nav" aria-label="Primary">
        {TABS.map((t) => {
          const on = pathname.startsWith(t.href);
          return (
            <Link key={t.href} href={t.href} className={on ? "dx-on" : ""} aria-current={on ? "page" : undefined}>
              <span className="dx-nav-ico" aria-hidden>
                {t.ico}
              </span>
              {t.label}
            </Link>
          );
        })}
      </nav>

      <RegisterSW />
      <InstallPrompt />
    </div>
  );
}
