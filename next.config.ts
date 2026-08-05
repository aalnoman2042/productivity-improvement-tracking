import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Pull in only the Recharts pieces each chart actually uses.
  experimental: {
    optimizePackageImports: ["recharts"],
  },
  // The screenshots on the welcome page change only with a redesign, so
  // their optimized renditions can sit at the edge for a month instead of
  // being re-derived for every fresh visitor.
  images: {
    minimumCacheTTL: 2_678_400,
  },
  // The service worker must never be cached, or a stale one keeps serving old
  // assets after a deploy. The icons, on the other hand, never change.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
      ...["/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"].map(
        (source) => ({
          source,
          headers: [
            {
              key: "Cache-Control",
              value: "public, max-age=31536000, immutable",
            },
          ],
        })
      ),
      // A day at the edge with a week's grace — fresh enough after a
      // redesign, cached enough that a returning visitor pays nothing.
      ...["/screenshot-log.png", "/screenshot-stats.png", "/screenshot-wide.png"].map(
        (source) => ({
          source,
          headers: [
            {
              key: "Cache-Control",
              value: "public, max-age=86400, stale-while-revalidate=604800",
            },
          ],
        })
      ),
    ];
  },
};

export default nextConfig;
