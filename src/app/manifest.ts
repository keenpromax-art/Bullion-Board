import type { MetadataRoute } from "next";

// PWA manifest (spec §9) — Bullion Droid installs as a standalone app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/home",
    name: "Bullion Droid — NSE Quant Terminal",
    short_name: "BULLION DROID",
    description:
      "Mobile companion to the Bullion Board NSE quant terminal: indices, watchlists, security research, option chain, alerts and AI.",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#030304",
    theme_color: "#030304",
    categories: ["finance", "productivity", "news"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/apple-180.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
