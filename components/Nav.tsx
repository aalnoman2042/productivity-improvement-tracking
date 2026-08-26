"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import InstallButton from "@/components/InstallButton";
import Logo from "@/components/Logo";
import SyncStatus from "@/components/SyncStatus";
import ThemeToggle from "@/components/ThemeToggle";

// Logging is a daily act and reading the charts is a weekly one, so the log
// is what the app opens on — including from the Home Screen icon. Status
// took History's slot: "how am I doing?" is the daily question, and the
// calendar is one tap away from Status for whoever wants the day-by-day.
// Exported so SwipeNav can walk the same tabs in the same order — a swipe
// and a tap must never disagree about what "next" means.
// The icons are for the phone's bottom bar, where four words in a row all
// look alike at a glance and a shape doesn't.
export const LINKS = [
  { href: "/", label: "Today", icon: "📝" },
  { href: "/dashboard", label: "Stats", icon: "📈" },
  { href: "/status", label: "Status", icon: "🧭" },
  { href: "/trackers", label: "Trackers", icon: "📋" },
];

// Reachable from the header on every screen, but kept out of the phone's
// bottom bar so the three main destinations stay wide.
const ACCOUNT = { href: "/settings", label: "Account" };

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const tabCls = (href: string) =>
    `-mb-px border-b-2 px-3 py-3.5 text-sm font-medium ${
      pathname === href
        ? "border-accent text-accent"
        : "border-transparent text-secondary hover:text-foreground"
    }`;

  return (
    <>
      <header className="app-header sticky top-0 z-20 border-b border-edge bg-surface/95 shadow-sm backdrop-blur-sm">
        <div className="page-width flex items-center gap-3 px-3 sm:gap-6 sm:px-4">
          <Link href="/" className="flex shrink-0 items-center gap-2 py-3">
            <Logo size={26} />
            <span className="text-brand-gradient text-lg font-bold tracking-tight">
              PIT
            </span>
          </Link>
          <nav className="hidden gap-2 self-stretch sm:flex">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={pathname === l.href ? "page" : undefined}
                className={tabCls(l.href)}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
            <SyncStatus />
            {/* Disappears once installed, so it costs the header nothing in
                the long run — but until then it's reachable from every
                screen, including the phone. */}
            <InstallButton />
            <ThemeToggle />
            {/* On a phone this is the way to the account page, where signing
                out is a full, clearly-labelled button. */}
            <Link
              href={ACCOUNT.href}
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm sm:px-3 ${
                pathname === ACCOUNT.href
                  ? "border-accent text-accent"
                  : "border-edge text-secondary hover:bg-surface-2"
              }`}
              title="Account, password and sign out"
            >
              <span aria-hidden="true">👤</span>
              {/* On the narrowest phones the word is what pushes this row out
                  of shape — `sr-only` drops it visually and keeps it spoken. */}
              <span className="max-[380px]:sr-only">{ACCOUNT.label}</span>
            </Link>
            <button
              onClick={signOut}
              className="hidden rounded-md border border-edge px-3 py-1.5 text-sm text-secondary hover:bg-surface-2 sm:block"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Bottom nav (mobile) — icon over label, with the active tab marked by
          a filled pill behind its icon rather than a hairline above it. A
          shape holds the eye at arm's length in a way a 2px border doesn't. */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 flex border-t border-edge bg-surface/95 shadow-[0_-1px_3px_rgba(0,0,0,0.06)] backdrop-blur-sm sm:hidden">
        {LINKS.map((l) => {
          const active = pathname === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className="flex flex-1 flex-col items-center gap-0.5 px-1 pt-1.5 pb-2"
            >
              <span
                aria-hidden="true"
                className={`flex h-7 w-14 items-center justify-center rounded-full text-base leading-none ${
                  active ? "bg-accent/15" : ""
                }`}
              >
                {l.icon}
              </span>
              <span
                className={`text-[11px] font-medium ${
                  active ? "text-accent" : "text-muted"
                }`}
              >
                {l.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
