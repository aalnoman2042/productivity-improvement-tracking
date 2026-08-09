"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Logo from "@/components/Logo";
import PasswordInput from "@/components/PasswordInput";

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (password !== confirm) {
      setError("The two passwords don't match");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        router.replace("/");
        router.refresh();
      } else {
        setError(data?.error ?? "Could not reset your password");
      }
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <>
        <p className="rounded-md bg-accent-soft p-3 text-sm text-secondary">
          This reset link is incomplete. Request a new one.
        </p>
        <Link
          href="/forgot"
          className="mt-5 block rounded-lg bg-brand-gradient py-2.5 text-center font-medium text-white hover:brightness-110"
        >
          Request a new link
        </Link>
      </>
    );
  }

  return (
    <form onSubmit={submit}>
      <label className="mb-1 block text-sm font-medium">New password</label>
      <PasswordInput
        autoComplete="new-password"
        autoFocus
        minLength={8}
        value={password}
        onChange={setPassword}
      />
      <p className="mt-1 mb-4 text-xs text-muted">At least 8 characters.</p>

      <label className="mb-1 block text-sm font-medium">Confirm password</label>
      <PasswordInput
        autoComplete="new-password"
        minLength={8}
        value={confirm}
        onChange={setConfirm}
      />

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="mt-5 w-full rounded-lg bg-brand-gradient py-2.5 font-medium text-white hover:brightness-110 disabled:opacity-40"
      >
        {busy ? "Saving…" : "Set new password"}
      </button>
    </form>
  );
}

export default function ResetPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="animate-rise-in w-full max-w-sm rounded-xl border border-edge card p-8 shadow-md">
        <div className="mb-3 flex justify-center">
          <Logo size={52} />
        </div>
        <h1 className="text-brand-gradient text-center text-2xl font-bold tracking-tight">
          PIT
        </h1>
        <p className="mt-1 mb-6 text-center text-sm text-secondary">
          Choose a new password
        </p>
        <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
          <ResetForm />
        </Suspense>
      </div>
    </main>
  );
}
