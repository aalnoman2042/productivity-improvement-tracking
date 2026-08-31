import type { Period } from "./dates";
import type { Tracker } from "./trackers";

/** The shape `/api/stats` returns, shared by everything that reads it. */

/**
 * When a night started and ended, averaged over whatever the bucket covers.
 * Both are on the night axis (minutes since 18:00) — see `lib/clock.ts`.
 */
export type SleepClock = {
  nights: number;
  bed: number;
  wake: number;
};

export type Bucket = {
  key: string;
  label: string;
  values: Record<string, number>;
  counts: Record<string, number>;
  quality: Record<string, { sum: number; n: number }>;
  /** Sleep trackers only, and only for nights with both times filled in. */
  clock: Record<string, SleepClock>;
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

/** The period's bedtimes and wake times, for sleep trackers. */
export type ClockSummary = SleepClock & {
  earliestBed: number;
  latestBed: number;
  latestBedDate: string | null;
  /** The same average over the period before, so "earlier or later?" has an answer. */
  prevBed: number | null;
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
  /** Only set for sleep trackers, and only when clock times were logged. */
  clock: ClockSummary | null;
};

export type Stats = {
  period: Period;
  /** First day of the calendar unit being shown — 2026-08-01 for August. */
  start: string;
  /** Last day counted: the unit's end, or today while the unit is running. */
  end: string;
  /** The unit's own last day, reached or not. */
  unitEnd: string;
  /** The unit hasn't finished, so `end` stops at today. */
  partial: boolean;
  /**
   * Today falls inside this unit. Streaks, "days clean" and "last slip" are
   * all measured from today, so they may only be *said* when this is true.
   */
  live: boolean;
  /** The first day ever logged — how far back the period picker may go. */
  firstLogged: string | null;
  days: number;
  granularity: "day" | "week" | "month";
  trackers: Tracker[];
  buckets: Bucket[];
  summary: Record<string, Summary>;
  streak: number;
  /** Days inside the period that were flagged as deliberate days off. */
  restDays: number;
  daysLogged: number;
  prevDaysLogged: number;
  hasEntries: boolean;
};
