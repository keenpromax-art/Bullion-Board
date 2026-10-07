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
  themeColor: "var(--bg)",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function DroidLayout({ children }: { children: React.ReactNode }) {
  return <DroidShell>{children}</DroidShell>;
}
