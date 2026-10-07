// Experience registry — which face of Bullion Board the reader gets, and which
// design tokens that face reads.
//
// THREE EXPERIENCES, ONE ENGINE.
//   guided — modern, visual, mobile-first, insight-driven. Soft surfaces, large
//            numbers, generous radii, a restrained accent. Answers "what is
//            happening?"
//   hybrid — modern navigation and cards with the Pro command bar and full
//            metrics available underneath. Answers "what is happening AND what
//            can I do?"
//   pro    — the terminal. Unchanged: IBM Plex Mono, near-black, 2-4px radii,
//            function codes, keyboard-driven. Answers "what can I do?"
//
// The switch changes NAVIGATION, TYPOGRAPHY, DENSITY, CARDS, CHARTS, LABELS AND
// INTERACTION — not a dark/light toggle. Same data, same API routes, same
// numbers underneath both faces.
//
// CRITICAL RULE: the Pro tokens in globals.css are NEVER mutated. Guided reads
// its own `--g-*` tokens, defined once in `styles/guided.css` and scoped to
// `[data-exp="guided"]` / `[data-exp="hybrid"]`. A guided stylesheet that
// rewrote `--mono` or `--bg` would silently restyle every terminal desk on the
// product, which is precisely the failure mode the token split exists to stop.

"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type Experience = "guided" | "hybrid" | "pro";
export type Theme = "light" | "dark" | "system";

export const EXPERIENCES: Array<{
  key: Experience;
  name: string;
  tagline: string;
  detail: string;
}> = [
  {
    key: "guided",
    name: "Guided",
    tagline: "Visual, plain-spoken",
    detail:
      "Mobile-first and modern. Large numbers, clear direction, plain English, and a market map instead of tables. Built for understanding what is moving and why — everything deeper is one tap away.",
  },
  {
    key: "hybrid",
    name: "Hybrid",
    tagline: "Modern shell, analyst depth",
    detail:
      "The modern cards and navigation with the terminal command bar and full metrics kept in reach. Built for people who want the approachable surface and the professional instrument without switching.",
  },
  {
    key: "pro",
    name: "Pro",
    tagline: "The terminal",
    detail:
      "The full NSE quant terminal: 116 function codes, workspace panels, keyboard-driven analysis, the complete desk set. Dense by design and unchanged by the Guided work.",
  },
];

export const THEME_OPTIONS: Array<{ key: Theme; label: string }> = [
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
  { key: "system", label: "System" },
];

export const EXPERIENCE_KEY = "bb.experience.v1";
export const THEME_KEY = "bb.experience.theme.v1";

export function isExperience(v: unknown): v is Experience {
  return v === "guided" || v === "hybrid" || v === "pro";
}
export function isTheme(v: unknown): v is Theme {
  return v === "light" || v === "dark" || v === "system";
}

/** Surface-form controls that the Guided face does not use. */
export const GUIDED_SURFACES = ["/g", "/g/markets", "/g/watchlist", "/g/portfolio", "/g/more", "/g/macro", "/g/options"];

export function isGuidedSurface(pathname: string): boolean {
  return pathname === "/g" || pathname.startsWith("/g/");
}

interface ExperienceCtx {
  experience: Experience;
  theme: Theme;
  /** Resolved theme after `system` is applied against the OS preference. */
  resolved: "light" | "dark";
  /** True when the reader is on a phone-width viewport. */
  isPhone: boolean;
  setExperience: (e: Experience) => void;
  setTheme: (t: Theme) => void;
}

const Ctx = createContext<ExperienceCtx | null>(null);

function readLS<T>(key: string, ok: (v: unknown) => v is T, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return ok(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota — the preference simply does not persist */
  }
}

export function ExperienceProvider({ children }: { children: ReactNode }) {
  // Server render must match the first client render, so both start at the
  // neutral default and resolve from storage in an effect.
  const [experience, setExperienceState] = useState<Experience>("pro");
  const [theme, setThemeState] = useState<Theme>("dark");
  const [systemDark, setSystemDark] = useState(true);
  const [isPhone, setIsPhone] = useState(false);

  useEffect(() => {
    setExperienceState(readLS(EXPERIENCE_KEY, isExperience, "pro"));
    setThemeState(readLS(THEME_KEY, isTheme, "dark"));
    if (typeof window.matchMedia === "function") {
      const mq = window.matchMedia("(max-width: 767px)");
      const apply = () => {
        setSystemDark(!window.matchMedia("(prefers-color-scheme: light)").matches);
        setIsPhone(mq.matches);
      };
      apply();
      mq.addEventListener("change", apply);
      const dark = window.matchMedia("(prefers-color-scheme: light)");
      dark.addEventListener("change", apply);
      return () => {
        mq.removeEventListener("change", apply);
        dark.removeEventListener("change", apply);
      };
    }
  }, []);

  const setExperience = useCallback((e: Experience) => {
    setExperienceState(e);
    writeLS(EXPERIENCE_KEY, e);
    // The document attribute is what scopes every guided token in the
    // stylesheet, so it must follow immediately — not on the next render.
    if (typeof document !== "undefined") document.documentElement.dataset.exp = e;
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    writeLS(THEME_KEY, t);
  }, []);

  const resolved: "light" | "dark" = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.exp = experience;
    document.documentElement.dataset.theme = resolved;
    // The browser chrome should follow the resolved theme. These two values are
    // the terminal's own --bg, and they MUST match the boot script in layout.tsx
    // or the status-bar tint changes on hydration — which is the one frame the
    // reader sees the flash we worked to remove.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", resolved === "dark" ? "#030304" : "#e9e9e6");
  }, [experience, resolved]);

  const value = useMemo<ExperienceCtx>(
    () => ({ experience, theme, resolved, isPhone, setExperience, setTheme }),
    [experience, theme, resolved, isPhone, setExperience, setTheme]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Use inside a client component. Falls back to Pro/neutral if no provider. */
export function useExperience(): ExperienceCtx {
  return (
    useContext(Ctx) ?? {
      experience: "pro",
      theme: "dark",
      resolved: "dark",
      isPhone: false,
      setExperience: () => {},
      setTheme: () => {},
    }
  );
}