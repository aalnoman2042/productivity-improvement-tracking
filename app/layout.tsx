import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import ServiceWorker from "@/components/ServiceWorker";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
  // Keeps the app from zooming when you tap a number field on a phone.
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
