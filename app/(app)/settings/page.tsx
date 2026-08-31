"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Footer from "@/components/Footer";
import ImportBackup from "@/components/ImportBackup";
import PasswordInput from "@/components/PasswordInput";
import ReminderSettings from "@/components/ReminderSettings";
import TimeValueSettings from "@/components/TimeValueSettings";
import CardBoundary from "@/components/CardBoundary";
import DeleteAccount from "@/components/DeleteAccount";
import { APP_VERSION } from "@/lib/version";

type Me = { id: string; name: string; email: string; admin?: boolean };

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
    <div className="card-stack">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Account</h1>
        <p className="mt-1 text-sm text-secondary">
          Your details and password. Your tracked data is never shared with
          other accounts.
        </p>
      </div>

      {/* History left the bottom bar when Status took its slot, so it keeps
          a doorway here as well as the one at the top of Status. */}
      <Link
        href="/history"
        className="animate-rise-in flex items-center justify-between gap-3 rounded-xl border border-edge card p-4 shadow-sm hover:bg-surface-2"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="text-xl" aria-hidden="true">
            📅
          </span>
          <span className="min-w-0">
            <span className="block font-semibold">History</span>
            <span className="block text-sm text-secondary">
              The month calendar — every day you logged, and every gap.
            </span>
          </span>
        </span>
        <span className="shrink-0 text-accent" aria-hidden="true">
          →
        </span>
      </Link>

      {/* Only the emails in ADMIN_EMAILS ever see this doorway — everyone
          else's Account page is unchanged, and the API behind it re-checks. */}
      {me?.admin && (
        <Link
          href="/admin"
          className="animate-rise-in flex items-center justify-between gap-3 rounded-xl border border-edge card p-4 shadow-sm hover:bg-surface-2"
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="text-xl" aria-hidden="true">
              🛡️
            </span>
            <span className="min-w-0">
              <span className="block font-semibold">Admin</span>
              <span className="block text-sm text-secondary">
                Every account, counted — users, trackers, logged days.
              </span>
            </span>
          </span>
          <span className="shrink-0 text-accent" aria-hidden="true">
            →
          </span>
        </Link>
      )}

      {me === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <>
          <form
            onSubmit={saveProfile}
            className="animate-rise-in space-y-4 rounded-xl border border-edge card p-4 shadow-sm"
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
              className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
            >
              {savingProfile ? "Saving…" : "Save profile"}
            </button>
          </form>

          {/* The 30-day read used to live here; it belongs to /status now,
              which is in the nav — Account is back to being about the
              account. */}
          <ReminderSettings />

          {/* One number, and the Stats page prices every tracked hour with
              it. Fenced: a card about money must not be able to take the
              password form down with it. */}
          <CardBoundary
            title="⏳ The price of an hour"
            message="Couldn't load this setting. Everything else on this page is unaffected."
          >
            <TimeValueSettings />
          </CardBoundary>

          <form
            onSubmit={changePassword}
            className="animate-rise-in space-y-4 rounded-xl border border-edge card p-4 shadow-sm"
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
              className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
            >
              {savingPw ? "Changing…" : "Change password"}
            </button>
          </form>

          <section className="animate-rise-in rounded-xl border border-edge card p-4 shadow-sm">
            <h2 className="font-semibold">Your data</h2>
            <p className="mt-1 text-sm text-secondary">
              Everything you&apos;ve logged, in a file that&apos;s yours to
              keep. CSV opens in Excel or Google Sheets, one row per entry;
              JSON is a complete backup of your trackers and history.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href="/api/export?format=csv"
                className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white hover:brightness-110"
              >
                Download CSV
              </a>
              <a
                href="/api/export?format=json"
                className="rounded-lg border border-edge px-4 py-2 text-sm text-secondary hover:bg-surface-2"
              >
                Download JSON
              </a>
            </div>
            <ImportBackup />
          </section>

          <section className="animate-rise-in rounded-xl border border-edge card p-4 shadow-sm">
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

          {/* The way out. Last in the column on purpose — nobody arrives on
              this page looking for it, and the one person who is looking
              will scroll. */}
          <DeleteAccount />

          <section className="animate-rise-in rounded-xl border border-edge card p-4 shadow-sm">
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
                <dd className="font-medium">
                  <a
                    href="https://abdullah-al-noman.vercel.app/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline-offset-2 hover:underline"
                  >
                    Abdullah Al Noman
                  </a>
                </dd>
              </div>
            </dl>

            {/* The signup tour, on demand — it's the only explanation of how
                the pieces fit together, and it shouldn't be a one-time thing
                you had to read while impatient to get started. */}
            <Link
              href="/start"
              className="mt-4 inline-flex rounded-lg border border-edge px-4 py-2 text-sm font-medium text-secondary hover:bg-surface-2"
            >
              How PIT works
            </Link>
          </section>

          <Footer className="pb-2" />
        </>
      )}
    </div>
  );
}
