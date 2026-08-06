import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import InstallButton from "@/components/InstallButton";
import Logo from "@/components/Logo";

/**
 * The front door for someone who isn't signed in — the home page itself.
 * Signed-out visits to `/` are rewritten here (see proxy.ts), so the pitch
 * shows at the root URL; signed-in ones get the log at the same address —
 * the pitch is for people who don't have the habit yet.
 */

export const metadata: Metadata = {
  title: "PIT — Track everything that makes a day good",
  description:
    "Sleep, study, work, workouts, namaz, habits and streaks — logged in taps, charted over time, with a status page that says what to fix first.",
};

const FEATURES: { icon: string; title: string; text: string }[] = [
  {
    icon: "✍️",
    title: "Log a day in taps",
    text: "Every tracker gets the input it needs — a stopwatch for study, bed and wake times for sleep, five buttons for namaz. It saves as you type.",
  },
  {
    icon: "📊",
    title: "Watch the trends",
    text: "Time donuts, sleep clocks, streak counts and goal bars over a week, a month or a year — read off what you actually logged.",
  },
  {
    icon: "🎯",
    title: "Know what to fix first",
    text: "The Status page turns your data into plain statements, worst first: short sleep, missed prayers, goals slipping. Every one carries its number.",
  },
  {
    icon: "🔥",
    title: "Streaks that forgive",
    text: "Clean streaks count days since the last slip — a day you didn't open the app doesn't reset a three-month run. Milestones get celebrated.",
  },
  {
    icon: "🔔",
    title: "The 11 o'clock question",
    text: "Every night at 11, PIT asks how your day went — log it while it's fresh. Sunday nights bring a week in review to look forward to.",
  },
  {
    icon: "🔒",
    title: "Yours, and yours only",
    text: "Works offline and syncs when you're back. Export everything as CSV or JSON any time, import it back anywhere. Accounts are invite-only.",
  },
];

export default function WelcomePage() {
  return (
    <main className="flex-1">
      {/* Top bar */}
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-4">
        <span className="flex items-center gap-2">
          <Logo size={28} />
          <span className="text-brand-gradient text-xl font-bold tracking-tight">
            PIT
          </span>
        </span>
        <Link
          href="/login"
          className="rounded-md border border-edge px-4 py-2 text-sm font-medium text-secondary hover:bg-surface-2"
        >
          Sign in
        </Link>
      </header>

      {/* Hero */}
      <section className="mx-auto w-full max-w-5xl px-4 pt-10 pb-12 text-center sm:pt-16">
        <p className="text-sm font-semibold tracking-wide text-secondary">
          Giving up is not in your blood.
        </p>
        <h1 className="mx-auto mt-3 max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
          Track everything that makes a day{" "}
          <span className="text-brand-gradient">good</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-secondary">
          Sleep, study, work, workouts, namaz, habits, clean streaks — logged
          in taps, charted over time, and read back to you as the things worth
          fixing first.
        </p>

        <div className="mx-auto mt-8 flex max-w-sm flex-col items-center gap-3">
          <Link
            href="/signup"
            className="w-full rounded-md bg-brand-gradient px-6 py-3 font-medium text-white hover:brightness-110"
          >
            Create your account
          </Link>
          <InstallButton variant="wide" />
          <p className="text-xs text-muted">
            Accounts are invite-only — ask the owner for the code.
          </p>
        </div>
      </section>

      {/* The app itself */}
      <section className="mx-auto flex w-full max-w-5xl flex-wrap items-start justify-center gap-6 px-4 pb-14">
        <div className="w-64 overflow-hidden rounded-2xl border border-edge shadow-lg">
          <Image
            src="/screenshot-log.png"
            alt="The daily log: sleep, namaz, study, workout and more, each with its own input"
            width={1080}
            height={1920}
            priority
            // Drawn 16rem wide; without this the browser is told 100vw and a
            // phone downloads a rendition four times larger than it shows.
            sizes="16rem"
            className="h-auto w-full"
          />
        </div>
        <div className="hidden w-64 overflow-hidden rounded-2xl border border-edge shadow-lg sm:block">
          <Image
            src="/screenshot-stats.png"
            alt="The stats page: time logged, goals met, and charts for study and sleep"
            width={1080}
            height={1920}
            sizes="16rem"
            className="h-auto w-full"
          />
        </div>
      </section>

      {/* Why it sticks */}
      <section className="mx-auto w-full max-w-5xl px-4 pb-16">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-lg border border-edge card p-5 shadow-sm"
            >
              <span className="text-2xl" aria-hidden="true">
                {f.icon}
              </span>
              <h2 className="mt-2 font-semibold">{f.title}</h2>
              <p className="mt-1 text-sm text-secondary">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Last word */}
      <section className="border-t border-edge bg-surface">
        <div className="mx-auto w-full max-w-5xl px-4 py-12 text-center">
          <h2 className="text-2xl font-bold tracking-tight">
            The day you&apos;re about to have is worth writing down.
          </h2>
          <div className="mx-auto mt-6 flex max-w-sm flex-col gap-3">
            <Link
              href="/signup"
              className="w-full rounded-md bg-brand-gradient px-6 py-3 font-medium text-white hover:brightness-110"
            >
              Get started
            </Link>
            <Link
              href="/login"
              className="w-full rounded-md border border-edge px-6 py-3 font-medium text-secondary hover:bg-surface-2"
            >
              I already have an account
            </Link>
          </div>
          <p className="mt-8 text-xs text-muted">
            PIT — Productivity Improvement Tracker · Built by{" "}
            <a
              href="https://abdullah-al-noman.vercel.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline-offset-2 hover:underline"
            >
              Rohan
            </a>
          </p>
        </div>
      </section>
    </main>
  );
}
