"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import PasswordInput from "@/components/PasswordInput";

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    invite: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function set(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        // Straight into the tour, which hands over to Trackers at the end or
        // the moment it's skipped. A brand-new account has nothing to show,
        // so an unexplained empty list is a worse first screen than this.
        router.replace("/start");
        router.refresh();
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Could not create your account");
      }
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-md border border-edge bg-transparent px-3 py-2 outline-none focus:border-accent";

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="animate-rise-in w-full max-w-sm rounded-xl border border-edge card p-8 shadow-md"
      >
        <div className="mb-3 flex justify-center">
          <Logo size={52} />
        </div>
        <h1 className="text-brand-gradient text-center text-2xl font-bold tracking-tight">
          PIT
        </h1>
        <p className="mt-1 mb-6 text-center text-sm text-secondary">
          Create your account
        </p>

        <label className="mb-1 block text-sm font-medium">Name</label>
        <input
          required
          autoFocus
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          className={`${field} mb-4`}
        />

        <label className="mb-1 block text-sm font-medium">Email</label>
        <input
          type="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={(e) => set("email", e.target.value)}
          className={`${field} mb-4`}
        />

        <label className="mb-1 block text-sm font-medium">Password</label>
        <PasswordInput
          autoComplete="new-password"
          minLength={8}
          value={form.password}
          onChange={(v) => set("password", v)}
          className="mb-1"
        />
        <p className="mb-4 text-xs text-muted">At least 8 characters.</p>

        <label className="mb-1 block text-sm font-medium">
          Invite code{" "}
          <span className="font-normal text-muted">— optional</span>
        </label>
        <input
          value={form.invite}
          onChange={(e) => set("invite", e.target.value)}
          placeholder="Leave blank if you don't have one"
          className={field}
        />
        {/* The code stopped being a door and became a key to one room. It is
            worth saying here rather than only on the pitch page: this is the
            field people stall on. */}
        <p className="mt-1 text-xs text-muted">
          Not needed to sign up — the whole tracker works without it. A code
          switches on the 🧠 AI coach, which runs on one shared free
          allowance and so can&apos;t be open to everyone yet.
        </p>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="mt-5 w-full rounded-lg bg-brand-gradient py-2.5 font-medium text-white hover:brightness-110 disabled:opacity-40"
        >
          {busy ? "Creating…" : "Create account"}
        </button>

        <p className="mt-5 text-center text-sm text-secondary">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-accent underline">
            Sign in
          </Link>
        </p>

        {/* Where to ask for a code, for the one person who wants the coach. */}
        <p className="mt-3 border-t border-edge pt-3 text-center text-xs text-muted">
          Want the AI coach?{" "}
          <a
            href="https://abdullah-al-noman.vercel.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-accent underline underline-offset-2"
          >
            Contact the owner
          </a>
        </p>
      </form>
    </main>
  );
}
