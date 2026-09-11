import type { Metadata, Viewport } from "next";
import "./globals.css";
import AIChat from "@/components/AIChat";

export const viewport: Viewport = { themeColor: "#030304" };

export const metadata: Metadata = {
  title: "Bullion Board — NSE Quant Terminal",
  description: "Bullion Board: Bloomberg-style NSE terminal — quant desks, options strategy engine, fundamentals, AI chat.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}<AIChat /></body>
    </html>
  );
}
