import type { CortisolReport } from "./cortisol";
import type { Answers } from "./cortisolCheck";
import {
  BLOCK_LIMIT,
  MOVEMENT_WEEKLY,
  SLEEP_TARGET,
  STEPS_TARGET,
  type HealthMetrics,
  type Timing,
} from "./health";
import type { Risk } from "./healthRisk";

/**
 * The tips, as data.
 *
 * One array defines what is shown, when it is shown and how it is ranked, so
 * a tip cannot say something the numbers above it disagree with: every entry
 * carries a `when` that reads the same metrics the page prints, and a `why`
 * built *from* those metrics rather than written about them. A tip with no
 * numbers in it is a fortune cookie, and this app has a rule about those.
 *
 * Ranking is by how much the thing is currently costing, not by how easy it
 * is to say. The list is capped when it is rendered — twenty pieces of
 * advice is the same as none.
 *
 * Nothing here is medical advice. These are the ordinary, boring,
 * well-established behavioural levers — stand up, drink water, get daylight,
 * stop drinking coffee at four — attached to the specific numbers in this
 * account that suggest them.
 */

export type TipContext = {
  m: HealthMetrics;
  cortisol: CortisolReport | null;
  check: Answers | null;
  risks: Risk[];
  timings: Timing[];
};

export type Tip = {
  id: string;
  topic: string;
  icon: string;
  /** The instruction. */
  title: string;
  /** What is actually happening — always the numbers it came from. */
  why: (c: TipContext) => string;
  /** The first concrete step, small enough to do today. */
  how: (c: TipContext) => string;
  /** Whether it applies at all. */
  when: (c: TipContext) => boolean;
  /** Higher goes first. Read as "how much is this costing right now". */
  score: (c: TipContext) => number;
};

export type ReadyTip = {
  id: string;
  topic: string;
  icon: string;
  title: string;
  why: string;
  how: string;
  score: number;
};

const hours = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
};

const riskPct = (c: TipContext, id: string) =>
  c.risks.find((r) => r.id === id)?.pct ?? 0;

const timing = (c: TipContext, id: string) =>
  c.timings.find((t) => t.id === id)?.time ?? null;

const answer = (c: TipContext, id: string): string | null => {
  const v = c.check?.[id];
  return typeof v === "string" && v !== "" ? v : null;
};

export const TIPS: Tip[] = [
  /* ------------------------- sitting, back, posture ---------------------- */
  {
    id: "breakTheBlock",
    topic: "Sitting",
    icon: "🪑",
    title: "Break the block, not the workload",
    // Half again past the top of the 30-60 minute break guidance, which is
    // where a block stops being "a long session" and starts being the finding.
    when: (c) => (c.m.sedentary.avgLongestBlock ?? 0) >= BLOCK_LIMIT * 1.5,
    score: (c) => 70 + riskPct(c, "back") * 0.4,
    why: (c) =>
      `Your longest unbroken desk session averages ${hours(c.m.sedentary.avgLongestBlock ?? 0)}, across ${c.m.sedentary.daysRead} days read. The guidance is to break sitting every 30-60 minutes, and the block is what the back actually feels — the daily total matters less than how it arrives.`,
    how: (c) =>
      `Stand up ${Math.max(2, Math.round((c.m.sedentary.avgLongestBlock ?? 0) / 45))} times through that session. Thirty seconds each — it is not a break from the work, it is a change of posture.`,
  },
  {
    id: "deskSetup",
    topic: "Sitting",
    icon: "🖥️",
    title: "Fix the setup once, not the posture every hour",
    when: (c) => (c.m.sedentary.avgSedentaryMinutes ?? 0) >= 6 * 60,
    score: (c) => 55 + riskPct(c, "back") * 0.2,
    why: (c) =>
      `${hours(c.m.sedentary.avgSedentaryMinutes ?? 0)} a day in a chair is a lot of hours for a setup to be slightly wrong in. Screen top at eye level, elbows at about 90 degrees, feet flat — the three that cost nothing.`,
    how: () =>
      "Raise the screen on whatever is nearest — a stack of books works — until the top edge is level with your eyes. It is the single change that stops the neck doing the holding.",
  },
  {
    id: "walkOffset",
    topic: "Sitting",
    icon: "🚶",
    title: "Walk against the sitting, deliberately",
    when: (c) =>
      (c.m.sedentary.avgSedentaryMinutes ?? 0) >= 8 * 60 &&
      (c.m.movement.weeklyMinutes ?? 0) < MOVEMENT_WEEKLY,
    score: (c) => 78 + riskPct(c, "back") * 0.2,
    why: (c) =>
      // "null minutes of movement" is what an unguarded interpolation prints
      // for somebody with no movement tracker at all — and saying they did
      // nothing would be scoring a missing input as a zero, which this file's
      // own header forbids. Say which of the two it is.
      c.m.movement.weeklyMinutes === null
        ? `You are over the 8-hour sitting reference on ${c.m.sedentary.heavyDays} of ${c.m.sedentary.daysRead} days read, and nothing here records movement. In the cohort work it is the combination — long sitting AND low activity — that carries the risk, so this page cannot tell whether it applies to you until something logs the other half.`
        : `You are over the 8-hour sitting reference on ${c.m.sedentary.heavyDays} of ${c.m.sedentary.daysRead} days read, with ${c.m.movement.weeklyMinutes} minutes of movement a week against a guideline of ${MOVEMENT_WEEKLY}. In the cohort work it is that combination — long sitting AND low activity — that carries the risk. Either one alone carries much less.`,
    how: (c) =>
      c.m.movement.weeklyMinutes === null
        ? "Add a movement tracker and time it — after the longest desk block is the walk that does two jobs at once."
        : `${Math.ceil((MOVEMENT_WEEKLY - c.m.movement.weeklyMinutes) / 20)} walks of twenty minutes closes the gap. After the longest desk block is the one that does two jobs at once.`,
  },
  {
    id: "eyeBreaks",
    topic: "Eyes",
    icon: "👁️",
    title: "20-20-20 through the long sessions",
    when: (c) => riskPct(c, "eyes") >= 40,
    score: (c) => 50 + riskPct(c, "eyes") * 0.3,
    why: (c) =>
      `About ${hours((c.m.sedentary.avgSittingMinutes ?? 0) + (c.m.sedentary.avgScreenMinutes ?? 0))} a day of near work, longest stretch ${hours(c.m.sedentary.avgLongestBlock ?? 0)}. Symptoms usually start past about two hours continuous.`,
    how: () =>
      "Every 20 minutes, look at something 20 feet away for 20 seconds. It is not a rest break — it lets the focusing muscle let go, which is the part that is tired.",
  },

  /* -------------------------------- sleep -------------------------------- */
  {
    id: "sleepFloor",
    topic: "Sleep",
    icon: "🛏️",
    title: "Get the night back over seven hours",
    when: (c) => c.m.sleep.nights >= 3 && (c.m.sleep.avgMinutes ?? 999) < SLEEP_TARGET,
    score: (c) => 90 + riskPct(c, "sleepDebt") * 0.1,
    why: (c) =>
      `You are averaging ${hours(c.m.sleep.avgMinutes ?? 0)} over ${c.m.sleep.nights} nights, ${c.m.sleep.shortNights} of them under the seven-hour floor. That is ${hours(c.m.sleep.debtMinutes)} owed across the window.`,
    how: (c) => {
      const bed = timing(c, "bed");
      return bed
        ? `Lights out at ${bed} gets you the hours without touching the alarm. Do not jump the whole way — move it back half an hour a week.`
        : "Move the bedtime, not the alarm. The morning already has jobs in it.";
    },
  },
  {
    id: "wakeSteady",
    topic: "Sleep",
    icon: "⏰",
    title: "Pick one wake time and hold it",
    when: (c) => (c.m.sleep.wakeSpread ?? 0) > 45,
    score: (c) => 80 + (c.m.sleep.wakeSpread ?? 0) / 10,
    why: (c) =>
      `Your wake time moves by about ${Math.round(c.m.sleep.wakeSpread ?? 0)} minutes night to night. Sleep-timing variability flattens the cortisol slope on its own, independently of how many hours you get — and the whole curve on this page is anchored to when you wake.`,
    how: (c) =>
      `Fix it at ${timing(c, "daylight")?.split("-")[0] ?? "one time"} every day including the days off. The bedtime follows the wake time on its own within about a week; it does not work the other way round.`,
  },
  {
    id: "weekendDrift",
    topic: "Sleep",
    icon: "📆",
    title: "Close the weekend gap",
    when: (c) => (c.m.sleep.socialJetlag ?? 0) > 60,
    score: (c) => 62 + (c.m.sleep.socialJetlag ?? 0) / 15,
    why: (c) =>
      `Your sleep midpoint shifts about ${Math.round(c.m.sleep.socialJetlag ?? 0)} minutes between working days and free days. That is a small time zone you fly to every weekend and back from every Monday, which is why Monday feels like it does.`,
    how: () =>
      "Cap the lie-in at an hour past the usual wake time. If the debt needs paying, pay it with an earlier night rather than a later morning — one moves the clock, the other does not.",
  },
  {
    id: "daylight",
    topic: "Rhythm",
    icon: "🌞",
    title: "Get daylight in the first hour",
    // An unanswered question is unanswered. Firing this on a null would have
    // the tip telling somebody they "reported" daylight arriving late when
    // they have never been asked — which is the one thing a page built out of
    // the reader's own numbers must never do.
    when: (c) => {
      const said = answer(c, "sunlight");
      if (said !== null) return said !== "early";
      // No check-up answer, but a daylight tracker can say it instead — and
      // a tracker that says it most days means there is nothing to advise.
      const rate = c.m.mind.recoveryRate;
      return rate !== null && rate < 50;
    },
    score: () => 74,
    why: (c) => {
      const said = answer(c, "sunlight");
      if (said === "rarely") {
        return "You reported rarely getting morning daylight. It is the strongest single signal a body clock takes, and nothing else on this page is anywhere near as cheap.";
      }
      if (said !== null) {
        return "You reported daylight arriving later in the day. Timing is most of its effect — the same light at noon does a fraction of what it does at eight.";
      }
      return `Daylight or time outdoors is logged on ${c.m.mind.recoveryRate}% of the window. Timing is most of its effect — the same light at noon does a fraction of what it does at eight.`;
    },
    how: (c) =>
      `Twenty minutes outside between ${timing(c, "daylight") ?? "waking and an hour later"}. Through a window is worth a fraction of it; overcast outdoors still beats a bright room indoors.`,
  },
  {
    id: "napWindow",
    topic: "Sleep",
    icon: "😴",
    title: "Keep the nap short and early",
    when: (c) => c.m.sleep.avgNapMinutes > 45,
    score: (c) => 40 + c.m.sleep.avgNapMinutes / 10,
    why: (c) =>
      `You are averaging ${Math.round(c.m.sleep.avgNapMinutes)} minutes of nap a day. Past about 30 the nap starts borrowing from the night rather than topping up the day, and it lands hardest on how long you take to fall asleep.`,
    how: () =>
      "Twenty minutes, before the middle of the afternoon. Set an alarm for the nap itself — the difference between a top-up and a debt is entirely in the length.",
  },

  /* ------------------------------ substances ----------------------------- */
  {
    id: "caffeineCutoff",
    topic: "Caffeine",
    icon: "☕",
    title: "Draw a line under the coffee",
    when: (c) =>
      c.m.substances.lastCaffeine === "evening" ||
      c.m.substances.lastCaffeine === "afternoon" ||
      (c.m.substances.caffeinePerDay ?? 0) >= 4,
    score: (c) =>
      (c.m.substances.lastCaffeine === "evening" ? 78 : 58) +
      (c.m.substances.caffeinePerDay ?? 0),
    why: (c) =>
      `${c.m.substances.caffeinePerDay ?? "Several"} cups a day, last one in the ${c.m.substances.lastCaffeine ?? "afternoon"}. 400 mg taken six hours before bed measurably shortened sleep in controlled trials — in people who said they had not noticed a thing.`,
    how: (c) => {
      const cut = timing(c, "caffeine");
      return cut
        ? `Nothing after ${cut}, which is six hours before your usual lights-out. The cup itself is not the problem; the hour is.`
        : "Nothing within six hours of bed.";
    },
  },
  {
    id: "screensDown",
    topic: "Rhythm",
    icon: "📵",
    title: "Screens down before bed",
    when: (c) =>
      answer(c, "phoneInBed") === "always" ||
      answer(c, "phoneInBed") === "sometimes" ||
      answer(c, "phoneCutoff") === "inBed",
    score: (c) => 66 + riskPct(c, "onset") * 0.2,
    why: () =>
      "Evening screen use tracks a blunted cortisol awakening response the next morning — so this is a morning decision made the night before, which is the part that makes it worth doing.",
    how: (c) =>
      `Phone out of the room from ${timing(c, "screens") ?? "an hour before bed"}. Charging it anywhere but arm's reach does more than any amount of resolve.`,
  },

  /* ------------------------------ hydration ------------------------------ */
  {
    id: "waterGap",
    topic: "Water",
    icon: "💧",
    title: "Close the water gap",
    when: (c) => riskPct(c, "dehydration") >= 25,
    score: (c) => 55 + riskPct(c, "dehydration") * 0.3,
    why: (c) =>
      c.m.hydration.targetMl
        ? `About ${c.m.hydration.avgGlasses} glasses a day against a target of ${c.m.hydration.targetGlasses} — ${c.m.hydration.deficitMl} ml short, worked out at 35 ml per kg of your own body weight rather than from the eight-glasses rule.`
        : `About ${c.m.hydration.avgGlasses} glasses a day. Add a body weight and this becomes your own target instead of everybody's.`,
    how: (c) =>
      `One glass with each meal covers most of it. A full glass by the kettle before the first coffee covers the rest — you are ${Math.max(1, Math.ceil((c.m.hydration.targetGlasses ?? 8) - (c.m.hydration.avgGlasses ?? 0)))} short a day.`,
  },

  /* ------------------------------ nutrition ------------------------------ */
  {
    id: "junkFrequency",
    topic: "Food",
    icon: "🍟",
    title: "Move junk from most days to one",
    when: (c) => (c.m.nutrition.junkPerWeek ?? 0) >= 3,
    score: (c) => 50 + (c.m.nutrition.junkPerWeek ?? 0) * 5,
    why: (c) =>
      `Junk on about ${c.m.nutrition.junkPerWeek} days a week. What moves the numbers here is the frequency rather than any one meal — this page reads it as load, not as a failure of character.`,
    how: () =>
      "Pick the two days it happens most and plan those two only. Cutting a frequency works; cutting a food does not last past the first bad evening.",
  },
  {
    id: "breakfast",
    topic: "Food",
    icon: "🍳",
    title: "Eat something within an hour of waking",
    when: (c) => answer(c, "breakfast") === "skip",
    score: (c) => 48 + riskPct(c, "crash") * 0.2,
    why: () =>
      "You reported skipping breakfast. It shows up on this page through the afternoon rather than the morning — the crash risk here reads it as one of its five inputs.",
    how: () =>
      "Protein rather than volume, and within the hour. It does not have to be a meal; it has to be something.",
  },
  {
    id: "lateMeal",
    topic: "Food",
    icon: "🌙",
    title: "Move the last meal earlier",
    when: (c) => answer(c, "lateMeal") === "late",
    score: () => 44,
    why: () =>
      "You reported eating late. A late meal raises the evening cortisol floor at exactly the hour the curve is supposed to be at its lowest, which is the shape this whole page is built around.",
    how: (c) =>
      `Aim to finish about three hours before ${timing(c, "bed") ?? "bed"}. Moving it earlier is easier than making it smaller.`,
  },

  /* ------------------------------ movement ------------------------------- */
  {
    id: "movementGap",
    topic: "Movement",
    icon: "🏃",
    title: "Get the week to 150 minutes",
    when: (c) =>
      c.m.movement.weeklyMinutes !== null && c.m.movement.weeklyMinutes < MOVEMENT_WEEKLY,
    score: (c) => 72 + (MOVEMENT_WEEKLY - (c.m.movement.weeklyMinutes ?? 0)) / 10,
    why: (c) =>
      `${c.m.movement.weeklyMinutes} minutes a week against the ${MOVEMENT_WEEKLY}-minute guideline, over ${c.m.movement.activeDays} active days. The gap between none and some is much larger than the gap between some and lots.`,
    how: (c) =>
      `${Math.ceil((MOVEMENT_WEEKLY - (c.m.movement.weeklyMinutes ?? 0)) / 30)} more half-hour walks a week. Attach them to something that already happens — after the last desk block, before the first meal.`,
  },
  {
    id: "steps",
    topic: "Movement",
    icon: "👟",
    title: "Get the background walking up",
    when: (c) => (c.m.movement.avgSteps ?? STEPS_TARGET) < STEPS_TARGET * 0.7,
    score: (c) => 46 + (STEPS_TARGET - (c.m.movement.avgSteps ?? 0)) / 300,
    why: (c) =>
      `About ${Math.round(c.m.movement.avgSteps ?? 0).toLocaleString()} steps a day against a reference of around ${STEPS_TARGET.toLocaleString()}, which is where most of the benefit has levelled off in the cohort work.`,
    how: () =>
      "This one is not won in the gym. Get off a stop early, take the stairs, walk while on calls — background steps are the ones that add up without needing a decision.",
  },
  {
    id: "overtraining",
    topic: "Movement",
    icon: "🥵",
    title: "Take a real rest day",
    when: (c) => (c.m.movement.weeklyMinutes ?? 0) > 600,
    score: (c) => 60 + ((c.m.movement.weeklyMinutes ?? 0) - 600) / 30,
    why: (c) =>
      `${c.m.movement.weeklyMinutes} minutes a week is well past the guideline's top end. Movement is read as a U here rather than a ramp — intensified training blunts the cortisol response, so past a point more of it flattens the same curve that none of it does.`,
    how: () =>
      "One full day off a week, and it counts as training. If the streak is the reason it hasn't happened, that is the streak costing you the thing it was for.",
  },

  /* -------------------------------- mind --------------------------------- */
  {
    id: "windDown",
    topic: "Stress",
    icon: "🧘",
    title: "Give the evening a landing",
    when: (c) => riskPct(c, "onset") >= 45 || answer(c, "unwind") === "hard",
    score: (c) => 58 + riskPct(c, "onset") * 0.2,
    // Three different reasons this can fire, and it must say the one that is
    // actually true: a reported answer is only quoted back when it was given.
    why: (c) => {
      const racing = answer(c, "racing");
      if (racing === "often" || racing === "always") {
        return `You reported thoughts racing at night, with a bedtime that varies by about ${Math.round(c.m.sleep.bedSpread ?? 0)} minutes. Onset delay is the most reliably fixable thing on this page, and it is nearly always the hour before rather than the hour itself.`;
      }
      if (answer(c, "unwind") === "hard") {
        return "You reported finding it hard to unwind before sleep. The evening cortisol floor is the one thing on this page that responds directly rather than through something else.";
      }
      return `The onset pattern reads ${riskPct(c, "onset")}% — caffeine timing, screens and a bedtime that moves by about ${Math.round(c.m.sleep.bedSpread ?? 0)} minutes, taken together.`;
    },
    how: () =>
      "Ten minutes of slow breathing, same time, same chair. Boring on purpose — the value is entirely in it being the same every night.",
  },
  {
    id: "lowMood",
    topic: "Mind",
    icon: "🧠",
    title: "Three low days is worth naming",
    when: (c) => c.m.mind.lowMoodDays >= 3,
    score: (c) => 64 + c.m.mind.lowMoodDays * 2,
    why: (c) =>
      `${c.m.mind.lowMoodDays} days at 2 or below out of ${c.m.mind.daysRead} rated. This page reads that as a flatter evening slope and nothing more — it is not a diagnosis and it is not trying to be one.`,
    how: () =>
      "Sleep and daylight are the two levers here that this app can actually see. If it is holding for weeks rather than days, that is a conversation with a person rather than an app.",
  },

  /* ----------------------------- burnout, load --------------------------- */
  {
    id: "stacking",
    topic: "Load",
    icon: "🔥",
    title: "Several things are pulling the same way",
    when: (c) => riskPct(c, "burnout") >= 55,
    score: (c) => 85 + riskPct(c, "burnout") * 0.1,
    why: (c) => {
      const burnout = c.risks.find((r) => r.id === "burnout");
      // Copied before sorting: `drivers` is the same array the page renders,
      // and sorting it in place would quietly reorder what the reader sees.
      const top = [...(burnout?.drivers ?? [])].sort((a, b) => b.share - a.share)[0];
      return `Burnout pressure reads ${burnout?.pct ?? 0}%, and it is a combination rather than any one thing${top ? ` — ${top.label.toLowerCase()} at ${top.value} is carrying the most of it` : ""}. Each of these alone would be unremarkable.`;
    },
    how: () =>
      "Take the largest driver only. Fixing one properly moves this number more than touching all five, and five simultaneous changes is how a fortnight ends with none of them.",
  },
  {
    id: "streakHolding",
    topic: "Discipline",
    icon: "🛡️",
    title: "The streak is holding",
    when: (c) => c.m.discipline.currentStreak >= 7,
    score: (c) => 30 + c.m.discipline.currentStreak / 2,
    why: (c) =>
      `${c.m.discipline.currentStreak} days, against a best of ${c.m.discipline.longestStreak} and a clean rate of ${c.m.discipline.cleanRate}% across the window.`,
    how: () =>
      "Nothing to change. It is here because a page of things to fix with nothing that is working is a false picture of a fortnight.",
  },
  {
    id: "sleepSolid",
    topic: "Sleep",
    icon: "✅",
    title: "The sleep is doing its job",
    when: (c) =>
      c.m.sleep.nights >= 5 &&
      (c.m.sleep.avgMinutes ?? 0) >= SLEEP_TARGET &&
      (c.m.sleep.wakeSpread ?? 999) <= 45,
    score: () => 25,
    why: (c) =>
      `${hours(c.m.sleep.avgMinutes ?? 0)} a night across ${c.m.sleep.nights} nights, waking within about ${Math.round(c.m.sleep.wakeSpread ?? 0)} minutes of the same time. Both halves of the reference, which is rarer than the hours alone.`,
    how: () =>
      "Keep the wake time. It is the anchor everything else on this page is measured from, and it is the thing most likely to slip first.",
  },
];

/**
 * The tips that apply, best first.
 *
 * `limit` exists because the honest number of things worth changing at once
 * is about three. The rest are still computed — they are simply not the
 * thing to read today.
 */
export function tipsFor(c: TipContext, limit = 8): ReadyTip[] {
  return TIPS.filter((t) => {
    try {
      return t.when(c);
    } catch {
      // A tip that throws on a shape it did not expect is a missing tip,
      // never a broken page. The rest of the list is still worth showing.
      return false;
    }
  })
    .map((t) => ({
      id: t.id,
      topic: t.topic,
      icon: t.icon,
      title: t.title,
      why: t.why(c),
      how: t.how(c),
      score: Math.round(t.score(c)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
