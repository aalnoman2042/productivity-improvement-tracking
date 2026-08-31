import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/**
 * The three public pages. Deliberately not a list of everything the app can
 * render: a sitemap of pages that all redirect to /login is worse than no
 * sitemap at all.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  // Fixed rather than `new Date()`: this is a static export, so a build-time
  // clock would claim every page changed on every deploy.
  const lastModified = new Date("2026-09-01");
  return [
    { url: base, lastModified, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/signup`, lastModified, changeFrequency: "yearly", priority: 0.6 },
    { url: `${base}/login`, lastModified, changeFrequency: "yearly", priority: 0.4 },
  ];
}
