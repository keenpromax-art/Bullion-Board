import type { Metadata, Viewport } from "next";
import "./globals.css";
import "../droid/styles/droid.css";
import AIChat from "@/components/AIChat";
import { ExplainProvider } from "@/components/Explain";

// `viewportFit: "cover"` is what makes the env(safe-area-inset-*) values in
// globals.css resolve — without it they are all 0 and the Android gesture
// pill / notch eats the terminal status bar and function keys.
// No maximumScale: pinch-zoom stays available (accessibility).
export const viewport: Viewport = {
  themeColor: "#030304",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "Bullion Board — NSE Quant Terminal",
  description: "Bullion Board: NSE quant terminal — options strategy engine, fundamentals, AI chat.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><ExplainProvider>{children}</ExplainProvider><AIChat /></body>
    </html>
  );
}
