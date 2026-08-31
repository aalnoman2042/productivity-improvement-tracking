import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import InstallButton from "@/components/InstallButton";
import Logo from "@/components/Logo";
import { AUTHOR, siteUrl } from "@/lib/site";

/**
 * The front door for someone who isn't signed in — the home page itself.
 * Signed-out visits to `/` are rewritten here (see proxy.ts), so the pitch
 * shows at the root URL; signed-in ones get the log at the same address —
 * the pitch is for people who don't have the habit yet.
 */

/**
 * Everything a crawler and a link preview get.
 *
 * Written out rather than left to the defaults because this is the only page
 * of the app a search engine will ever see — everything else redirects to
 * /login — so it carries the whole description of what PIT is. The canonical
 * is absolute and points at the production host, so a Vercel preview
 * deployment cannot compete with the real page in an index (`lib/site.ts`).
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: "PIT — Habit, Sleep & Productivity Tracker You Log in Taps",
  description:
    "A free personal tracker for sleep, study, work, workouts, namaz, water, habits and clean streaks. Log a day in taps, get it scored out of 100, watch the trends, and read a plain-English coach that tells you what to fix first. Works offline, installs to your phone, and your data exports in one click.",
  keywords: [
    "habit tracker",
    "sleep tracker",
    "productivity tracker",
    "daily log app",
    "streak tracker",
    "namaz tracker",
    "study time tracker",
    "self improvement app",
    "offline habit tracker",
    "free habit tracker",
    "PWA habit tracker",
  ],
  applicationName: "PIT",
  authors: [{ name: AUTHOR.name, url: AUTHOR.url }],
  creator: AUTHOR.name,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: siteUrl(),
    siteName: "PIT",
    title: "PIT — Track everything that makes a day good",
    description:
      "Sleep, study, work, workouts, namaz, habits and streaks — logged in taps, scored out of 100, and read back in plain English. Free, offline-first, and your data is yours.",
    images: [
      {
        url: "/icon-512.png",
        width: 512,
        height: 512,
        alt: "PIT — Productivity Improvement Tracker",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "PIT — Track everything that makes a day good",
    description:
      "Log your day in taps. Get it scored. See what to fix first. Free and offline-first.",
    images: ["/icon-512.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
};

/**
 * The questions people actually ask before signing up for a tracker — which
 * is also, not coincidentally, the shape search engines reward. Rendered on
 * the page AND as FAQPage structured data below, because an answer that only
 * exists in a script tag is an answer written for a crawler rather than for
 * a person, and this app does not do that.
 */
const FAQ: { q: string; a: string }[] = [
  {
    q: "Is PIT free?",
    a: "Yes. Logging, charts, the day score, grades, the report card, reminders, streaks, the calendar and the full export are free and open to anyone who signs up. The only part that is not is the AI coach, which runs on a shared free-tier allowance and goes to invited members for now.",
  },
  {
    q: "Do I need an invite code?",
    a: "No. Sign up without one and everything in the app works. An invite code switches on the AI coach — the daily read, the question box and the Sunday week in review.",
  },
  {
    q: "Does it work offline?",
    a: "Yes. PIT is a progressive web app: it installs to your home screen, opens with no signal, and queues anything you log until the connection comes back. Nothing you type is lost to a dead zone.",
  },
  {
    q: "What can I track?",
    a: "Time spent (with a stopwatch), sleep with bedtimes and wake times, counts like water or meals, 1-to-5 ratings, yes-or-no checks, measurements like weight, the five daily prayers, and clean streaks for a habit you are cutting. Start from a ready-made pack or write your own.",
  },
  {
    q: "How is the day score worked out?",
    a: "Arithmetic on your own numbers, never an AI: goals hit, showing up, sleep inside a healthy band, streaks kept and bad habits at zero. It means the same thing every day, which is the whole point of it.",
  },
  {
    q: "Who can see my data?",
    a: "Only you. Every account is private, notes and email are never sent to any AI, and you can export everything as JSON or CSV — or delete it — whenever you like.",
  },
  {
    q: "Is there an Android app?",
    a: "There is an APK that wraps the same site, so it updates itself with no reinstall. The web app installs to iPhone and Android home screens too.",
  },
];

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
    icon: "💬",
    title: "You can ask it something back",
    text: "A question box under the card, pointed at the same numbers: “is my sleep hurting my study?”, “which day do I fall apart?” It answers in a few plain sentences from your log alone — and says so plainly when the data can’t tell which thing caused the other.",
  },
  {
    icon: "📖",
    title: "It remembers your weeks",
    text: "The daily read is replaced by the next one. A finished week gets a review of its own, written once and kept — so a year later you can still read what the app made of you last June.",
  },
  {
    icon: "🔒",
    title: "It never sees your words",
    text: "Only numbers and tracker names are ever sent — never a word you wrote in a note, never your email. It runs on demand, once every eight hours, and re-reading the last answer costs nothing and works offline.",
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
    title: "A question at your hour",
    text: "Once a day, at a time you choose, PIT asks how your day went — log it while it's fresh. Any tracker can carry its own reminders too. Sunday nights bring a week in review to look forward to.",
  },
  {
    icon: "📚",
    title: "A shelf for what you read",
    text: "Books aren't habits, so they don't pretend to be trackers — they get a shelf of their own: a wishlist, and the count of what you actually finished this year. The one you're reading sits at the foot of the daily log, where typing the page you reached shows how much of it is left.",
  },
  {
    icon: "🔒",
    title: "Yours, and yours only",
    text: "Works offline and syncs when you're back. Export everything as CSV or JSON any time, import it back anywhere. Every account is private, and nothing you write is ever sent to an AI.",
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
          className="rounded-lg border border-edge px-4 py-2 text-sm font-medium text-secondary hover:bg-surface-2"
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
            <p className="mt-3 inline-block rounded-lg bg-white/15 px-3 py-1.5 text-xs font-medium text-white">
              ✨ For invited members, for now — everything else in PIT is open
              to everyone
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
      {/* Why the one paid-shaped thing is paid-shaped. Said in the open,
          because "premium" with no reason behind it is the oldest and least
          convincing sentence on the internet. */}
      <section className="mx-auto w-full max-w-3xl px-4 pb-16">
        <div className="rounded-xl border border-edge card p-5 text-sm text-secondary shadow-sm">
          <h2 className="text-base font-semibold text-foreground">
            Why the coach is the one thing behind an invite
          </h2>
          <p className="mt-2">
            Everything else here is arithmetic on your own numbers — it costs
            nothing to run, so it costs nothing to use, and it always will.
            The coach is a language model, and it runs on a free allowance
            that belongs to <em>one key</em> and is shared by everybody at
            once. A thousand people cannot each have a daily read of it.
          </p>
          <p className="mt-2">
            So: sign up with no code and the whole tracker is yours — logging,
            charts, the score, grades, streaks, reminders, the calendar,
            export. An invite code switches on the daily read, the question
            box and the Sunday week in review. Ask, and you may well get one.
          </p>
        </div>
      </section>

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

      {/* Questions people actually ask before they sign up for a tracker.
          Rendered as real text, not only as structured data — an answer that
          exists solely in a script tag was written for a crawler. */}
      <section className="mx-auto w-full max-w-3xl px-4 pb-16">
        <h2 className="text-center text-2xl font-bold tracking-tight">
          Questions
        </h2>
        <dl className="mt-6 space-y-3">
          {FAQ.map((f) => (
            <div
              key={f.q}
              className="rounded-xl border border-edge card p-4 shadow-sm"
            >
              <dt className="font-semibold">{f.q}</dt>
              <dd className="mt-1.5 text-sm text-secondary">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Contact */}
      <section className="mx-auto w-full max-w-3xl px-4 pb-16">
        <div className="rounded-xl border border-edge card p-5 text-center shadow-sm">
          <h2 className="text-base font-semibold">Built by one person</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-secondary">
            PIT is made and maintained by {AUTHOR.name}. Bugs, ideas, an
            invite code, or a question about how something is calculated — the
            way to reach me is on my site.
          </p>
          <a
            href={AUTHOR.url}
            target="_blank"
            rel="noopener noreferrer me"
            className="mt-4 inline-block rounded-lg border border-edge px-5 py-2.5 text-sm font-medium hover:bg-surface-2"
          >
            Get in touch →
          </a>
        </div>
      </section>

      {/*
        Structured data. Two objects, both describing exactly what is on the
        page above and nothing that isn't: a SoftwareApplication so a result
        can carry the price (free) and what it runs on, and an FAQPage built
        from the same `FAQ` array the section above renders — so the two can
        never drift into saying different things, which is the failure mode
        that gets structured data ignored.
      */}
      <script
        type="application/ld+json"
        // The content is this file's own constants, not user input.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([
            {
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              name: "PIT — Productivity Improvement Tracker",
              url: siteUrl(),
              applicationCategory: "HealthApplication",
              operatingSystem: "Web, Android, iOS",
              description:
                "A personal tracker for sleep, study, work, workouts, namaz, water, habits and clean streaks. Log a day in taps, get it scored out of 100, and read back what to fix first.",
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
              },
              author: {
                "@type": "Person",
                name: AUTHOR.name,
                url: AUTHOR.url,
              },
            },
            {
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: FAQ.map((f) => ({
                "@type": "Question",
                name: f.q,
                acceptedAnswer: { "@type": "Answer", text: f.a },
              })),
            },
          ]),
        }}
      />

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
              {AUTHOR.name}
            </a>
          </p>
        </div>
      </section>
    </main>
  );
}
