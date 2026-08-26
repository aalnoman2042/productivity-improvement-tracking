import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import ServiceWorker from "@/components/ServiceWorker";
import NativeShell from "@/components/NativeShell";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "PIT — Productivity Improvement Tracker",
  description:
    "Track sleep, study, work, workouts, food and habits — and watch the trends.",
  applicationName: "PIT",
  appleWebApp: {
    capable: true,
    title: "PIT",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#1c5cab",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

/**
 * Runs before the first paint so the saved theme is already applied — without
 * it the page would flash light before switching to dark.
 *
 * It stamps one more thing while it is here: whether this is the Android app
 * rather than a browser. That has to happen before paint for the same reason
 * the theme does. The server sends the same HTML to both, and that HTML
 * contains offers to install PIT — which, inside the installed app, would
 * flash on screen every launch until React hydrated and took them away
 * (`.hide-installed` in globals.css). The marker `PITApp` is put on the
 * WebView's user agent by `android.appendUserAgent` in `capacitor.config.ts`;
 * `lib/native.ts` is what everything else reads it through.
 */
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('pit_theme');
if(t==='dark'){document.documentElement.setAttribute('data-theme','dark');
var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content','#0d0d0d');}
}catch(e){}
try{if(navigator.userAgent.indexOf('PITApp')>=0){
document.documentElement.setAttribute('data-shell','native');}
}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // `suppressHydrationWarning` is here because THEME_SCRIPT deliberately sets
  // `data-theme` on <html> before React hydrates — the server's HTML and the
  // live DOM are *meant* to differ on this one element, and that's the whole
  // mechanism that stops the page flashing light before it goes dark. Without
  // it React reports the difference as a hydration error on every load. It
  // covers this element's own attributes only; nothing inside is affected.
  return (
    <html
      lang="en"
      className={`${geistSans.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        {/* Every screen puts a header, a logo, four tabs and three buttons
            before its content. Without this, reaching the page by keyboard
            means tabbing past all of it, on every navigation. Off-screen
            until focused, which is the only time it is any use. */}
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
        <ServiceWorker />
        <NativeShell />
        <Analytics />
      </body>
    </html>
  );
}
