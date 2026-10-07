import type { Metadata, Viewport } from "next";
import DroidShell from "@/droid/shell/DroidShell";

export const metadata: Metadata = {
  title: "Bullion Droid",
  description:
    "Bullion Droid — mobile-first companion to the Bullion Board NSE quant terminal. Indices, watchlists, security research, option chain and AI, on a phone.",
  applicationName: "Bullion Droid",
  manifest: "/manifest",
};

export const viewport: Viewport = {
  /* `var(--bg)` was here, which is not a colour the UA can resolve — a meta
     theme-color takes a literal, so the tag was invalid and the browser fell
     back to its own default until ExperienceProvider overwrote it after
     hydration. That left the one frame the light-theme boot script exists to
     protect (no black flash before first paint) with no theme colour at all on
     the phone surface.

     A single literal, not the media-query array: with two tags the browser
     picks the FIRST one whose media query matches, but
     ExperienceProvider.querySelector("meta[name=theme-color]") only ever
     updates the first tag — so an OS-light/app-dark pairing would keep showing
     the OS colour. One tag is correct here, and the provider repoints it to the
     in-app theme (--bg dark, --chrome light) as soon as React mounts.

     The manifest's own theme_color/background_color are left at #030304 for the
     same structural reason: manifest colours are static JSON with no media
     support and no runtime handle, so they cannot follow an in-app toggle. */
  themeColor: "#030304",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function DroidLayout({ children }: { children: React.ReactNode }) {
  return <DroidShell>{children}</DroidShell>;
}
