import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import ServiceWorker from "@/components/ServiceWorker";
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
 */
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('pit_theme');
if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}
var d=t==='dark'||((!t||t==='system')&&matchMedia('(prefers-color-scheme: dark)').matches);
if(d){var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content','#0d0d0d');}
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
        {children}
        <ServiceWorker />
        <Analytics />
      </body>
    </html>
  );
}
