export type TrackerType =
  | "duration"
  | "sleep"
  | "count"
  | "scale"
  | "check"
  | "measure"
  | "prayer"
  | "streak";

/** Free-form: the presets below are suggestions, not a closed list. */
export type Category = string;

export type Goal = {
  target: number;
  period: "day" | "week";
  direction: "min" | "max";
} | null;

/**
 * Which way the numbers count. "good" is a habit being built (study, water —
 * more is winning); "bad" is one being cut (junk food, smoking — growth means
 * falling behind, and Status says so). Older trackers without the field read
 * as "good", which is exactly how they behaved before it existed.
 */
export type Habit = "good" | "bad";

export type Tracker = {
  id: string;
  name: string;
  type: TrackerType;
  unit: string;
  color: string;
  category: Category;
  goal: Goal;
  habit?: Habit;
  archived: boolean;
  order: number;
};

export { PRAYERS, PRAYER_KEYS, orderPrayers } from "./prayers";

export const TRACKER_TYPES: {
  value: TrackerType;
  label: string;
  hint: string;
  defaultUnit: string;
  /** Charts sum these per day; the others are averaged. */
  aggregate: "sum" | "avg";
}[] = [
  {
    value: "duration",
    label: "Time spent",
    hint: "Hours & minutes, with a stopwatch. For study, work, workouts, reading.",
    defaultUnit: "min",
    aggregate: "sum",
  },
  {
    value: "sleep",
    label: "Sleep",
    hint: "Bedtime and wake time — hours are calculated for you.",
    defaultUnit: "min",
    aggregate: "avg",
  },
  {
    value: "count",
    label: "Count",
    hint: "How many times or how many of something. Water glasses, meals, cigarettes.",
    defaultUnit: "×",
    aggregate: "sum",
  },
  {
    value: "scale",
    label: "Rating 1–5",
    hint: "Rate your day. Mood, energy, diet quality, focus.",
    defaultUnit: "/5",
    aggregate: "avg",
  },
  {
    value: "check",
    label: "Yes / No",
    hint: "Did you do it today? Vitamins, no sugar, meditation.",
    defaultUnit: "",
    aggregate: "sum",
  },
  {
    value: "prayer",
    label: "Namaz — 5 prayers",
    hint: "Tap each prayer you prayed: Fajr, Dhuhr, Asr, Maghrib, Isha.",
    defaultUnit: "",
    aggregate: "avg",
  },
  {
    value: "streak",
    label: "Clean streak",
    hint: "Staying away from something. Mark the day clean, or mark a slip — the streak counts itself.",
    defaultUnit: "",
    aggregate: "sum",
  },
  {
    value: "measure",
    label: "Measurement",
    hint: "A number you record, like body weight or calories.",
    defaultUnit: "kg",
    aggregate: "avg",
  },
];

/** Suggested categories — you can type your own anywhere these appear. */
export const CATEGORIES: { value: Category; label: string; icon: string }[] = [
  { value: "faith", label: "Faith", icon: "🕌" },
  { value: "sleep", label: "Sleep", icon: "🌙" },
  { value: "study", label: "Study", icon: "📚" },
  { value: "work", label: "Work", icon: "💼" },
  { value: "fitness", label: "Fitness", icon: "🏋️" },
  { value: "discipline", label: "Discipline", icon: "🛡️" },
  { value: "food", label: "Food", icon: "🍽️" },
  { value: "health", label: "Health", icon: "❤️" },
  { value: "challenge", label: "Challenge", icon: "🏆" },
  { value: "other", label: "Other", icon: "⭐" },
];

/** Label and icon for any category, preset or made up. */
export function categoryMeta(value: string): { label: string; icon: string } {
  const preset = CATEGORIES.find(
    (c) => c.value.toLowerCase() === value.toLowerCase()
  );
  if (preset) return { label: preset.label, icon: preset.icon };
  return {
    label: value.charAt(0).toUpperCase() + value.slice(1),
    icon: "🏷️",
  };
}

/** Trim and cap a category typed by the user; null if it's empty. */
export function normalizeCategory(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().replace(/\s+/g, " ").slice(0, 30);
  return value.length > 0 ? value : null;
}

/**
 * Grouping order: presets first (so Faith and Sleep stay on top), then any
 * custom categories alphabetically.
 */
export function orderCategories(values: string[]): string[] {
  const seen = new Map<string, string>();
  for (const v of values) {
    const key = v.toLowerCase();
    if (!seen.has(key)) seen.set(key, v);
  }
  const presetOrder = CATEGORIES.map((c) => c.value);
  return [...seen.values()].sort((a, b) => {
    const ai = presetOrder.indexOf(a.toLowerCase());
    const bi = presetOrder.indexOf(b.toLowerCase());
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
}

export function typeMeta(type: TrackerType) {
  return TRACKER_TYPES.find((t) => t.value === type) ?? TRACKER_TYPES[0];
}

/** Types where the unit is fixed by the type itself, so it isn't editable. */
export function hasFixedUnit(type: TrackerType): boolean {
  return ["duration", "sleep", "check", "prayer", "streak"].includes(type);
}

export type Template = {
  name: string;
  type: TrackerType;
  unit: string;
  category: Category;
  color: string;
  goal: Goal;
  habit?: Habit;
};

/** Ready-made trackers, added a whole pack at a time from the Trackers page. */
export const TEMPLATE_PACKS: {
  id: string;
  label: string;
  hint: string;
  items: Template[];
}[] = [
  {
    id: "essentials",
    label: "Essentials",
    hint: "Sleep, study, work, workout, water, junk food, diet and weight.",
    items: [
      {
        name: "Sleep",
        type: "sleep",
        unit: "min",
        category: "sleep",
        color: "#4a3aa7",
        goal: { target: 420, period: "day", direction: "min" },
      },
      {
        name: "Self study",
        type: "duration",
        unit: "min",
        category: "study",
        color: "#2a78d6",
        goal: { target: 180, period: "day", direction: "min" },
      },
      {
        name: "Work",
        type: "duration",
        unit: "min",
        category: "work",
        color: "#1baf7a",
        goal: null,
      },
      {
        name: "Workout",
        type: "duration",
        unit: "min",
        category: "fitness",
        color: "#eb6834",
        goal: { target: 45, period: "day", direction: "min" },
      },
      {
        name: "Water",
        type: "count",
        unit: "glasses",
        category: "food",
        color: "#eda100",
        goal: { target: 8, period: "day", direction: "min" },
      },
      {
        name: "Junk food",
        type: "count",
        unit: "times",
        category: "food",
        color: "#e34948",
        goal: { target: 2, period: "week", direction: "max" },
        habit: "bad",
      },
      {
        name: "Diet quality",
        type: "scale",
        unit: "/5",
        category: "food",
        color: "#e87ba4",
        goal: null,
      },
      {
        name: "Weight",
        type: "measure",
        unit: "kg",
        category: "health",
        color: "#008300",
        goal: null,
      },
    ],
  },
  {
    id: "deen",
    label: "Faith & discipline",
    hint: "Namaz (all five prayers), Quran, and a clean streak for no fap.",
    items: [
      {
        name: "Namaz",
        type: "prayer",
        unit: "",
        category: "faith",
        color: "#008300",
        goal: { target: 5, period: "day", direction: "min" },
      },
      {
        name: "Quran",
        type: "duration",
        unit: "min",
        category: "faith",
        color: "#1baf7a",
        goal: { target: 15, period: "day", direction: "min" },
      },
      {
        name: "No fap",
        type: "streak",
        unit: "",
        category: "discipline",
        color: "#4a3aa7",
        goal: null,
      },
    ],
  },
];

/** The original starter set, kept for the one-click empty-account button. */
export const TEMPLATES: Template[] = TEMPLATE_PACKS[0].items;

/** "7h 30m" for durations, "4/5" for namaz, "8 glasses" for the rest. */
export function formatValue(value: number, type: TrackerType, unit: string): string {
  if (type === "duration" || type === "sleep") {
    const h = Math.floor(value / 60);
    const m = Math.round(value % 60);
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }
  if (type === "check") return value > 0 ? "Done" : "—";
  if (type === "prayer") return `${Math.round(value * 10) / 10}/5`;
  if (type === "streak") {
    if (value <= 0) return "Slip";
    const n = Math.round(value);
    return `${n} clean day${n === 1 ? "" : "s"}`;
  }
  const rounded = Math.round(value * 10) / 10;
  return unit ? `${rounded} ${unit}` : String(rounded);
}

/**
 * The phrase that has to be typed back before a tracker with history is
 * deleted. Built from the name on both sides — the client shows it, the
 * server checks it — so neither can drift from the other.
 */
export function deletePhrase(name: string): string {
  return `delete ${name.trim().toLowerCase()}`;
}

/** Minutes between two HH:MM clock times, wrapping past midnight. */
export function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return mins;
}
