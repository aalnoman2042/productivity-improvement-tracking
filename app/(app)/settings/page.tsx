"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Footer from "@/components/Footer";
import PasswordInput from "@/components/PasswordInput";
import ReminderSettings from "@/components/ReminderSettings";
import { toDateStr } from "@/lib/dates";
import { buildInsights, type InsightLevel } from "@/lib/insights";
import type { Stats } from "@/lib/stats";
import { useCached } from "@/lib/useCached";
import { APP_VERSION } from "@/lib/version";

type Me = { id: string; name: string; email: string };

const LEVEL: Record<
  InsightLevel,
  { icon: string; label: string; ring: string; text: string }
> = {
  bad: {
    icon: "⚠️",
    label: "Needs attention",
    ring: "border-red-600/40 bg-red-600/5",
    text: "text-red-600",
  },
  warn: {
    icon: "⚡",
    label: "Worth a look",
    ring: "border-amber-600/40 bg-amber-600/5",
    text: "text-amber-700 dark:text-amber-500",
  },
  good: {
    icon: "✓",
    label: "Going well",
    ring: "border-green-700/40 bg-green-700/5",
    text: "text-green-700 dark:text-green-500",
  },
};

const field =
  "w-full rounded-md border border-edge bg-transparent px-3 py-2 outline-none focus:border-accent";

function Note({ kind, children }: { kind: "ok" | "bad"; children: React.ReactNode }) {
  return (
    <p
      className={`animate-fade-in text-sm font-medium ${
        kind === "ok" ? "text-green-700 dark:text-green-500" : "text-red-600"
      }`}
    >
      {children}
    </p>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const [name, setName] = useState("");
  const [profileMsg, setProfileMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwMsg, setPwMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [savingPw, setSavingPw] = useState(false);

  // Same request and same cache the dashboard uses, so this costs nothing
  // extra if you've just come from there.
  const statsQ = useCached<Stats>(
    `/api/stats?period=month&today=${toDateStr(new Date())}`,
    "stats:month"
  );
  const insights = useMemo(() => buildInsights(statsQ.data), [statsQ.data]);
  const needsAttention = insights.filter((i) => i.level !== "good").length;

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((u: Me) => {
        setMe(u);
        setName(u.name);
      })
      .catch(() => location.assign("/login"));
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setProfileMsg(null);
    const res = await fetch("/api/auth/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => null);
    setSavingProfile(false);
    if (res.ok) {
      setProfileMsg({ kind: "ok", text: "Profile updated" });
      setMe((m) => (m ? { ...m, name } : m));
    } else {
      setProfileMsg({ kind: "bad", text: data?.error ?? "Could not save" });
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (next !== confirm) {
      setPwMsg({ kind: "bad", text: "The two new passwords don't match" });
      return;
    }
    setSavingPw(true);
    const res = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current, next }),
    });
    const data = await res.json().catch(() => null);
    setSavingPw(false);
    if (res.ok) {
      setPwMsg({ kind: "ok", text: "Password changed" });
      setCurrent("");
      setNext("");
      setConfirm("");
    } else {
      setPwMsg({ kind: "bad", text: data?.error ?? "Could not change password" });
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Account</h1>
        <p className="mt-1 text-sm text-secondary">
          Your details and password. Your tracked data is never shared with
          other accounts.
        </p>
      </div>

      {/* The one-tap answer to "how am I doing?" — kept above the forms
          because it's the thing worth opening daily. */}
      <Link
        href="/status"
        className="animate-rise-in flex items-center justify-between gap-3 rounded-lg border border-accent/40 card p-4 shadow-sm hover:bg-surface-2"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="text-xl" aria-hidden="true">
            📊
          </span>
          <span className="min-w-0">
            <span className="block font-semibold">Your status</span>
            <span className="block text-sm text-secondary">
              Wins, misses and what to fix first — over a week, two weeks or a
              month.
            </span>
          </span>
        </span>
        <span className="shrink-0 text-accent" aria-hidden="true">
          →
        </span>
      </Link>

      {me === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <>
          <form
            onSubmit={saveProfile}
            className="animate-rise-in space-y-4 rounded-lg border border-edge card p-4 shadow-sm"
          >
            <h2 className="font-semibold">Profile</h2>
            <div>
              <label className="mb-1 block text-sm font-medium">Your name</label>
              <input
                required
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={field}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Email</label>
              <input
                type="email"
                value={me.email}
                readOnly
                disabled
                className={`${field} cursor-not-allowed bg-surface-2 text-secondary`}
              />
              <p className="mt-1 text-xs text-muted">
                🔒 You sign in with this address and it can&apos;t be changed
                after sign-up.
              </p>
            </div>
            {profileMsg && <Note kind={profileMsg.kind}>{profileMsg.text}</Note>}
            <button
              type="submit"
              disabled={savingProfile || name === me.name}
              className="rounded-md bg-brand-gradient px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
            >
              {savingProfile ? "Saving…" : "Save profile"}
            </button>
          </form>

          <section className="animate-rise-in rounded-lg border border-edge card p-4 shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">How your last 30 days look</h2>
              {statsQ.data && (
                <span className="text-xs text-muted">
                  {statsQ.data.daysLogged} of {statsQ.data.days} days logged
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-secondary">
              Read straight off what you logged — sleep, namaz, streaks and the
              goals you set yourself.
            </p>

            {statsQ.loading ? (
              <div className="mt-4 space-y-2" aria-hidden="true">
                <div className="skeleton h-16 rounded-md" />
                <div className="skeleton h-16 rounded-md" />
              </div>
            ) : insights.length === 0 ? (
              <p className="mt-4 text-sm text-muted">
                Not enough logged yet to say anything useful.{" "}
                <Link href="/" className="font-medium text-accent underline">
                  Log a few days
                </Link>{" "}
                and this fills in.
              </p>
            ) : (
              <>
                <p className="mt-3 text-sm font-medium">
                  {needsAttention === 0
                    ? "Nothing looks off this month."
                    : `${needsAttention} thing${needsAttention === 1 ? "" : "s"} worth your attention.`}
                </p>
                <ul className="mt-3 space-y-2">
                  {insights.map((insight, i) => {
                    const look = LEVEL[insight.level];
                    return (
                      <li
                        key={`${insight.level}-${i}`}
                        className={`rounded-md border p-3 ${look.ring}`}
                      >
                        <div className="flex items-start gap-2">
                          <span aria-hidden="true">{look.icon}</span>
                          <div className="min-w-0">
                            <p className={`text-sm font-semibold ${look.text}`}>
                              {insight.title}
                            </p>
                            <p className="mt-0.5 text-sm text-secondary">
                              {insight.detail}
                            </p>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>

          <ReminderSettings />

          <form
            onSubmit={changePassword}
            className="animate-rise-in space-y-4 rounded-lg border border-edge card p-4 shadow-sm"
          >
            <h2 className="font-semibold">Change password</h2>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Current password
              </label>
              <PasswordInput
                autoComplete="current-password"
                value={current}
                onChange={setCurrent}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">New password</label>
              <PasswordInput
                autoComplete="new-password"
                minLength={8}
                value={next}
                onChange={setNext}
              />
              <p className="mt-1 text-xs text-muted">At least 8 characters.</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Confirm new password
              </label>
              <PasswordInput
                autoComplete="new-password"
                minLength={8}
                value={confirm}
                onChange={setConfirm}
              />
            </div>
            {pwMsg && <Note kind={pwMsg.kind}>{pwMsg.text}</Note>}
            <button
              type="submit"
              disabled={savingPw || !current || !next}
              className="rounded-md bg-brand-gradient px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
            >
              {savingPw ? "Changing…" : "Change password"}
            </button>
          </form>

          <section className="animate-rise-in rounded-lg border border-edge card p-4 shadow-sm">
            <h2 className="font-semibold">Your data</h2>
            <p className="mt-1 text-sm text-secondary">
              Everything you&apos;ve logged, in a file that&apos;s yours to
              keep. CSV opens in Excel or Google Sheets, one row per entry;
              JSON is a complete backup of your trackers and history.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href="/api/export?format=csv"
                className="rounded-md bg-brand-gradient px-4 py-2 text-sm font-medium text-white hover:brightness-110"
              >
                Download CSV
              </a>
              <a
                href="/api/export?format=json"
                className="rounded-md border border-edge px-4 py-2 text-sm text-secondary hover:bg-surface-2"
              >
                Download JSON
              </a>
            </div>
          </section>

          <section className="animate-rise-in rounded-lg border border-edge card p-4 shadow-sm">
            <h2 className="font-semibold">Sign out</h2>
            <p className="mt-1 mb-4 text-sm text-secondary">
              You&apos;ll need your email and password to get back in. Anything
              saved on this device while offline syncs first.
            </p>
            <button
              onClick={async () => {
                setSigningOut(true);
                await fetch("/api/auth/logout", { method: "POST" });
                router.replace("/login");
                router.refresh();
              }}
              disabled={signingOut}
              className="w-full rounded-md border border-red-600 px-4 py-2.5 font-medium text-red-600 hover:bg-red-600 hover:text-white disabled:opacity-40 sm:w-auto"
            >
              {signingOut ? "Signing out…" : "Sign out of PIT"}
            </button>
          </section>

          <section className="animate-rise-in rounded-lg border border-edge card p-4 shadow-sm">
            <h2 className="font-semibold">About</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-secondary">App</dt>
                <dd className="font-medium">
                  PIT — Productivity Improvement Tracker
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-secondary">Version</dt>
                <dd className="font-medium tabular-nums">{APP_VERSION}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-secondary">Built by</dt>
                <dd className="font-medium">Rohan</dd>
              </div>
            </dl>
          </section>

          <Footer className="pb-2" />
        </>
      )}
    </div>
  );
}
