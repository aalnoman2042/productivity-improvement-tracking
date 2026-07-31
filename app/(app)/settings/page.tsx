"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { APP_VERSION } from "@/lib/version";

type Me = { id: string; name: string; email: string };

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
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Account</h1>
        <p className="mt-1 text-sm text-secondary">
          Your details and password. Your tracked data is never shared with
          other accounts.
        </p>
      </div>

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

          <form
            onSubmit={changePassword}
            className="animate-rise-in space-y-4 rounded-lg border border-edge card p-4 shadow-sm"
          >
            <h2 className="font-semibold">Change password</h2>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Current password
              </label>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                className={field}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">New password</label>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                className={field}
              />
              <p className="mt-1 text-xs text-muted">At least 8 characters.</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Confirm new password
              </label>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={field}
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
        </>
      )}
    </div>
  );
}
