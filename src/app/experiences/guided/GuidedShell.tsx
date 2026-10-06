"use client";

// Guided shell — mobile-first, then tablet, then desktop.
//
// NAVIGATION DOES NOT MIRROR THE DESKTOP. A phone gets a bottom tab bar, a
// tablet gets the same bar (it is thumb-reachable), and only a desktop gets the
// top nav, because a top nav on a phone is a 56px strip of chrome above the
// fold that duplicates the tabs.
//
// The terminal's command bar and status bar are NOT rendered here — this is a
// different experience, and mixing the chrome is what makes a "beginner mode"
// look like a beginner mode. HYBRID adds the command bar back deliberately.

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useExperience } from "../ExperienceProvider";
import { CommandBar } from "@/components/TerminalChrome";

// Icon paths only — the SVG element is built once in `Glyph`, so the tab table
// stays plain data instead of holding 5 duplicated elements.
const I = {
  home: "M3 10.6 12 3l9 7.6",
  markets: "M3 17.5 9 11l4 4.2L21 6.5",
  star: "m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9z",
  book: "M4 5.5A1.5 1.5 0 0 1 5.5 4H19v14H5.5A1.5 1.5 0 0 0 4 19.5z",
  more: "M4 7h16M4 12h16M4 17h16",
};

function Glyph({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

const TABS = [
  { href: "/g", label: "Home", icon: I.home },
  { href: "/g/markets", label: "Markets", icon: I.markets },
  { href: "/g/watchlist", label: "Watchlist", icon: I.star },
  { href: "/g/portfolio", label: "Portfolio", icon: I.book },
  { href: "/g/more", label: "More", icon: I.more },
];

const TOPNAV = [
  { href: "/g", label: "Home" },
  { href: "/g/markets", label: "Markets" },
  { href: "/g/watchlist", label: "Watchlist" },
  { href: "/g/portfolio", label: "Portfolio" },
  { href: "/g/macro", label: "Macro" },
  { href: "/g/options", label: "Options" },
  { href: "/g/more", label: "More" },
];

export default function GuidedShell({
  children, title, ticker = "",
}: { children: ReactNode; title?: string; ticker?: string }) {
  const pathname = usePathname();
  const { experience, resolved, isPhone, setTheme } = useExperience();
  const hybrid = experience === "hybrid";

  const on = (href: string) =>
    href === "/g" ? pathname === "/g" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="gx" data-hybrid={hybrid ? "true" : undefined}>
      {hybrid && <CommandBar ticker={ticker} onTicker={() => {}} />}

      <header className="gx-top">
        <div className="gx-brand">
          <span className="gx-brand-mark">Bullion<span>Board</span></span>
          <span className="gx-brand-sub">{title ?? "Markets"}</span>
        </div>

        <nav className="gx-topnav" aria-label="Sections">
          {TOPNAV.map((t) => (
            <Link key={t.href} href={t.href} data-on={on(t.href)}>{t.label}</Link>
          ))}
        </nav>

        <span className="gx-top-spacer" />

        <button
          className="gx-iconbtn"
          onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
          aria-label={`Switch to ${resolved === "dark" ? "light" : "dark"} appearance`}
          title={`Appearance: ${resolved}`}
        >
          {resolved === "dark" ? (
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
              <circle cx="12" cy="12" r="4.2" />
              <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2z" />
            </svg>
          )}
        </button>

        <Link className="gx-iconbtn" href="/g/search" aria-label="Search" title="Search">
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
            <circle cx="10.8" cy="10.8" r="6.4" /><path d="m15.6 15.6 4 4" />
          </svg>
        </Link>
      </header>

      <main className="gx-main">{children}</main>

      <footer className="gx-foot">
        Bullion Board · data from public price feeds. For study and education only — not investment advice.
        {" "}<Link href="/g/more">Settings</Link> · <Link href="/terminal">Open the Pro terminal</Link>
        {isPhone ? "" : " · The Pro terminal is the dense, function-driven workspace."}
      </footer>

      <nav className="gx-tabs" aria-label="Primary">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className="gx-tab" aria-current={on(t.href) ? "page" : undefined}>
            <Glyph d={t.icon} />
            <span>{t.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}