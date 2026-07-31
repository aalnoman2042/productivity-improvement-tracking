export type TrackerType =
  | "duration"
  | "sleep"
  | "count"
  | "scale"
  | "check"
  | "measure";

/** Free-form: the presets below are suggestions, not a closed list. */
export type Category = string;

export type Goal = {
  target: number;
  period: "day" | "week";
  direction: "min" | "max";
} | null;

export type Tracker = {
  id: string;
  name: string;
  type: TrackerType;
  unit: string;
  color: string;
  category: Category;
  goal: Goal;
  archived: boolean;
  order: number;
};

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
    value: "measure",
    label: "Measurement",
    hint: "A number you record, like body weight or calories.",
    defaultUnit: "kg",
    aggregate: "avg",
  },
];

/** Suggested categories — you can type your own anywhere these appear. */
export const CATEGORIES: { value: Category; label: string; icon: string }[] = [
  { value: "sleep", label: "Sleep", icon: "🌙" },
  { value: "study", label: "Study", icon: "📚" },
  { value: "work", label: "Work", icon: "💼" },
  { value: "fitness", label: "Fitness", icon: "🏋️" },
  { value: "food", label: "Food", icon: "🍽️" },
  { value: "health", label: "Health", icon: "❤️" },
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
 * Grouping order: presets first (so Sleep stays on top), then any custom
 * categories alphabetically.
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

/** One-click starter trackers, offered on an empty account. */
export const TEMPLATES: {
  name: string;
  type: TrackerType;
  unit: string;
  category: Category;
  color: string;
  goal: Goal;
}[] = [
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
];

/** "7h 30m" for durations, "8 glasses" / "4.2 /5" for everything else. */
export function formatValue(value: number, type: TrackerType, unit: string): string {
  if (type === "duration" || type === "sleep") {
    const h = Math.floor(value / 60);
    const m = Math.round(value % 60);
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }
  if (type === "check") return value > 0 ? "Done" : "—";
  const rounded = Math.round(value * 10) / 10;
  return unit ? `${rounded} ${unit}` : String(rounded);
}

/** Minutes between two HH:MM clock times, wrapping past midnight. */
export function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return mins;
}
