"use client";

import { useState } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) setSent(true);
      else setError(data?.error ?? "Could not send the reset link");
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="animate-rise-in w-full max-w-sm rounded-lg border border-edge card p-8 shadow-md">
        <div className="mb-3 flex justify-center">
          <Logo size={52} />
        </div>
        <h1 className="text-brand-gradient text-center text-2xl font-bold tracking-tight">
          PIT
        </h1>
        <p className="mt-1 mb-6 text-center text-sm text-secondary">
          Forgot your password?
        </p>

        {sent ? (
          <>
            <p className="rounded-md bg-accent-soft p-3 text-sm text-secondary">
              If that email has an account, a reset link is on its way. It
              expires in one hour — check your spam folder if it doesn&apos;t
              arrive.
            </p>
            <Link
              href="/login"
              className="mt-5 block rounded-md bg-brand-gradient py-2.5 text-center font-medium text-white hover:brightness-110"
            >
              Back to sign in
            </Link>
          </>
        ) : (
          <form onSubmit={submit}>
            <label className="mb-1 block text-sm font-medium">
              Your account email
            </label>
            <input
              type="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-edge bg-transparent px-3 py-2 outline-none focus:border-accent"
            />
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="mt-5 w-full rounded-md bg-brand-gradient py-2.5 font-medium text-white hover:brightness-110 disabled:opacity-40"
            >
              {busy ? "Sending…" : "Send reset link"}
            </button>
            <p className="mt-5 text-center text-sm text-secondary">
              Remembered it?{" "}
              <Link href="/login" className="font-medium text-accent underline">
                Sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
