/**
 * Where this app lives, for the handful of things that need an absolute URL:
 * canonical links, Open Graph, the sitemap and robots.
 *
 * Vercel hands the deployment's own host to the build as `VERCEL_URL` (no
 * scheme), and `VERCEL_PROJECT_PRODUCTION_URL` is the stable production one —
 * preferred, because a preview deployment must not publish canonicals
 * pointing at itself. `NEXT_PUBLIC_SITE_URL` overrides both for a custom
 * domain, and the fallback is the address this app has actually been at
 * since the first deploy.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prod) return `https://${prod}`;
  return "https://protrackive.vercel.app";
}

/** The one place the developer's own address is written down. */
export const AUTHOR = {
  name: "Abdullah Al Noman",
  url: "https://abdullah-al-noman.vercel.app/",
} as const;
