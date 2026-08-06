import { nightLabel, toNight } from "./clock";
import { formatValue, typeMeta, type Tracker, type TrackerType } from "./trackers";
import type { Stats, Summary } from "./stats";

/**
 * Advice: the same numbers the insights read, turned into instructions.
 *
 * The insights say what's going on ("you're getting to bed at 2:05 am");
 * this says what to do about it and in what order ("get to bed before
 * midnight — pull it back 30 minutes at a time"). Every piece carries the
 * numbers it came from, so it never reads as a generic scold, and the list
 * is ranked so the top item is always the biggest win available.
 */

export type Advice = {
  /** What to do, said as an instruction. */
  focus: string;
  /** What's actually happening — the numbers this came from. */
  why: string;
  /** The first concrete step. */
  how: string;
  level: "bad" | "warn";
  /** Ranking weight — higher means fix it sooner. Not shown. */
  score: number;
};

const MIDNIGHT = toNight("00:00") as number;
const ONE_AM = toNight("01:00") as number;

const round1 = (n: number) => Math.round(n * 10) / 10;
const hours = (minutes: number) => formatValue(minutes, "duration", "min");

function sleepAdvice(t: Tracker, s: Summary): Advice[] {
  const out: Advice[] = [];
  const clock = s.clock;

  if (clock && clock.nights >= 3 && clock.bed >= MIDNIGHT) {
    const late = clock.bed >= ONE_AM;
    out.push({
      // The later the bedtime, the higher it climbs the list.
      score: late ? 90 + Math.min(9, (clock.bed - ONE_AM) / 30) : 60,
      level: late ? "bad" : "warn",
      focus: "Get to bed before 12",
      why: `You're turning in around ${nightLabel(clock.bed)} on average (${clock.nights} nights), up at ${nightLabel(clock.wake)}.`,
      how: late
        ? "Don't jump straight to midnight — pull it back 30 minutes at a time, week by week, until you're under 12. The 11 PM reminder is your cue to start shutting down."
        : `You're close — half an hour does it. Screens off by ${nightLabel(clock.bed - 45)} tonight.`,
    });
  }

  if (s.days > 0 && s.avgPerLoggedDay < 420) {
    const bad = s.avgPerLoggedDay < 360;
    out.push({
      score: bad ? 85 : 55,
      level: bad ? "bad" : "warn",
      focus: "Sleep at least 7 hours",
      why: `You're averaging ${hours(s.avgPerLoggedDay)} a night over ${s.days} night${s.days === 1 ? "" : "s"}.`,
      how: "Mornings have jobs in them, so this is won at night — move the bedtime, not the alarm.",
    });
  }

  // Sleep is a good habit with a ceiling: an hour or more past your own
  // 7h/8h goal, night after night, is worth a flag too — long sleep is
  // usually a late bedtime wearing a morning disguise.
  const target =
    t.goal && t.goal.period === "day" && t.goal.direction === "min"
      ? t.goal.target
      : 540; // no goal set: only flag genuinely long nights (9h+)
  const over = s.avgPerLoggedDay - target;
  if (s.days >= 3 && s.avgPerLoggedDay >= 420 && over >= 60) {
    out.push({
      score: 50,
      level: "warn",
      focus: `Cap sleep around ${hours(target)}`,
      why: `You're averaging ${hours(s.avgPerLoggedDay)} a night over ${s.days} nights — ${hours(over)} past ${
        t.goal ? `your ${hours(target)} goal` : "a full night"
      }.`,
      how: "Past the goal, more sleep is a symptom, not a bonus. Fix the wake-up time first — the extra usually evaporates with the late bedtime that caused it.",
    });
  }
  return out;
}

/**
 * The habit flag doing its job: a bad habit growing period-on-period is
 * "you're falling behind", said with the numbers; a good habit shrinking is
 * the same warning in the other direction. Goal-carrying trackers are
 * already judged against their goal, so this only speaks where that didn't.
 */
function habitTrendAdvice(t: Tracker, s: Summary, days: number): Advice | null {
  const aggregate = typeMeta(t.type as TrackerType).aggregate;
  const type = t.type as TrackerType;
  const now = aggregate === "sum" ? s.sum : s.avgPerLoggedDay;
  const prev = s.previous.value;
  const fmt = (v: number) => formatValue(v, type, t.unit);

  if (t.habit === "bad") {
    if (s.changePct !== null && s.changePct >= 25 && now > 0) {
      const bad = s.changePct >= 75;
      return {
        score: bad ? 80 : 58,
        level: bad ? "bad" : "warn",
        focus: `Cut ${t.name} back down`,
        why: `${fmt(now)} this period against ${fmt(prev)} the one before — up ${Math.round(s.changePct)}%. You're falling behind on it, and the trend says so plainly.`,
        how: "Growth like this lives in autopilot moments. Make it a decision again — log it the moment it happens, not at night, and the count itself starts pushing back.",
      };
    }
    if (s.previous.days === 0 && s.days >= Math.ceil(days / 2) && now > 0) {
      return {
        score: 55,
        level: "warn",
        focus: `Get ${t.name} off the daily list`,
        why: `It showed up on ${s.days} of ${days} days this period.`,
        how: "Don't fight every day at once — pick the easiest day of the week to keep clean and bank that one first.",
      };
    }
    return null;
  }

  if (s.changePct !== null && s.changePct <= -30 && prev > 0) {
    return {
      score: 52,
      level: "warn",
      focus: `Don't let ${t.name} slide`,
      why: `Down ${Math.round(Math.abs(s.changePct))}% on last period — ${fmt(now)} against ${fmt(prev)}.`,
      how: "A slide is easier to stop at 30% than at 100%. Put its slot back into tomorrow, at the time it used to happen.",
    };
  }
  return null;
}

function streakAdvice(t: Tracker, s: Summary, days: number): Advice | null {
  const run = s.streak;
  if (!run || run.since === null) return null;
  const recentSlips = Math.max(0, s.days - s.sum);

  if (run.current === 0) {
    return {
      score: 85,
      level: "bad",
      focus: `Restart ${t.name} today`,
      why: `The streak is at zero. Best run so far: ${run.best} day${run.best === 1 ? "" : "s"}; ${run.slips} slip${run.slips === 1 ? "" : "s"} on record.`,
      how: "Day one starts now. Name the exact moment the last one broke, and decide tonight what you'll do when that moment comes back.",
    };
  }
  if (recentSlips >= 2) {
    return {
      score: 70,
      level: "warn",
      focus: `Break the ${t.name} slip pattern`,
      why: `${recentSlips} slips in the last ${days} days; you're on ${run.current} day${run.current === 1 ? "" : "s"} now, against a best of ${run.best}.`,
      how: "Slips cluster around the same hour and mood — find yours and put something else in that slot.",
    };
  }
  return null;
}

function prayerAdvice(t: Tracker, s: Summary): Advice | null {
  if (s.days === 0) return null;
  const avg = s.avgPerLoggedDay;
  if (avg >= 4.9) return null;
  const missedPerWeek = Math.max(0, Math.round((5 - avg) * 7));
  const bad = avg < 3.5;
  return {
    score: bad ? 75 : 50,
    level: bad ? "bad" : "warn",
    focus: `Get all five prayers in`,
    why: `${t.name} is at ${round1(avg)} of 5 a day — roughly ${missedPerWeek} missed a week.`,
    how: "Don't chase all five at once. Pick the one you miss most and anchor just that one for a week; the rest tend to follow it.",
  };
}

function goalAdvice(t: Tracker, s: Summary): Advice | null {
  if (!t.goal || !s.goal || s.goal.total === 0) return null;
  const { met, total } = s.goal;
  const rate = met / total;
  if (rate >= 0.6) return null;

  const type = t.type as TrackerType;
  const targetLabel = formatValue(t.goal.target, type, t.unit);
  const per = t.goal.period === "day" ? "a day" : "a week";
  const unit = t.goal.period === "day" ? "days" : "weeks";
  const bad = rate < 0.35;

  if (t.goal.direction === "max") {
    return {
      score: bad ? 72 : 45,
      level: bad ? "bad" : "warn",
      focus: `Keep ${t.name} under ${targetLabel} ${per}`,
      why: `You stayed under on ${met} of ${total} ${unit} — ${Math.round(rate * 100)}%.`,
      how: "The days you overshoot have a shape — same place, same time, same company. Spot it, and decide the day before what happens instead.",
    };
  }
  return {
    score: bad ? 72 : 45,
    level: bad ? "bad" : "warn",
    focus: `Give ${t.name} its ${targetLabel} ${per}`,
    why: `You hit it on ${met} of ${total} ${unit} — ${Math.round(rate * 100)}%.`,
    how: bad
      ? "Either the habit needs a fixed slot in the day, or the goal is set too high to survive — shrink it until it's unmissable, then grow it back."
      : "Tie it to a fixed time of day. A habit with a slot survives; one without drifts.",
  };
}

/**
 * Read the period and say what to do about it, biggest win first. Empty when
 * nothing needs fixing — the page should go quiet rather than invent work.
 */
export function buildAdvice(stats: Stats | null): Advice[] {
  if (!stats || !stats.hasEntries) return [];

  const out: Advice[] = [];
  const active = stats.trackers.filter((t) => !t.archived);
  const days = stats.days;

  // Everything else is read off the days that were filled in, so thin
  // logging outranks any single tracker's problem.
  if (days > 0 && stats.daysLogged < days * 0.5) {
    out.push({
      score: 95,
      level: "warn",
      focus: "Log every day first",
      why: `Only ${stats.daysLogged} of ${days} days are filled in — the rest of this page is reading half a story.`,
      how: "The ⚡ quick log at 11 PM takes under a minute. Blank days can't be judged, fixed or celebrated.",
    });
  }

  for (const t of active) {
    const s = stats.summary[t.id];
    if (!s) continue;
    const type = t.type as TrackerType;

    if (type === "sleep") {
      out.push(...sleepAdvice(t, s));
      continue;
    }
    if (type === "streak") {
      const a = streakAdvice(t, s, days);
      if (a) out.push(a);
      continue;
    }
    if (type === "prayer") {
      const a = prayerAdvice(t, s);
      if (a) out.push(a);
      continue;
    }
    const a = goalAdvice(t, s);
    if (a) {
      out.push(a);
      continue;
    }
    const h = habitTrendAdvice(t, s, days);
    if (h) out.push(h);
  }

  return out.sort((a, b) => b.score - a.score);
}
