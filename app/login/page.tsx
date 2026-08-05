"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import InstallButton from "@/components/InstallButton";
import Logo from "@/components/Logo";
import PasswordInput from "@/components/PasswordInput";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        router.replace("/");
        router.refresh();
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Could not sign in");
      }
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
      {/* The reason this app exists, said before the form asks anything. */}
      <p className="animate-fade-in text-center text-sm font-semibold tracking-wide text-secondary">
        Giving up is not in your blood.
      </p>
      <form
        onSubmit={submit}
        className="animate-rise-in w-full max-w-sm rounded-lg border border-edge card p-8 shadow-md"
      >
        <div className="mb-3 flex justify-center">
          <Logo size={52} />
        </div>
        <h1 className="text-brand-gradient text-center text-2xl font-bold tracking-tight">
          PIT
        </h1>
        <p className="mt-1 mb-6 text-center text-sm text-secondary">
          Sign in to your tracker
        </p>

        <label className="mb-1 block text-sm font-medium">Email</label>
        <input
          type="email"
          autoComplete="email"
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded-md border border-edge bg-transparent px-3 py-2 outline-none focus:border-accent"
        />

        <label className="mb-1 block text-sm font-medium">Password</label>
        <PasswordInput
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
        />

        <div className="mt-2 text-right">
          <Link href="/forgot" className="text-sm text-accent hover:underline">
            Forgot password?
          </Link>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="mt-5 w-full rounded-md bg-brand-gradient py-2.5 font-medium text-white hover:brightness-110 disabled:opacity-40"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <p className="mt-5 text-center text-sm text-secondary">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="font-medium text-accent underline">
            Sign up
          </Link>
        </p>
      </form>

      {/* Below the card so it never competes with signing in — installing
          doesn't need an account, and this is the natural first stop for
          someone arriving on their phone. */}
      <InstallButton variant="wide" />
    </main>
  );
}
