import { formatValue, type Tracker, type TrackerType } from "./trackers";
import { nightLabel, shiftLabel, toNight } from "./clock";
import type { Stats, Summary } from "./stats";

export type InsightLevel = "bad" | "warn" | "good";

export type Insight = {
  level: InsightLevel;
  /** The headline — short enough to read at a glance. */
  title: string;
  /** The numbers behind it, so nothing here is a vague scold. */
  detail: string;
};

const RANK: Record<InsightLevel, number> = { bad: 0, warn: 1, good: 2 };

const hours = (minutes: number) => formatValue(minutes, "duration", "min");

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Sleep is the one that quietly drags everything else down. */
function sleepInsight(t: Tracker, s: Summary): Insight | null {
  if (s.days === 0) return null;
  const avg = s.avgPerLoggedDay;
  const nights = `${s.days} night${s.days === 1 ? "" : "s"}`;
  if (avg < 360) {
    return {
      level: "bad",
      title: `You're averaging ${hours(avg)} of sleep`,
      detail: `Under 6 hours across ${nights}. This is the one that drags focus, mood and appetite down with it.`,
    };
  }
  if (avg < 420) {
    return {
      level: "warn",
      title: `Sleep is a little short at ${hours(avg)}`,
      detail: `Across ${nights}. Another 30–60 minutes a night would put you in the healthy range.`,
    };
  }
  // Sleep has a ceiling too: well past your own goal (or past 9h with no
  // goal set) isn't "healthy, keep it there" — it's usually a late bedtime
  // stealing the morning.
  const target =
    t.goal && t.goal.period === "day" && t.goal.direction === "min"
      ? t.goal.target
      : 540;
  if (avg - target >= 60) {
    return {
      level: "warn",
      title: `Sleep is overshooting — ${hours(avg)} a night`,
      detail: `${
        t.goal ? `Your goal is ${hours(target)}` : "A full night tops out near 9h"
      } and you're ${hours(avg - target)} past it, across ${nights}. Long sleep is usually a bedtime problem wearing a morning disguise.`,
    };
  }
  return {
    level: "good",
    title: `Sleep is healthy — ${hours(avg)} a night`,
    detail: `Across ${nights}. Keep it there.`,
  };
}

/**
 * Late nights are their own problem — you can sleep eight hours and still be
 * doing it from 3am. Midnight is the line; past 1am it's the headline.
 */
const MIDNIGHT = toNight("00:00") as number;
const ONE_AM = toNight("01:00") as number;

function bedtimeInsight(s: Summary): Insight | null {
  const clock = s.clock;
  if (!clock || clock.nights < 3) return null;

  const at = nightLabel(clock.bed);
  const nights = `${clock.nights} night${clock.nights === 1 ? "" : "s"}`;
  const versus =
    clock.prevBed != null ? shiftLabel(clock.bed, clock.prevBed) : null;
  const trend = versus
    ? versus === "about the same"
      ? " That's about where you were last period."
      : ` That's ${versus} than last period.`
    : "";

  if (clock.bed >= ONE_AM) {
    return {
      level: "bad",
      title: `You're getting to bed at ${at}`,
      detail: `Averaged over ${nights}, and up at ${nightLabel(clock.wake)}.${trend} Pulling the bedtime back is worth more than catching up in the morning.`,
    };
  }
  if (clock.bed >= MIDNIGHT) {
    return {
      level: "warn",
      title: `Bedtime is drifting past midnight — ${at}`,
      detail: `Averaged over ${nights}, up at ${nightLabel(clock.wake)}.${trend} Half an hour earlier would put you back the right side of midnight.`,
    };
  }
  return {
    level: "good",
    title: `You're in bed by ${at}`,
    detail: `Averaged over ${nights}, up at ${nightLabel(clock.wake)}.${trend}`,
  };
}

/** Namaz: the gap is easier to act on stated as prayers per week. */
function prayerInsight(t: Tracker, s: Summary, days: number): Insight | null {
  if (s.days === 0) {
    return {
      level: "warn",
      title: `No ${t.name} logged this period`,
      detail: `Nothing recorded in ${days} days, so there's nothing to judge — tick them off on the daily log and this fills in.`,
    };
  }
  const avg = s.avgPerLoggedDay;
  const missedPerWeek = Math.max(0, Math.round((5 - avg) * 7));
  const covered = `${s.days} of ${days} days logged`;

  if (avg >= 4.9) {
    return {
      level: "good",
      title: `All five prayers, ${round1(avg)}/5 a day`,
      detail: `${covered}. Nothing to fix here.`,
    };
  }
  if (avg >= 3.5) {
    return {
      level: "warn",
      title: `${round1(avg)} of 5 prayers a day`,
      detail: `That's roughly ${missedPerWeek} missed a week — ${covered}.`,
    };
  }
  return {
    level: "bad",
    title: `Only ${round1(avg)} of 5 prayers a day`,
    detail: `Roughly ${missedPerWeek} missed a week — ${covered}. Pick the one you miss most and start there.`,
  };
}

/** Clean streaks: what matters is the run and how often it breaks. */
function streakInsight(t: Tracker, s: Summary, days: number): Insight | null {
  const run = s.streak;
  if (!run || run.since === null) return null;

  // Slips inside the period, which is what "lately" actually means.
  const recentSlips = Math.max(0, s.days - s.sum);

  if (run.current === 0) {
    return {
      level: "bad",
      title: `${t.name}: the streak reset today`,
      detail: `Your best run is ${run.best} day${run.best === 1 ? "" : "s"}. ${run.slips} slip${run.slips === 1 ? "" : "s"} on record.`,
    };
  }
  if (recentSlips >= 3) {
    return {
      level: "bad",
      title: `${t.name}: ${recentSlips} slips in ${days} days`,
      detail: `You're on ${run.current} day${run.current === 1 ? "" : "s"} now, against a best of ${run.best}. This is the pattern to break.`,
    };
  }
  if (run.current < 7) {
    return {
      level: "warn",
      title: `${t.name}: ${run.current} day${run.current === 1 ? "" : "s"} clean`,
      detail: `Your best run is ${run.best} days. The first week is the hard part.`,
    };
  }
  return {
    level: "good",
    title: `${t.name}: ${run.current} days clean`,
    detail:
      run.current >= run.best
        ? "That's your best run yet."
        : `Best run so far is ${run.best} days.`,
  };
}

/** Anything with a goal you set yourself, measured against it. */
function goalInsight(t: Tracker, s: Summary): Insight | null {
  if (!t.goal || !s.goal || s.goal.total === 0) return null;
  const { met, total } = s.goal;
  const rate = met / total;
  const unit = t.goal.period === "day" ? "days" : "weeks";
  const verb = t.goal.direction === "min" ? "hit" : "stayed under";

  if (rate < 0.35) {
    return {
      level: "bad",
      title: `${t.name}: goal ${verb} ${met} of ${total} ${unit}`,
      detail: `That's ${Math.round(rate * 100)}%. Either the habit needs work or the goal was set too high — both are worth a think.`,
    };
  }
  if (rate < 0.6) {
    return {
      level: "warn",
      title: `${t.name}: goal ${verb} ${met} of ${total} ${unit}`,
      detail: `${Math.round(rate * 100)}% of the time. Close enough to fix.`,
    };
  }
  if (rate >= 0.85) {
    return {
      level: "good",
      title: `${t.name}: goal ${verb} ${met} of ${total} ${unit}`,
      detail: `${Math.round(rate * 100)}% — that habit is holding.`,
    };
  }
  return null;
}

/** A time tracker you set up and then never filled in. */
function idleInsight(t: Tracker, s: Summary, days: number): Insight | null {
  if (s.days > 0 || days < 14) return null;
  return {
    level: "warn",
    title: `Nothing logged for ${t.name}`,
    detail: `Not once in ${days} days. If you've dropped it, archive it on the Trackers page so it stops skewing your numbers.`,
  };
}

/**
 * Read the last period and say what stands out — good and bad, each with the
 * number it came from. Nothing here is a guess: if the data isn't there, the
 * insight isn't shown.
 */
export function buildInsights(stats: Stats | null): Insight[] {
  if (!stats) return [];

  const out: Insight[] = [];
  const active = stats.trackers.filter((t) => !t.archived);
  const days = stats.days;

  // Everything below is only as good as what got typed in, so this goes first.
  if (days > 0 && stats.daysLogged < days * 0.5) {
    out.push({
      level: "warn",
      title: `Only ${stats.daysLogged} of ${days} days are logged`,
      detail:
        "The rest is blank, so treat everything below as a read on the days you did fill in.",
    });
  }

  for (const t of active) {
    const s = stats.summary[t.id];
    if (!s) continue;
    const type = t.type as TrackerType;

    // The type-specific readings say more than a goal percentage would, so
    // where one applies it speaks for that tracker instead of the goal rule.
    if (type === "sleep") {
      const i = sleepInsight(t, s);
      if (i) out.push(i);
      // How long and how late are separate problems with separate fixes.
      const bed = bedtimeInsight(s);
      if (bed) out.push(bed);
      continue;
    }
    if (type === "prayer") {
      const i = prayerInsight(t, s, days);
      if (i) out.push(i);
      continue;
    }
    if (type === "streak") {
      const i = streakInsight(t, s, days);
      if (i) out.push(i);
      continue;
    }

    const idle = idleInsight(t, s, days);
    if (idle) {
      out.push(idle);
      continue;
    }
    const goal = goalInsight(t, s);
    if (goal) out.push(goal);
  }

  // Worst first — the point is what needs attention, not a list of wins.
  out.sort((a, b) => RANK[a.level] - RANK[b.level]);

  const bad = out.filter((i) => i.level !== "good");
  const good = out.filter((i) => i.level === "good");

  // Keep it readable: everything that needs attention, and a couple of the
  // things going right.
  return [...bad.slice(0, 6), ...good.slice(0, 3)];
}
