import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Pull in only the Recharts pieces each chart actually uses.
  experimental: {
    optimizePackageImports: ["recharts"],
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
    ];
  },
};

export default nextConfig;
