import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./desk-pre.css";
import "./styles/guided.css";
import "../droid/styles/droid.css";
import AIChat from "@/components/AIChat";
import { ExplainProvider } from "@/components/Explain";
import { ExperienceProvider } from "./experiences/ExperienceProvider";

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

// The Guided experience provider wraps the whole app so `data-exp` / `data-theme`
// are set on <html> for the token layer, and so any surface (page or panel) can
// ask which experience the reader is in.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-exp="pro" data-theme="dark">
      <body>
        <ExperienceProvider>
          <ExplainProvider>{children}</ExplainProvider>
        </ExperienceProvider>
        <AIChat />
      </body>
    </html>
  );
}
