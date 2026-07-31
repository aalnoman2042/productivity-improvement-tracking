"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import SyncStatus from "@/components/SyncStatus";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/today", label: "Today" },
  { href: "/trackers", label: "Trackers" },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [name, setName] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((u) => u?.name && setName(u.name))
      .catch(() => {});
  }, []);

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
      <header className="sticky top-0 z-20 border-b border-edge bg-surface shadow-sm">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-6 px-4">
          <Link href="/" className="flex items-center gap-2 py-3">
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
          <div className="ml-auto flex items-center gap-2">
            <SyncStatus />
            {name && (
              <span className="hidden text-sm text-secondary sm:inline">
                {name}
              </span>
            )}
            <button
              onClick={signOut}
              className="rounded-md border border-edge px-3 py-1.5 text-sm text-secondary hover:bg-background"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Bottom nav (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-edge bg-surface shadow-[0_-1px_3px_rgba(0,0,0,0.06)] sm:hidden">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`flex-1 border-t-2 py-3 text-center text-sm font-medium ${
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
