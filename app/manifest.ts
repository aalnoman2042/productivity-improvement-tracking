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
    background_color: "#f3f4f6",
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
      { name: "Log today", short_name: "Log", url: "/today" },
      { name: "Dashboard", short_name: "Stats", url: "/" },
    ],
  };
}
