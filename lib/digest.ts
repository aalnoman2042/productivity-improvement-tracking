import type { Db, Document, WithId } from "mongodb";
import { ObjectId } from "mongodb";
import { addDays } from "./dates";
import { nightLabel, shiftLabel, toNight } from "./clock";
import { crossedRecently } from "./milestones";
import { streakInfo } from "./streak";
import { PRAYERS, formatValue } from "./trackers";
import { toTracker } from "./trackerDoc";

/**
 * The Sunday-night week in review.
 *
 * The nightly reminder nags; this one is meant to be worth opening — the
 * week's numbers, said the way a friend would say them. It rides the same
 * daily cron as the reminder: when the day a user just finished is a Sunday,
 * the week Mon–Sun is over and there's something to report.
 *
 * Everything here is a number read straight off what was logged. If a week
 * has nothing in it, there is no digest — the reminder already covers "you
 * stopped logging", and a summary of nothing is spam.
 */

export type Digest = {
  title: string;
  body: string;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

type Entry = WithId<Document>;

/** Average bedtime on the night axis for a set of entries, or null. */
function avgBed(entries: Entry[]): { bed: number; nights: number } | null {
  let sum = 0;
  let nights = 0;
  for (const e of entries) {
    const meta = e.meta as { start?: unknown } | null | undefined;
    const bed = toNight(meta?.start);
    if (bed === null) continue;
    sum += bed;
    nights += 1;
  }
  return nights > 0 ? { bed: sum / nights, nights } : null;
}

/** "Sleep 7h 5m a night, bedtime 22 min earlier than last week." */
export function sleepLine(current: Entry[], previous: Entry[]): string | null {
  if (current.length === 0) return null;
  const avg =
    current.reduce((sum, e) => sum + Number(e.value), 0) / current.length;
  let line = `Sleep ${formatValue(avg, "sleep", "min")} a night`;

  const now = avgBed(current);
  const before = avgBed(previous);
  if (now && before && now.nights >= 2 && before.nights >= 2) {
    const shift = shiftLabel(now.bed, before.bed);
    line +=
      shift === "about the same"
        ? ", bedtime about the same as last week"
        : `, bedtime ${shift} than last week`;
  } else if (now) {
    line += `, in bed around ${nightLabel(now.bed)}`;
  }
  return `${line}.`;
}

/** "Namaz 4.1/5 — Fajr missed most (4 of 6 days)." */
export function prayerLine(name: string, current: Entry[]): string | null {
  if (current.length === 0) return null;
  const days = current.length;
  const avg = current.reduce((sum, e) => sum + Number(e.value), 0) / days;

  if (avg >= 4.9) {
    return `${name}: all five prayers, every day you logged.`;
  }

  // Which prayer takes the hit — only days that recorded *which* prayers
  // count, or the gap would be blamed on the wrong one.
  const missed = new Map<string, number>();
  let daysWithParts = 0;
  for (const e of current) {
    const meta = e.meta as { parts?: unknown } | null | undefined;
    if (!Array.isArray(meta?.parts)) continue;
    daysWithParts += 1;
    const prayed = new Set(meta.parts.map(String));
    for (const p of PRAYERS) {
      if (!prayed.has(p.key)) missed.set(p.key, (missed.get(p.key) ?? 0) + 1);
    }
  }

  let worst: { key: string; count: number } | null = null;
  for (const [key, count] of missed) {
    if (!worst || count > worst.count) worst = { key, count };
  }

  if (worst && daysWithParts > 0) {
    const w = worst;
    const label = PRAYERS.find((p) => p.key === w.key)?.label ?? w.key;
    return `${name} ${round1(avg)}/5 — ${label} missed most (${w.count} of ${daysWithParts} days).`;
  }
  return `${name} ${round1(avg)}/5 a day.`;
}

/**
 * "No fap: 12 days clean." Streaks run over all time, so this needs the
 * tracker's whole history, not the week — `streakInfo` is the same maths
 * the stats route uses. A milestone crossed this week gets the fanfare it
 * earned: crossing 30 days and hearing nothing wastes the crossing.
 */
export function streakLine(
  name: string,
  first: string | null,
  slipDates: string[],
  today: string
): string | null {
  if (!first) return null;
  const { current } = streakInfo(first, slipDates, today);

  if (current === 0) return `${name}: the streak reset — back to day one.`;
  const crossed = crossedRecently(current);
  if (crossed !== null) {
    return `🎉 ${name}: past ${crossed} days clean — ${current} and counting.`;
  }
  return `${name}: ${current} day${current === 1 ? "" : "s"} clean.`;
}

/**
 * Build the week-in-review for the week ending `weekEnd` (a Sunday), or null
 * when the week has nothing in it worth sending.
 */
export async function buildDigest(
  d: Db,
  userId: ObjectId,
  weekEnd: string
): Promise<Digest | null> {
  const start = addDays(weekEnd, -6);
  const prevStart = addDays(start, -7);

  const [trackerDocs, entryDocs] = await Promise.all([
    d.collection("trackers").find({ userId, archived: { $ne: true } }).sort({ order: 1 }).toArray(),
    d
      .collection("entries")
      .find({ userId, date: { $gte: prevStart, $lte: weekEnd } })
      .toArray(),
  ]);

  const trackers = trackerDocs.map(toTracker);
  const current = entryDocs.filter((e) => String(e.date) >= start);
  const previous = entryDocs.filter((e) => String(e.date) < start);

  const daysLogged = new Set(current.map((e) => String(e.date))).size;
  if (daysLogged === 0) return null;

  const of = (entries: Entry[], trackerId: string) =>
    entries.filter((e) => String(e.trackerId) === trackerId);

  const lines: string[] = [];

  const sleep = trackers.find((t) => t.type === "sleep");
  if (sleep) {
    const line = sleepLine(of(current, sleep.id), of(previous, sleep.id));
    if (line) lines.push(line);
  }

  const prayer = trackers.find((t) => t.type === "prayer");
  if (prayer) {
    const line = prayerLine(prayer.name, of(current, prayer.id));
    if (line) lines.push(line);
  }

  const streak = trackers.find((t) => t.type === "streak");
  if (streak) {
    const rows = await d
      .collection("entries")
      .aggregate<{ first: string; slips: string[] }>([
        { $match: { userId, trackerId: new ObjectId(streak.id) } },
        {
          $group: {
            _id: "$trackerId",
            first: { $min: "$date" },
            slips: {
              $push: { $cond: [{ $lte: ["$value", 0] }, "$date", "$$REMOVE"] },
            },
          },
        },
      ])
      .toArray();
    if (rows.length > 0) {
      const line = streakLine(
        streak.name,
        rows[0].first ?? null,
        rows[0].slips ?? [],
        weekEnd
      );
      if (line) lines.push(line);
    }
  }

  return {
    title: `Your week: ${daysLogged}/7 days logged`,
    body:
      lines.length > 0
        ? lines.slice(0, 3).join("\n")
        : "Tap to see how the week went on your dashboard.",
  };
}
