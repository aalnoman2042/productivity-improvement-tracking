import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PIT — Productivity Improvement Tracker",
    short_name: "PIT",
    description:
      "Track sleep, study, work, workouts, food and habits — and watch the trends.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // The milky base from globals.css — this is the colour a phone paints
    // while the app is opening, so it has to be the app's own page.
    background_color: "#f7f5f1",
    theme_color: "#1c5cab",
    categories: ["productivity", "health", "lifestyle"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "Log today", short_name: "Log", url: "/" },
      { name: "Dashboard", short_name: "Stats", url: "/dashboard" },
      { name: "History", short_name: "History", url: "/history" },
    ],
    // Regenerate with `node scripts/make-screenshots.mjs`. These upgrade
    // Chrome's install prompt from a bare dialog to the store-style sheet.
    screenshots: [
      {
        src: "/screenshot-log.png",
        sizes: "1080x1920",
        type: "image/png",
        form_factor: "narrow",
        label: "Log your whole day in taps",
      },
      {
        src: "/screenshot-stats.png",
        sizes: "1080x1920",
        type: "image/png",
        form_factor: "narrow",
        label: "Watch the trends",
      },
      {
        src: "/screenshot-wide.png",
        sizes: "1920x1080",
        type: "image/png",
        form_factor: "wide",
        label: "Your week, side by side",
      },
    ],
  };
}
