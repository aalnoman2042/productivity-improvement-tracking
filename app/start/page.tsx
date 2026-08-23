"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";

/**
 * The tour, shown once — straight after signing up.
 *
 * A new account is an empty one, and an empty app explains nothing about
 * itself: the old flow dropped you on the Trackers page with no list and no
 * idea what a tracker was for. Four screens fix that, and every one of them
 * can be skipped, because the fastest way to lose someone on their first
 * minute is to stand between them and the app.
 *
 * Deliberately outside the `(app)` group: no nav, no bottom bar, nothing to
 * wander off into until the tour hands over. It is not gated or remembered —
 * only signup links here — so it stays a page you can send someone back to,
 * which is exactly what the Account page does.
 */

type Step = {
  icon: string;
  title: string;
  lead: string;
  points: { label: string; text: string }[];
};

const STEPS: Step[] = [
  {
    icon: "📋",
    title: "First, say what you're tracking",
    lead: "PIT knows nothing about you until you tell it what matters. Start from a ready-made pack and rename, delete or add your own afterwards — nothing here is permanent.",
    points: [
      {
        label: "Ready-made packs",
        text: "Pick the kind of person you're trying to be and take the lot in one tap: the essentials, faith & discipline, gym man, productive man, learner, calm mind. They overlap on purpose, and a pack skips anything you already have — so take two or three.",
      },
      {
        label: "Every tracker has a type",
        text: "And the type decides how you log it: a stopwatch for time spent, bed and wake times for sleep, five buttons for namaz, one tap for yes-or-no, a number for weight.",
      },
      {
        label: "Goals, if you want them",
        text: "\"At least 3h a day\", \"at most 2 a week\". A habit you're cutting rather than building gets marked as one, so more of it counts as falling behind, not doing well.",
      },
    ],
  },
  {
    icon: "📝",
    title: "Then log the day in taps",
    lead: "Open Today and answer. The things you can answer with a tap sit first in every section, so a full day usually takes under a minute.",
    points: [
      {
        label: "It saves itself",
        text: "A moment after you stop typing, and only the trackers you actually changed — so logging on your phone never wipes what you typed on a laptop. There's an undo window if you fat-finger something.",
      },
      {
        label: "It works with no signal",
        text: "Log on a bus, in a basement, on a plane. Everything queues up and syncs the moment you're back online.",
      },
      {
        label: "A day is 24 hours, strictly",
        text: "Time-based trackers can't add up to more than a day between them. If the numbers don't fit, the app says so instead of quietly accepting a 27-hour Tuesday.",
      },
      {
        label: "Words, where numbers run out",
        text: "At the foot of the day there's a note about the day itself, and a short one you can pin to any tracker you filled in. They come back on the calendar, so a bad week has its reasons attached.",
      },
    ],
  },
  {
    icon: "🧭",
    title: "Now watch it add up",
    lead: "This is where the logging pays for itself. Three screens read your record back to you, and none of them need the internet to do it.",
    points: [
      {
        label: "A score for every day",
        text: "Each logged day is marked out of 100 — goals hit, showing up, sleep inside the healthy band, streaks kept and bad habits at zero. It's arithmetic on your own numbers, so it means the same thing every day.",
      },
      {
        label: "What to fix first",
        text: "Status ranks your problems with the biggest win at the top, and every line carries the number it came from. Stats charts the trends: time donuts, sleep clocks, goal bars over a week, a month or a year.",
      },
      {
        label: "Grades and streaks",
        text: "The report card marks each tracker over its own lifetime, so adding something new never dents the old subjects. Clean streaks count days since the last slip — a day you didn't open the app won't reset a three-month run.",
      },
      {
        label: "And a shelf for books",
        text: "Books aren't habits, so they sit behind a Books button on the Trackers page rather than pretending to be trackers: a wishlist, and the count of what you've actually finished. Whatever you're reading turns up at the foot of the daily log — type the page you reached and watch what's left of it shrink.",
      },
    ],
  },
  {
    icon: "🧠",
    title: "And let the coach read it",
    lead: "Once you've got a few days on record, Life right now reads the whole picture and answers the question the rest of the app only hints at: how am I actually doing?",
    points: [
      {
        label: "An honest read, with a plan",
        text: "What's genuinely working, what's quietly slipping, the one thing to fix first, a concrete step for tonight and a couple of moves for the week. Every point names the habit and stands on a number you can check.",
      },
      {
        label: "The numbers aren't the AI's",
        text: "Your day score, the rising-or-slipping arrow and the fortnight of bars are all computed by the app from your own log. The AI supplies the judgement and the words around them, and nothing else.",
      },
      {
        label: "Ask it anything about your own data",
        text: "Under the card there's a question box: “is my sleep hurting my study?”, “what's dragging my score down?” It answers from your numbers alone, in a few plain sentences, whenever you wonder.",
      },
      {
        label: "And it keeps your weeks",
        text: "When a week ends you can have it written up and saved. The daily read is replaced every eight hours; the weekly ones stay, so a year of them reads like a diary the app wrote about you.",
      },
      {
        label: "It never sees your words",
        text: "Only numbers and tracker names are ever sent — never your notes. It runs on demand, once every eight hours, and re-reading the last answer is free and works offline.",
      },
    ],
  },
];

export default function StartPage() {
  const router = useRouter();
  const [i, setI] = useState(0);

  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  // Both "skip" and "finish" land on Trackers: an empty account has nothing
  // to log yet, so the only useful next move is picking what to track.
  // `replace` keeps the tour out of the back button once it's done its job.
  const leave = () => router.replace("/trackers");

  return (
    <main className="flex flex-1 items-center justify-center p-4 sm:p-6">
      <div className="animate-rise-in flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-edge card shadow-md">
        <div className="flex items-center gap-2 bg-brand-gradient px-5 py-3.5 text-white">
          <Logo size={22} />
          <span className="font-bold tracking-tight">PIT</span>
          <span className="ml-auto text-xs text-white/80 tabular-nums">
            {i + 1} of {STEPS.length}
          </span>
          <button
            onClick={leave}
            className="rounded-full px-2.5 py-1 text-xs font-semibold text-white/90 ring-1 ring-inset ring-white/30 hover:bg-white/15"
          >
            Skip
          </button>
        </div>

        <div className="p-5 sm:p-6">
          <span className="text-3xl leading-none" aria-hidden="true">
            {step.icon}
          </span>
          <h1 className="mt-2.5 text-xl font-bold tracking-tight">
            {step.title}
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-secondary">
            {step.lead}
          </p>

          {/* Keyed so React rebuilds the list on every step — otherwise the
              stagger animation only ever plays once, on the first screen. */}
          <ul key={i} className="stagger mt-4 space-y-3">
            {step.points.map((p) => (
              <li
                key={p.label}
                className="rounded-xl border border-edge bg-surface-2/60 p-3"
              >
                <p className="text-sm font-semibold">{p.label}</p>
                <p className="mt-0.5 text-sm text-secondary">{p.text}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center gap-3 border-t border-edge px-5 py-3.5 sm:px-6">
          <div className="flex gap-1.5" aria-hidden="true">
            {STEPS.map((s, n) => (
              <span
                key={s.title}
                className={`h-1.5 rounded-full transition-all ${
                  n === i ? "w-5 bg-accent" : "w-1.5 bg-edge"
                }`}
              />
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {i > 0 && (
              <button
                onClick={() => setI((n) => n - 1)}
                className="rounded-lg border border-edge px-3.5 py-2 text-sm font-medium text-secondary hover:bg-surface-2"
              >
                Back
              </button>
            )}
            <button
              onClick={() => (last ? leave() : setI((n) => n + 1))}
              className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
            >
              {last ? "Add my first trackers" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
