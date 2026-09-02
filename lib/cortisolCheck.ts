/**
 * The monthly cortisol check-up.
 *
 * The daily log knows when you slept and what you ate. It cannot know how
 * long you lay there before sleep came, whether you saw the sun before ten,
 * what time your last coffee was, or whether you are on a rotating shift —
 * and those are among the strongest behavioural correlates of a disrupted
 * cortisol rhythm there are. So they are asked, once a month, and the answers
 * are kept as a dated record rather than as a setting: a check-up in June is
 * a fact about June, and next month gets its own.
 *
 * **The questions are data.** One array defines the form, the scoring and the
 * tests, so the thing being rendered and the thing being scored cannot drift
 * apart — the same reasoning that makes the tracker packs data. Every
 * question carries the pressure each answer puts on the rhythm (0 = none,
 * 1 = as much as that question can express) and a weight saying how much the
 * model lets it matter.
 *
 * Two rules this file will not bend:
 *
 * - **An unanswered question is dropped, never scored as a good answer.**
 *   Weights are renormalised over what was actually answered, so silence
 *   costs coverage instead of buying a better number.
 * - **Illness and medication are not pressures.** Corticosteroids, hormonal
 *   contraception and thyroid medication move real cortisol enormously, and
 *   scoring them as "worse cortisol health" would be both wrong and unkind.
 *   They set a confidence flag that says the model cannot speak to this
 *   person, which is the honest answer.
 */

export type SectionId =
  | "sleep"
  | "morning"
  | "stress"
  | "energy"
  | "screens"
  | "intake"
  | "life";

export const SECTIONS: { id: SectionId; title: string; blurb: string }[] = [
  {
    id: "sleep",
    title: "Falling and staying asleep",
    blurb:
      "How the night starts and whether it holds. Your rating of how rested you felt, and any naps, are read from your log — they are not asked again here.",
  },
  {
    id: "morning",
    title: "The first hour",
    blurb:
      "The sharpest signal in the whole form. The rise you get in the half hour after waking is the part of the rhythm that behaviour moves most.",
  },
  {
    id: "stress",
    title: "Stress and the mind",
    blurb: "What the load actually feels like from inside it.",
  },
  {
    id: "energy",
    title: "Where your energy sits",
    blurb:
      "A rhythm that peaks at midnight is not a broken rhythm; it is a shifted one, and the difference matters.",
  },
  {
    id: "screens",
    title: "Screens and winding down",
    blurb: "The hour before sleep, and what is in it.",
  },
  {
    id: "intake",
    title: "Caffeine and meals",
    blurb:
      "Timing more than amount — caffeine at four in the afternoon is still half-present at bedtime.",
  },
  {
    id: "life",
    title: "Work, body and health",
    blurb:
      "The standing facts. Nothing in the last question is scored — it decides whether the estimate can be trusted at all.",
  },
];

/* ------------------------------ the schema ------------------------------ */

export type Choice = { value: string; label: string; p: number };

type Base = {
  id: string;
  section: SectionId;
  text: string;
  help?: string;
  /** How much this question is allowed to move the score, relative to the rest. */
  weight: number;
};

export type Question =
  | (Base & { kind: "choice"; options: Choice[] })
  | (Base & { kind: "multi"; options: Choice[] })
  | (Base & { kind: "scale"; min: number; max: number; worst: "low" | "high"; lowLabel: string; highLabel: string })
  | (Base & { kind: "number"; unit: string; good: number; bad: number; max: number })
  /** Recorded, never scored. Answers here set the confidence flag instead. */
  | (Base & { kind: "flags"; options: { value: string; label: string }[] });

export type AnswerValue = string | number | string[];
export type Answers = Record<string, AnswerValue>;

const choice = (
  id: string,
  section: SectionId,
  text: string,
  weight: number,
  options: Choice[],
  help?: string
): Question => ({ id, section, text, weight, kind: "choice", options, help });

export const QUESTIONS: Question[] = [
  /* ------------------------------- sleep -------------------------------- */
  choice("onset", "sleep", "How quickly do you fall asleep?", 1, [
    { value: "fast", label: "Less than 15 minutes", p: 0 },
    { value: "ok", label: "15–30 minutes", p: 0.25 },
    { value: "slow", label: "30–60 minutes", p: 0.6 },
    { value: "verySlow", label: "More than an hour", p: 1 },
  ]),
  {
    id: "wakings",
    section: "sleep",
    text: "How many times do you wake during the night?",
    weight: 0.9,
    kind: "number",
    unit: "times",
    good: 0,
    bad: 4,
    max: 20,
  },
  choice("wakeMode", "sleep", "Do you wake naturally, or to an alarm?", 0.7, [
    { value: "natural", label: "Naturally, before the alarm", p: 0 },
    { value: "alarmEasy", label: "To an alarm, but I get up easily", p: 0.4 },
    { value: "alarmHard", label: "To an alarm, and it is a fight", p: 1 },
  ]),

  /* ------------------------------ morning ------------------------------- */
  choice(
    "firstThirty",
    "morning",
    "How do you feel in the first 30 minutes after waking?",
    1.3,
    [
      { value: "energetic", label: "Energetic", p: 0 },
      { value: "normal", label: "Normal", p: 0.35 },
      { value: "tired", label: "Very tired", p: 1 },
    ],
    "This half hour is when the awakening rise happens. A flat, heavy start is the most direct thing you can report about it."
  ),
  choice("fullyAwake", "morning", "How long until you feel fully awake?", 1, [
    { value: "quick", label: "Under 15 minutes", p: 0 },
    { value: "half", label: "15–30 minutes", p: 0.25 },
    { value: "hour", label: "30–60 minutes", p: 0.55 },
    { value: "long", label: "More than an hour", p: 1 },
  ]),
  choice(
    "sunlight",
    "morning",
    "Do you get daylight in the morning?",
    1.1,
    [
      { value: "early", label: "Yes, within an hour of waking", p: 0 },
      { value: "later", label: "Later in the day", p: 0.5 },
      { value: "rarely", label: "Rarely", p: 1 },
    ],
    "Morning light is the single strongest signal your body clock takes. Nothing else on this form moves the rhythm as cheaply."
  ),
  choice("breakfast", "morning", "Do you eat breakfast?", 0.8, [
    { value: "early", label: "Within an hour of waking", p: 0 },
    { value: "later", label: "Later", p: 0.35 },
    { value: "skip", label: "I skip it", p: 0.8 },
  ]),

  /* ------------------------------- stress ------------------------------- */
  {
    id: "stress",
    section: "stress",
    text: "Your average daily stress level",
    weight: 1.3,
    kind: "scale",
    min: 1,
    max: 10,
    worst: "high",
    lowLabel: "calm",
    highLabel: "relentless",
  },
  choice("overwhelmed", "stress", "How often do you feel overwhelmed?", 1.1, [
    { value: "never", label: "Never", p: 0 },
    { value: "sometimes", label: "Sometimes", p: 0.35 },
    { value: "often", label: "Often", p: 0.7 },
    { value: "daily", label: "Almost daily", p: 1 },
  ]),
  choice("unwind", "stress", "Can you relax before sleep?", 0.9, [
    { value: "easy", label: "Easily", p: 0 },
    { value: "sometimes", label: "Some nights it is hard", p: 0.45 },
    { value: "hard", label: "Usually hard", p: 1 },
  ]),
  choice("racing", "stress", "Racing thoughts at night?", 0.9, [
    { value: "no", label: "Rarely or never", p: 0 },
    { value: "some", label: "Some nights", p: 0.45 },
    { value: "most", label: "Most nights", p: 1 },
  ]),
  {
    id: "moodToday",
    section: "stress",
    text: "How is your mood today?",
    weight: 0.8,
    kind: "scale",
    min: 1,
    max: 10,
    worst: "low",
    lowLabel: "low",
    highLabel: "good",
  },

  /* ------------------------------- energy ------------------------------- */
  choice(
    "peakEnergy",
    "energy",
    "When are you most energetic?",
    0.9,
    [
      { value: "morning", label: "Morning", p: 0 },
      { value: "afternoon", label: "Afternoon", p: 0.3 },
      { value: "evening", label: "Evening", p: 0.6 },
      { value: "night", label: "Night", p: 1 },
    ],
    "Cortisol peaks in the morning in a rhythm that is aligned to daylight. Peak energy at midnight usually means the whole curve has shifted late."
  ),
  choice("tiredWhen", "energy", "When do you usually feel tired?", 0.7, [
    { value: "evening", label: "Late evening — as expected", p: 0 },
    { value: "afternoon", label: "Mid-afternoon", p: 0.4 },
    { value: "morning", label: "Mornings, badly", p: 0.85 },
    { value: "always", label: "All day", p: 1 },
  ]),
  choice("crash", "energy", "Do you get an afternoon energy crash?", 0.8, [
    { value: "no", label: "No", p: 0 },
    { value: "mild", label: "Mild", p: 0.4 },
    { value: "strong", label: "Strong, most days", p: 1 },
  ]),
  choice("caffeineToStart", "energy", "Do you need caffeine to start the day?", 0.8, [
    { value: "no", label: "No", p: 0 },
    { value: "sometimes", label: "Sometimes", p: 0.4 },
    { value: "always", label: "I cannot start without it", p: 1 },
  ]),
  choice("afterExercise", "energy", "After exercise, do you feel refreshed or wiped out?", 0.8, [
    { value: "refreshed", label: "Refreshed", p: 0 },
    { value: "neutral", label: "Neither", p: 0.3 },
    { value: "wiped", label: "Wiped out", p: 0.9 },
    { value: "none", label: "I do not exercise", p: 0.5 },
  ]),

  /* ------------------------------ screens ------------------------------- */
  {
    id: "shortForm",
    section: "screens",
    text: "Reels, Shorts and TikTok",
    help: "Hours on a normal day.",
    weight: 0.8,
    kind: "number",
    unit: "h/day",
    good: 0.5,
    bad: 4,
    max: 24,
  },
  {
    id: "gaming",
    section: "screens",
    text: "Gaming",
    weight: 0.5,
    kind: "number",
    unit: "h/day",
    good: 0.5,
    bad: 4,
    max: 24,
  },
  {
    id: "social",
    section: "screens",
    text: "Other social media",
    weight: 0.6,
    kind: "number",
    unit: "h/day",
    good: 0.5,
    bad: 4,
    max: 24,
  },
  choice("phoneCutoff", "screens", "When do you put the phone down before sleep?", 1, [
    { value: "hour", label: "An hour or more before", p: 0 },
    { value: "half", label: "30–60 minutes before", p: 0.35 },
    { value: "late", label: "Under 30 minutes before", p: 0.7 },
    { value: "never", label: "I use it until I fall asleep", p: 1 },
  ]),
  choice("phoneInBed", "screens", "Do you use your phone lying in bed?", 0.8, [
    { value: "no", label: "No", p: 0 },
    { value: "sometimes", label: "Sometimes", p: 0.5 },
    { value: "always", label: "Every night", p: 1 },
  ]),
  {
    id: "stressfulContent",
    section: "screens",
    text: "Do you take any of this to bed with you?",
    help: "Tick everything that applies.",
    weight: 0.9,
    kind: "multi",
    options: [
      { value: "news", label: "News", p: 0.3 },
      { value: "arguments", label: "Arguments or conflict", p: 0.4 },
      { value: "work", label: "Work messages", p: 0.35 },
    ],
  },

  /* ------------------------------- intake ------------------------------- */
  {
    id: "caffeineCups",
    section: "intake",
    text: "Caffeinated drinks a day",
    help: "Coffee, tea and energy drinks together.",
    weight: 1,
    kind: "number",
    unit: "cups",
    good: 1,
    bad: 5,
    max: 30,
  },
  choice(
    "lastCaffeine",
    "intake",
    "When is your last caffeine?",
    1,
    [
      { value: "none", label: "I do not drink it", p: 0 },
      { value: "morning", label: "Before noon", p: 0 },
      { value: "afternoon", label: "Noon to 3 pm", p: 0.3 },
      { value: "late", label: "3 to 6 pm", p: 0.7 },
      { value: "evening", label: "After 6 pm", p: 1 },
    ],
    "Caffeine has a half-life of about five hours. A four o'clock coffee is still half-present at bedtime."
  ),
  choice("lateMeal", "intake", "Do you eat within two hours of sleeping?", 0.7, [
    { value: "rarely", label: "Rarely", p: 0 },
    { value: "sometimes", label: "Sometimes", p: 0.4 },
    { value: "often", label: "Most nights", p: 0.9 },
  ]),
  choice("skipMeals", "intake", "Do you skip meals?", 0.7, [
    { value: "rarely", label: "Rarely", p: 0 },
    { value: "sometimes", label: "Sometimes", p: 0.4 },
    { value: "often", label: "Often", p: 0.9 },
  ]),

  /* -------------------------------- life -------------------------------- */
  choice(
    "schedule",
    "life",
    "What is your work or study schedule?",
    1.4,
    [
      { value: "regular", label: "Regular daytime hours", p: 0 },
      { value: "irregular", label: "Irregular hours", p: 0.55 },
      { value: "evening", label: "Evening or late shifts", p: 0.8 },
      { value: "night", label: "Night shifts, or rotating", p: 1 },
    ],
    "Shift work is the heaviest single item on this form, and it is not a habit anyone chooses lightly — it is here to be accounted for, not to be scolded."
  ),
  {
    id: "heightCm",
    section: "life",
    text: "Height",
    weight: 0,
    kind: "number",
    unit: "cm",
    good: 0,
    bad: 0,
    max: 260,
  },
  {
    id: "weightKg",
    section: "life",
    text: "Weight",
    weight: 0,
    kind: "number",
    unit: "kg",
    good: 0,
    bad: 0,
    max: 400,
  },
  choice("alcohol", "life", "Alcohol", 0.7, [
    { value: "none", label: "None", p: 0 },
    { value: "occasional", label: "Occasionally", p: 0.25 },
    { value: "weekly", label: "Weekly", p: 0.5 },
    { value: "most", label: "Most days", p: 1 },
  ]),
  choice("smoking", "life", "Smoking or nicotine", 0.7, [
    { value: "none", label: "None", p: 0 },
    { value: "occasional", label: "Occasionally", p: 0.4 },
    { value: "daily", label: "Daily", p: 0.9 },
  ]),
  {
    id: "health",
    section: "life",
    text: "Anything ongoing we should know about?",
    help:
      "Not scored. These change real cortisol enough that the estimate should not be read as though they were absent — ticking one makes the page say so.",
    weight: 0,
    kind: "flags",
    options: [
      { value: "none", label: "None of these" },
      { value: "illness", label: "A current illness" },
      { value: "steroid", label: "Steroid medication" },
      { value: "contraception", label: "Hormonal contraception" },
      { value: "thyroid", label: "Thyroid medication" },
      { value: "antidepressant", label: "Antidepressant" },
      { value: "other", label: "Other regular medication" },
      { value: "pregnant", label: "Pregnant" },
    ],
  },
];

/** BMI is derived rather than asked, and only when both numbers are there. */
export function bmiOf(answers: Answers): number | null {
  const h = Number(answers.heightCm);
  const w = Number(answers.weightKg);
  if (!Number.isFinite(h) || !Number.isFinite(w) || h < 80 || w < 20) return null;
  const bmi = w / (h / 100) ** 2;
  return Number.isFinite(bmi) ? Math.round(bmi * 10) / 10 : null;
}

/** Away from the middle in either direction, which is how BMI actually reads. */
function bmiPressure(bmi: number): number {
  if (bmi >= 18.5 && bmi <= 25) return 0;
  const away = bmi < 18.5 ? 18.5 - bmi : bmi - 25;
  return Math.min(1, away / 10);
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The pressure one answer puts on the rhythm, or null when it wasn't given. */
export function pressureOf(q: Question, answer: AnswerValue | undefined): number | null {
  if (answer === undefined || answer === null || answer === "") return null;

  if (q.kind === "choice") {
    const found = q.options.find((o) => o.value === answer);
    return found ? found.p : null;
  }

  if (q.kind === "multi") {
    if (!Array.isArray(answer)) return null;
    const sum = q.options
      .filter((o) => answer.includes(o.value))
      .reduce((s, o) => s + o.p, 0);
    return clamp01(sum);
  }

  if (q.kind === "scale") {
    const v = Number(answer);
    if (!Number.isFinite(v) || v < q.min || v > q.max) return null;
    const span = q.max - q.min;
    const high = (v - q.min) / span;
    return clamp01(q.worst === "high" ? high : 1 - high);
  }

  if (q.kind === "number") {
    const v = Number(answer);
    if (!Number.isFinite(v) || v < 0 || v > q.max) return null;
    if (q.bad === q.good) return null; // height and weight — recorded, not scored
    return clamp01((v - q.good) / (q.bad - q.good));
  }

  // flags — recorded, never scored
  return null;
}

/**
 * What may be stored.
 *
 * Everything that reaches the database goes through here first: unknown keys
 * are dropped, choices must be one of the offered values, numbers must be
 * numbers inside the range the question allows, and a multi-select keeps only
 * options that exist. The route trusts nothing the client sends, and the
 * collection's validator cannot check this shape itself — the questions are
 * data in this file, and a second copy of them in a BSON schema would be a
 * second copy to keep in step.
 */
export function cleanAnswers(raw: unknown): Answers {
  if (!raw || typeof raw !== "object") return {};
  const input = raw as Record<string, unknown>;
  const out: Answers = {};

  for (const q of QUESTIONS) {
    const value = input[q.id];
    if (value === undefined || value === null || value === "") continue;

    if (q.kind === "choice") {
      if (typeof value === "string" && q.options.some((o) => o.value === value)) {
        out[q.id] = value;
      }
      continue;
    }

    if (q.kind === "multi" || q.kind === "flags") {
      if (!Array.isArray(value)) continue;
      const allowed = new Set(q.options.map((o) => o.value));
      const kept = value.filter(
        (v): v is string => typeof v === "string" && allowed.has(v)
      );
      if (kept.length > 0) out[q.id] = kept;
      continue;
    }

    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    if (q.kind === "scale") {
      if (n >= q.min && n <= q.max) out[q.id] = Math.round(n);
    } else if (n >= 0 && n <= q.max) {
      out[q.id] = Math.round(n * 10) / 10;
    }
  }

  return out;
}

/* ------------------------------ the scoring ----------------------------- */

export type SectionScore = {
  id: SectionId;
  title: string;
  /** 0-100, higher is better. Null when nothing in the section was answered. */
  score: number | null;
  answered: number;
  total: number;
};

export type CheckResult = {
  /** 0-100, higher is better. Null when nothing scoreable was answered. */
  score: number | null;
  /** The mean pressure, 0-1 — what the curve and the load index read. */
  pressure: number | null;
  sections: SectionScore[];
  answered: number;
  scoreable: number;
  /** Everything ticked on the health question, verbatim. */
  flags: string[];
  /**
   * False when a health flag is set. The model does not claim to speak for
   * somebody on steroids or hormonal contraception, and saying so is more
   * useful than a confident number that is wrong.
   */
  confident: boolean;
  /** The single worst-scoring answers, worst first. */
  drivers: { id: string; text: string; pressure: number; weight: number }[];
};

/** Questions that carry weight — height, weight and the health flags do not. */
export const SCOREABLE = QUESTIONS.filter((q) => q.weight > 0);

export function scoreCheck(answers: Answers): CheckResult {
  let sum = 0;
  let total = 0;
  let answered = 0;
  const drivers: CheckResult["drivers"] = [];
  const bySection = new Map<SectionId, { sum: number; total: number; answered: number; count: number }>();

  for (const q of QUESTIONS) {
    const bucket =
      bySection.get(q.section) ?? { sum: 0, total: 0, answered: 0, count: 0 };
    if (q.weight > 0) bucket.count += 1;

    const p = pressureOf(q, answers[q.id]);
    if (p !== null && q.weight > 0) {
      sum += p * q.weight;
      total += q.weight;
      answered += 1;
      bucket.sum += p * q.weight;
      bucket.total += q.weight;
      bucket.answered += 1;
      drivers.push({ id: q.id, text: q.text, pressure: p, weight: q.weight });
    }
    bySection.set(q.section, bucket);
  }

  // BMI rides on the same weighting as everything else, but only exists when
  // both numbers were given.
  const bmi = bmiOf(answers);
  if (bmi !== null) {
    const p = bmiPressure(bmi);
    const w = 0.7;
    sum += p * w;
    total += w;
    const bucket = bySection.get("life")!;
    bucket.sum += p * w;
    bucket.total += w;
    bucket.answered += 1;
    bucket.count += 1;
    drivers.push({ id: "bmi", text: "Body mass index", pressure: p, weight: w });
  }

  const raw = Array.isArray(answers.health) ? (answers.health as string[]) : [];
  const known = (
    QUESTIONS.find((q) => q.id === "health") as { options: { value: string }[] }
  ).options.map((o) => o.value);
  // "None of these" is an answer, not a condition — it is what completing the
  // question looks like for the many people who have nothing to report.
  const flags = raw.filter((v) => v !== "none" && known.includes(v));

  const pressure = total === 0 ? null : sum / total;

  return {
    score: pressure === null ? null : Math.round((1 - pressure) * 100),
    pressure,
    sections: SECTIONS.map((s) => {
      const b = bySection.get(s.id);
      return {
        id: s.id,
        title: s.title,
        score:
          !b || b.total === 0 ? null : Math.round((1 - b.sum / b.total) * 100),
        answered: b?.answered ?? 0,
        total: b?.count ?? 0,
      };
    }),
    answered,
    scoreable: SCOREABLE.length,
    flags,
    confident: flags.length === 0,
    drivers: drivers
      .filter((d) => d.pressure > 0.25)
      .sort((a, b) => b.pressure * b.weight - a.pressure * a.weight)
      .slice(0, 5),
  };
}

/**
 * How much the check-up says the awakening *response itself* is blunted.
 *
 * Kept apart from the general load because it moves a different part of the
 * curve. Load raises the evening floor; these take the top off the morning
 * peak, and the published findings behind each are why they are on this list
 * rather than in the general weighting:
 *
 * - A heavy, slow start is the direct report of a flat response.
 * - **Morning daylight** is the strongest zeitgeber the clock takes.
 * - **A screen before sleep reduces the next morning's awakening response** —
 *   which is why phone-in-bed appears here as well as in the load, and it is
 *   the reason the two are not the same term.
 * - **Intensified training blunts the cortisol response** substantially, so
 *   "wiped out after exercise" belongs here and not among the pressures that
 *   push the day upward.
 *
 * 1 means untouched.
 */
export function morningFactor(answers: Answers): number {
  const parts: number[] = [];
  const add = (id: string) => {
    const q = QUESTIONS.find((x) => x.id === id);
    if (!q) return;
    const p = pressureOf(q, answers[id]);
    if (p !== null) parts.push(p);
  };
  add("firstThirty");
  add("fullyAwake");
  add("sunlight");
  add("phoneCutoff");
  add("phoneInBed");
  // Only overtraining blunts the morning; the rest of that question's
  // answers say nothing about it either way.
  if (answers.afterExercise === "wiped") parts.push(1);

  if (parts.length === 0) return 1;
  const mean = parts.reduce((a, b) => a + b, 0) / parts.length;
  // At worst it takes a quarter off the peak — enough to be visible on the
  // chart, nowhere near enough to pretend this is an assay.
  return 1 - 0.25 * mean;
}

/* ----------------------------- completeness ----------------------------- */

/**
 * Every question, answered.
 *
 * The check-up is all-or-nothing on purpose. A partly-filled form scores
 * fine — the weighting renormalises over what is there — and that is exactly
 * the problem: two people can hold the same number while one answered
 * everything and the other answered the four questions that flattered them.
 * Requiring the whole form makes one month's score comparable to the next
 * one's and to anybody else's, which is the only thing that makes a monthly
 * cadence worth having.
 *
 * The scorer still drops unanswered questions rather than assuming them.
 * That path is now unreachable through the form, and it stays because a
 * stored answer sheet from an older version of this list should degrade,
 * not lie.
 */
export function missingFrom(answers: Answers): Question[] {
  return QUESTIONS.filter((q) => {
    const value = answers[q.id];
    if (value === undefined || value === null || value === "") return true;
    if (Array.isArray(value)) return value.length === 0;
    return false;
  });
}

export function isComplete(answers: Answers): boolean {
  return missingFrom(answers).length === 0;
}

/* ------------------------------- cadence -------------------------------- */

/** "2026-09" for a "2026-09-02". */
export function monthOfDate(date: string): string {
  return date.slice(0, 7);
}

/** Whether this month's check-up still has to be done. */
export function checkDue(lastMonth: string | null, today: string): boolean {
  return lastMonth !== monthOfDate(today);
}

/** "September 2026" for a "2026-09". */
export function monthTitle(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function healthBand(score: number | null): string {
  if (score === null) return "not enough answered";
  if (score >= 80) return "strong";
  if (score >= 65) return "sound";
  if (score >= 50) return "strained";
  if (score >= 35) return "under pressure";
  return "heavily loaded";
}

/** What a set health flag means, said once so every surface says it the same. */
export const FLAGGED_NOTE =
  "You told us about a condition or medication that changes real cortisol on its own — steroids, hormonal contraception and thyroid medication especially. The numbers below still describe your habits, but they cannot describe your cortisol, and nothing here should be weighed against a clinician.";
