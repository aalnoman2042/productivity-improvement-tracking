"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import InstallButton from "@/components/InstallButton";
import Logo from "@/components/Logo";
import SyncStatus from "@/components/SyncStatus";
import ThemeToggle from "@/components/ThemeToggle";

// Logging is a daily act and reading the charts is a weekly one, so the log
// is what the app opens on — including from the Home Screen icon. Status
// sits right after Stats: it's the "how am I doing?" answer, and burying it
// two taps deep under Account was wasting it.
const LINKS = [
  { href: "/", label: "Today" },
  { href: "/dashboard", label: "Stats" },
  { href: "/status", label: "Status" },
  { href: "/history", label: "History" },
  { href: "/trackers", label: "Trackers" },
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
      <header className="sticky top-0 z-20 border-b border-edge bg-surface/95 shadow-sm backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-3 sm:gap-6 sm:px-4">
          <Link href="/" className="flex shrink-0 items-center gap-2 py-3">
            <Logo size={26} />
            <span className="text-brand-gradient text-lg font-bold tracking-tight">
              PIT
            </span>
          </Link>
          <nav className="hidden gap-2 self-stretch sm:flex">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className={tabCls(l.href)}>
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
              <span>{ACCOUNT.label}</span>
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

      {/* Bottom nav (mobile) — five tabs now, so the type steps down a size
          to keep the longest label on one line on a small phone. */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 flex border-t border-edge bg-surface/95 shadow-[0_-1px_3px_rgba(0,0,0,0.06)] backdrop-blur-sm sm:hidden">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`min-w-0 flex-1 truncate border-t-2 px-0.5 py-3 text-center text-xs font-medium ${
              pathname === l.href
                ? "border-accent text-accent"
                : "border-transparent text-muted"
            }`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
