import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/**
 * What a crawler may read.
 *
 * Everything behind the login is disallowed — not for secrecy (it is all
 * 307ing to /login anyway) but because a crawler spending its budget on
 * thirty redirects is a crawler not reading the one page that is actually
 * for it. The pitch, the sign-in and the sign-up are the whole public
 * surface of this app.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/welcome", "/login", "/signup"],
        disallow: [
          "/api/",
          "/dashboard",
          "/status",
          "/history",
          "/trackers",
          "/tracker/",
          "/settings",
          "/catchup",
          "/awards",
          "/admin",
          "/cortisol",
          "/start",
          "/reset",
          "/forgot",
        ],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
