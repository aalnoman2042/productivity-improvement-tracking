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
    "Sleep, study, work, workouts, namaz, habits and streaks — logged in taps, charted over time, scored out of 100, and read back by an AI coach that says what to fix first.",
};

/** The path from an empty account to knowing what to do about your week. */
const STEPS: { title: string; text: string }[] = [
  {
    title: "Pick what you're tracking",
    text: "Start from a ready-made pack — sleep, study, work, workout, water, namaz, junk food, clean streaks — or write your own. Each tracker knows what kind of thing it is, so it asks you the right question instead of a blank number box.",
  },
  {
    title: "Log the day in taps",
    text: "A stopwatch for study, bed and wake times for sleep, five buttons for namaz, one tap for yes-or-no. It saves as you go, works with no signal, and a single day can never add up to more than 24 hours.",
  },
  {
    title: "The day gets a score",
    text: "Every logged day is marked out of 100 — goals hit, showing up, sleep inside the healthy band, streaks kept and bad habits at zero. No AI in this part: it is arithmetic on your own numbers, so it means the same thing every single day.",
  },
  {
    title: "Read what it says back",
    text: "Status ranks what to fix first, worst thing at the top. The report card grades each tracker over its own lifetime, so adding something new never dents the old marks. And the coach reads the lot and tells you where you actually stand.",
  },
];

/** What the AI does, and — just as much — what it is not allowed to do. */
const COACH: { icon: string; title: string; text: string }[] = [
  {
    icon: "📈",
    title: "It reads a real trend, not a total",
    text: "Your last seven days against the seven before them, goal hit rates, average bedtime, streaks and grades are all worked out by the app before the AI is ever asked. It reads those facts and ranks them — it never does the arithmetic itself, so it can't quietly invent a number that flatters or scares you.",
  },
  {
    icon: "🔢",
    title: "The numbers are the app's, not the AI's",
    text: "The day score, the rising-or-slipping arrow and the fortnight of bars on the card are computed from your own log and shown exactly as calculated. The AI supplies the judgement and the words around them, and only that.",
  },
  {
    icon: "🎯",
    title: "It ends with something to do",
    text: "What's genuinely working, what's quietly slipping, the one thing to fix first, a concrete step for tonight and two or three moves for the rest of the week. Every point names the habit it's about and stands on a number you can go and check yourself.",
  },
  {
    icon: "🔒",
    title: "It never sees your words",
    text: "Only numbers and tracker names are ever sent — never your notes, never your email. It runs on demand, once every eight hours, and re-reading the last answer costs nothing and works offline.",
  },
];

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
          in taps, charted over time, scored out of 100, and read back to you
          by an AI coach as the things worth fixing first.
        </p>

        <div className="mx-auto mt-8 flex max-w-sm flex-col items-center gap-3">
          <Link
            href="/signup"
            className="w-full rounded-lg bg-brand-gradient px-6 py-3 font-medium text-white hover:brightness-110"
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

      {/* How it works — the whole loop, before any feature list. */}
      <section className="mx-auto w-full max-w-5xl px-4 pb-14">
        <h2 className="text-center text-2xl font-bold tracking-tight">
          How it works
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-sm text-secondary">
          Four steps, and the fourth is the one everything else is for.
        </p>
        <ol className="mt-8 grid gap-4 sm:grid-cols-2">
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              className="flex gap-4 rounded-xl border border-edge card p-5 shadow-sm"
            >
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-bold text-accent"
              >
                {i + 1}
              </span>
              <span className="min-w-0">
                <h3 className="font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-secondary">{s.text}</p>
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/* The coach, at length — it's the part people ask about. */}
      <section className="mx-auto w-full max-w-5xl px-4 pb-16">
        <div className="overflow-hidden rounded-2xl border border-accent/40 card shadow-sm">
          <div className="bg-brand-gradient px-5 py-5 text-white sm:px-6">
            <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight">
              <span aria-hidden="true">🧠</span> Life right now
            </h2>
            <p className="mt-1.5 max-w-2xl text-sm text-white/85">
              One tap, and everything you have ever logged is read back to you
              as an honest answer to &ldquo;how am I actually doing?&rdquo; — a
              headline, what&apos;s working, what&apos;s slipping, and the one
              thing to fix first, starting tonight.
            </p>
          </div>
          <div className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
            {COACH.map((c) => (
              <div key={c.title}>
                <h3 className="flex items-center gap-2 font-semibold">
                  <span aria-hidden="true">{c.icon}</span>
                  {c.title}
                </h3>
                <p className="mt-1 text-sm text-secondary">{c.text}</p>
              </div>
            ))}
          </div>
          <p className="border-t border-edge px-5 py-3 text-xs text-muted sm:px-6">
            The coach runs on a free AI model. Nothing you log is used to train
            anything, and the app works exactly the same if you never press the
            button.
          </p>
        </div>
      </section>

      {/* Why it sticks */}
      <section className="mx-auto w-full max-w-5xl px-4 pb-16">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-edge card p-5 shadow-sm"
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
              className="w-full rounded-lg bg-brand-gradient px-6 py-3 font-medium text-white hover:brightness-110"
            >
              Get started
            </Link>
            <Link
              href="/login"
              className="w-full rounded-lg border border-edge px-6 py-3 font-medium text-secondary hover:bg-surface-2"
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
