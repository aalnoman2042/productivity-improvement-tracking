import { NextResponse, type NextRequest } from "next/server";
import { readSession, COOKIE_NAME } from "@/lib/auth";

const PUBLIC_PAGES = new Set(["/login", "/signup", "/forgot", "/reset"]);

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // The daily log used to live at /today and is now the home page. Push
  // notifications sitting unread in a tray still point at the old address,
  // as do bookmarks and any page a service worker cached — so it keeps
  // working, query string and all.
  if (pathname === "/today") {
    const to = new URL("/", req.url);
    to.search = req.nextUrl.search;
    return NextResponse.redirect(to);
  }

  // The pitch used to live at /welcome and is now the home page itself. The
  // old address forwards to the root, where signed-out visitors get the
  // pitch (rewritten below) and signed-in ones get the log.
  if (pathname === "/welcome") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  // Signature and expiry only — the password-stamp check needs the database,
  // which the edge runtime doesn't have. Data routes re-check via
  // `currentUserId`, so a revoked session gets a page shell and nothing else.
  const signedIn = Boolean(await readSession(req.cookies.get(COOKIE_NAME)?.value));

  if (pathname.startsWith("/api/auth/")) return NextResponse.next();

  // The nightly reminder job arrives with no cookie — it proves itself with
  // CRON_SECRET inside the route instead.
  if (pathname.startsWith("/api/cron/")) return NextResponse.next();

  if (PUBLIC_PAGES.has(pathname)) {
    // A signed-in visitor following a reset link should still be able to use
    // it — everything else bounces to the dashboard.
    if (signedIn && pathname !== "/reset") {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  if (!signedIn) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // The front door for strangers is the pitch, not a bare sign-in form —
    // served at the root itself, no redirect. Deep links (a day, the
    // dashboard) still land on login and bounce back.
    if (pathname === "/") {
      return NextResponse.rewrite(new URL("/welcome", req.url));
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  // The manifest, service worker and icons must stay reachable while signed
  // out, or the browser can't offer to install the app.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
