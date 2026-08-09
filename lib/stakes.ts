import { addDays, prettyDate } from "./dates";
import { crossedRecently } from "./milestones";

/**
 * What the 11 PM ask should actually say tonight.
 *
 * The nightly push is the closing ritual of the day and it goes out whether
 * the day is logged or not — that is deliberate. But asking the same question
 * every night wastes the one moment when the app has the person's attention:
 * some nights there is a 30-day mark to celebrate, or a challenge with one day
 * left on it. So the slot stays exactly where it is and only the wording
 * changes, chosen by whatever is genuinely at stake.
 *
 * One message, never two. A second notification in the same run is how people
 * turn notifications off.
 *
 * Pure on purpose: the cron route gathers the rows, this decides the words,
 * and the tests can walk every branch without a database.
 */

export type Stake = {
  title: string;
  body: string;
  url: string;
  /** Which branch spoke — for the run log, so we can see it working. */
  kind: "milestone" | "challenge-last" | "challenge" | "streak" | "plain";
};

/** A challenge as it stands tonight, read off `challengeProgress`. */
export type StakeChallenge = {
  name: string;
  status: string;
  /** Which day of the challenge today is, 1-based. */
  dayNumber: number;
  days: number;
  /**
   * Whether today already counts. For an "at most" challenge an unlogged day
   * counts as clean, so this is false only when the day is genuinely at risk.
   */
  todayMet: boolean;
};

export type StakeInput = {
  date: string;
  /** Anything at all logged today — what the logging streak hangs on. */
  loggedToday: boolean;
  /** Consecutive logged days ending today, or yesterday if today is blank. */
  loggingStreak: number;
  /** Clean-streak trackers and the run each is on right now. */
  streaks: { name: string; current: number }[];
  challenges: StakeChallenge[];
};

/** Below this a run isn't worth invoking — everyone has three good days. */
const STREAK_WORTH_SAVING = 5;

/**
 * Consecutive days with something logged, ending today — or ending yesterday
 * when today is still blank, which is the case the reminder exists for.
 *
 * Same rule as the report card's `currentStreak`: today not being filled in
 * yet doesn't end the run, because the day isn't over.
 */
export function loggingRun(logged: Set<string>, today: string): number {
  let n = 0;
  let cursor = logged.has(today) ? today : addDays(today, -1);
  while (logged.has(cursor)) {
    n++;
    cursor = addDays(cursor, -1);
  }
  return n;
}

/** The generic ask — the wording the reminder has always used. */
function plain(date: string): Stake {
  return {
    kind: "plain",
    title: "The day is finished — how was it?",
    body: `Tell me about ${prettyDate(date)}, so I can track your life better.`,
    url: `/?date=${date}`,
  };
}

export function nightlyMessage(input: StakeInput): Stake {
  const { date } = input;
  const url = `/?date=${date}`;

  /* 1. A number worth stopping for. Window of 1: this runs nightly, so only
        a milestone crossed *today* is news — the weekly digest is the one
        that looks back seven days. */
  let best: { name: string; milestone: number } | null = null;
  for (const s of input.streaks) {
    const m = crossedRecently(s.current, 1);
    if (m !== null && (best === null || m > best.milestone)) {
      best = { name: s.name, milestone: m };
    }
  }
  if (best) {
    return {
      kind: "milestone",
      title: `${best.milestone} days clean — ${best.name} 🎉`,
      body: `You just crossed ${best.milestone}. Worth a moment. Then tell me how ${prettyDate(date)} went.`,
      url,
    };
  }

  /* 2 & 3. A challenge day that hasn't been earned yet. `todayMet` already
        knows that an "at most" challenge passes on a day you never logged, so
        anything false here is a day genuinely at risk. Last day leads. */
  const live = input.challenges.filter((c) => c.status === "active" && !c.todayMet);
  const last = live.find((c) => c.dayNumber >= c.days);
  if (last) {
    return {
      kind: "challenge-last",
      title: `Day ${last.days} of ${last.days} — ${last.name}`,
      body: "The last day of the challenge, and it isn't logged yet. Tonight is the one that finishes it.",
      url,
    };
  }
  if (live.length > 0) {
    const c = live[0];
    return {
      kind: "challenge",
      title: `Day ${c.dayNumber} of ${c.days} — ${c.name}`,
      body: "A day you don't log is a day the challenge counts as missed. It only takes a minute.",
      url,
    };
  }

  /* 4. The logging run — the one streak that a blank day really does end.
        Clean streaks are forgiving by design and are never threatened here. */
  if (!input.loggedToday && input.loggingStreak >= STREAK_WORTH_SAVING) {
    return {
      kind: "streak",
      title: `${input.loggingStreak} days in a row`,
      body: `${prettyDate(date)} is still blank. Don't let tonight be the gap.`,
      url,
    };
  }

  return plain(date);
}
