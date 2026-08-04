import type { Period } from "./dates";
import type { Tracker } from "./trackers";

/** The shape `/api/stats` returns, shared by everything that reads it. */

export type Bucket = {
  key: string;
  label: string;
  values: Record<string, number>;
  counts: Record<string, number>;
  quality: Record<string, { sum: number; n: number }>;
};

export type StreakInfo = {
  /** Days clean right now, counting today. */
  current: number;
  /** The longest run ever recorded for this tracker. */
  best: number;
  /** How many slips are on record, all time. */
  slips: number;
  lastSlip: string | null;
  /** The first day ever logged for this tracker. */
  since: string | null;
};

export type Summary = {
  sum: number;
  days: number;
  best: number;
  bestDate: string | null;
  avgPerDay: number;
  avgPerLoggedDay: number;
  goal: { met: number; total: number } | null;
  previous: { sum: number; days: number; value: number };
  changePct: number | null;
  /** Only set for clean-streak trackers, and counted over all time. */
  streak: StreakInfo | null;
};

export type Stats = {
  period: Period;
  start: string;
  end: string;
  days: number;
  granularity: "day" | "week" | "month";
  trackers: Tracker[];
  buckets: Bucket[];
  summary: Record<string, Summary>;
  streak: number;
  daysLogged: number;
  prevDaysLogged: number;
  hasEntries: boolean;
};
