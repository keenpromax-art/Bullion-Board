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

/**
 * Resolve the theme BEFORE first paint.
 *
 * The provider only reads localStorage in an effect, so without this every
 * reader who chose light gets a full frame of terminal black first and then a
 * flash to white — on a trading terminal, where a reader glances at the screen
 * mid-session, that flash is genuinely uncomfortable rather than cosmetic. This
 * runs synchronously in <head>, before the body exists, and only ever writes one
 * attribute plus the browser-chrome colour.
 *
 * Kept deliberately tiny and defensive: it duplicates the provider's key and
 * resolution rule, so the two must agree. `system` resolves against the same
 * media query the provider uses. If anything throws — private mode, storage
 * blocked, an older browser — the `dark` fallback matches the server-rendered
 * attribute and the page simply stays on its default theme.
 */
const THEME_BOOT = `(function(){try{
var k="bb.experience.theme.v1",v=JSON.parse(localStorage.getItem(k));
if(v!=="light"&&v!=="dark"&&v!=="system")return;
var r=v==="system"?(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):v;
var d=document.documentElement;d.dataset.theme=r;
var m=document.querySelector('meta[name="theme-color"]');
if(m)m.setAttribute("content",r==="dark"?"#030304":"#e9e9e6");
}catch(e){}})();`;

// The Guided experience provider wraps the whole app so `data-exp` / `data-theme`
// are set on <html> for the token layer, and so any surface (page or panel) can
// ask which experience the reader is in.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-exp="pro" data-theme="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <ExperienceProvider>
          <ExplainProvider>{children}</ExplainProvider>
        </ExperienceProvider>
        <AIChat />
      </body>
    </html>
  );
}
