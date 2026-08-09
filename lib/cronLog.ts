import { db } from "./db";

/**
 * A record of every scheduled run.
 *
 * A cron job that silently stops is the worst kind of broken: the only symptom
 * is the absence of something, which is exactly what nobody notices. So each
 * run writes a row — including the ones that fail — and the Account page reads
 * the latest one back and says how long ago it was.
 *
 * Rows expire after 30 days via the TTL index in `lib/db.ts`.
 */

/** The name the nightly reminder is filed under. */
export const REMINDER_JOB = "reminders";

export type CronRun = {
  job: string;
  startedAt: Date;
  finishedAt: Date | null;
  ok: boolean;
  tookMs: number | null;
  checked: number | null;
  notified: number | null;
  /** Asks that had something specific to say — a milestone, a challenge, a run. */
  stakes: number | null;
  skipped: number | null;
  /** Sunday runs only: how many week-in-review pushes went out. */
  digests: number | null;
  error: string | null;
};

export type RunCounts = Partial<
  Pick<CronRun, "checked" | "notified" | "stakes" | "skipped" | "digests">
>;

/**
 * Record the outcome of a run. Never throws: a failure to write the log must
 * not turn a working reminder into a broken one.
 */
export async function recordRun(
  job: string,
  startedAt: Date,
  result: { ok: boolean; error?: string } & RunCounts
): Promise<void> {
  try {
    const finishedAt = new Date();
    const d = await db();
    await d.collection("cronRuns").insertOne({
      job,
      startedAt,
      finishedAt,
      ok: result.ok,
      tookMs: finishedAt.getTime() - startedAt.getTime(),
      checked: result.checked ?? null,
      notified: result.notified ?? null,
      stakes: result.stakes ?? null,
      skipped: result.skipped ?? null,
      digests: result.digests ?? null,
      error: result.error ?? null,
    });
  } catch (err) {
    console.error("Could not record cron run:", err);
  }
}

/** How the Account page reports on the schedule. */
export type CronHealth = {
  /** No run has ever been recorded — either it's new, or it has never fired. */
  everRan: boolean;
  lastRunAt: string | null;
  lastRunOk: boolean;
  lastError: string | null;
  notified: number | null;
  hoursAgo: number | null;
  /** True once it's been long enough that a daily job should have run again. */
  overdue: boolean;
  /** Failures among the last few runs, so one flake doesn't read as an outage. */
  recentFailures: number;
};

/** A daily job gets a couple of hours' grace before it counts as late. */
const OVERDUE_HOURS = 26;

export async function cronHealth(job: string): Promise<CronHealth> {
  const empty: CronHealth = {
    everRan: false,
    lastRunAt: null,
    lastRunOk: false,
    lastError: null,
    notified: null,
    hoursAgo: null,
    overdue: false,
    recentFailures: 0,
  };

  try {
    const d = await db();
    const runs = await d
      .collection("cronRuns")
      .find({ job })
      .sort({ startedAt: -1 })
      .limit(5)
      .toArray();

    if (runs.length === 0) return empty;

    const last = runs[0];
    const startedAt = last.startedAt instanceof Date ? last.startedAt : new Date();
    const hoursAgo = (Date.now() - startedAt.getTime()) / 3_600_000;

    return {
      everRan: true,
      lastRunAt: startedAt.toISOString(),
      lastRunOk: Boolean(last.ok),
      lastError: last.error ? String(last.error) : null,
      notified: typeof last.notified === "number" ? last.notified : null,
      hoursAgo: Math.round(hoursAgo * 10) / 10,
      overdue: hoursAgo > OVERDUE_HOURS,
      recentFailures: runs.filter((r) => !r.ok).length,
    };
  } catch (err) {
    console.error("Could not read cron health:", err);
    return empty;
  }
}
