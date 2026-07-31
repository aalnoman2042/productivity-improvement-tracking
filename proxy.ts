import { NextResponse, type NextRequest } from "next/server";
import { readSession, COOKIE_NAME } from "@/lib/auth";

const PUBLIC_PAGES = new Set(["/login", "/signup"]);

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const signedIn = Boolean(await readSession(req.cookies.get(COOKIE_NAME)?.value));

  if (pathname.startsWith("/api/auth/")) return NextResponse.next();

  if (PUBLIC_PAGES.has(pathname)) {
    if (signedIn) return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next();
  }

  if (!signedIn) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.svg$).*)"],
};
