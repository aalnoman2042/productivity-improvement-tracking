import { clockToMinutes } from "./clock";
import type { CortisolDay, CortisolSources } from "./cortisol";
import { napMinutes, type Nap } from "./draft";
import { blankDay, type HealthDay } from "./health";
import { GLASS_ML } from "./water";
import { minutesBetween, type Tracker, type TrackerType } from "./trackers";
import { trackerFor, trackersFor, type RoleMap } from "./trackerRoles";

/**
 * Raw entry rows into days the health engine can read.
 *
 * Pure on purpose. The route's job is to fetch rows and hand them here; every
 * decision about what a row *means* — which night it belongs to, whether a
 * nap counts, whether a streak day held — lives in a function that can be
 * tested without a database, because those are exactly the decisions that go
 * quietly wrong.
 *
 * Two rules it keeps throughout:
 *
 * - **A day with nothing on it is absent, not zero.** Only dates that carry
 *   at least one entry become days. Averaging blanks in would turn a week
 *   off work into a health emergency.
 * - **Several trackers in one role add up; they do not compete.** A run and
 *   a gym session are one day's movement. Editing and tuition are one day's
 *   sitting. The exception is the *longest* block, which is the largest
 *   single tracker rather than the sum — that is the number the back feels.
 */

export type EntryRow = {
  trackerId: string;
  date: string;
  value: number;
  meta: Record<string, unknown> | null;
};

/** The night itself: the clock times when they are there, the value when not. */
function nightOf(
  value: number,
  meta: Record<string, unknown> | null,
  naps: number
): number | null {
  const start = typeof meta?.start === "string" ? meta.start : null;
  const end = typeof meta?.end === "string" ? meta.end : null;
  if (start && end) return minutesBetween(start, end);
  // No clock times — the total is all there is, so take the naps back out
  // rather than counting an afternoon on the sofa as part of the night.
  const rest = value - naps;
  return rest > 0 ? rest : null;
}

/** Every tracker id this map has a use for. What the route needs to fetch. */
export function neededTrackerIds(map: RoleMap): string[] {
  return [...new Set(map.assignments.map((a) => a.trackerId))];
}

/**
 * A 1-5 scale, or null. Scales are the one type where zero is not a value —
 * an unrated day is unrated, and reading it as "1" would be a lie about a
 * mood nobody reported.
 */
const scale = (value: number): number | null => (value > 0 ? value : null);

/**
 * The unit a tracker counts in, normalised.
 *
 * A role says *what* a tracker measures; it does not say what units it
 * measures in, and people pick their own. Somebody logging "Weight" in `lb`
 * and somebody logging it in `kg` are both filling the weight role, and
 * reading 154 lb as 154 kg gives a BMI of 50 and a water target two litres
 * too high. So the value is converted here, once, on the way in — the engine
 * downstream then only ever sees kilograms, glasses and cups.
 */
const unitOf = (t: { unit?: string } | undefined) =>
  (t?.unit ?? "").trim().toLowerCase();

const KG_PER_LB = 0.45359237;
/** One cup of coffee, near enough, for a tracker that counts milligrams. */
const MG_PER_CUP = 95;

export function foldDays(
  rows: EntryRow[],
  map: RoleMap,
  /**
   * The trackers behind the ids. Needed because an entry row carries a number
   * and nothing else: whether that number is minutes or repetitions, pounds
   * or kilograms, a clean day or a slip, is a property of the TRACKER. Every
   * unit bug this function has had came from not having this.
   */
  trackers: Tracker[] = []
): HealthDay[] {
  const sleepId = trackerFor(map, "sleep");
  const roleById = new Map(map.assignments.map((a) => [a.trackerId, a.role]));
  const sittingIds = new Set(trackersFor(map, "sitting"));
  const byId = new Map(trackers.map((t) => [t.id, t]));

  const byDate = new Map<string, HealthDay>();

  for (const row of rows) {
    const date = String(row.date);
    const id = String(row.trackerId);
    const role = roleById.get(id);
    if (!role) continue;

    const value = Number(row.value) || 0;
    const meta = row.meta ?? null;
    const day = byDate.get(date) ?? blankDay(date);
    const tracker = byId.get(id);
    const type: TrackerType | null = tracker?.type ?? null;
    const unit = unitOf(tracker);

    switch (role) {
      case "sleep": {
        if (id !== sleepId) break;
        const naps = napMinutes((meta?.naps ?? null) as Nap[] | null);
        day.napMinutes = naps;
        day.nightMinutes = nightOf(value, meta, naps);
        day.bed = clockToMinutes(meta?.start);
        day.wake = clockToMinutes(meta?.end);
        const q = Number(meta?.quality);
        day.quality = Number.isFinite(q) && q >= 1 && q <= 5 ? q : null;
        break;
      }
      case "water": {
        // Counted in glasses downstream, because that is what the target is
        // worked out in. A tracker that measures millilitres or litres is
        // converted rather than read as a glass count of 800.
        const glasses =
          unit === "ml"
            ? value / GLASS_ML
            : unit === "l" || unit.startsWith("litre") || unit.startsWith("liter")
              ? (value * 1000) / GLASS_ML
              : value;
        day.water = (day.water ?? 0) + glasses;
        break;
      }
      case "diet":
        day.diet = scale(value);
        break;
      case "junk":
        // A STREAK tracker in this role is an abstinence record, so the day
        // it counts is the day it was BROKEN. Reading the held days as junk
        // eaten inverts the meaning completely: a fortnight of eating none at
        // all would score as junk every single day, which is both wrong and
        // the exact opposite of what the person was recording.
        if (type === "streak") {
          day.junk = (day.junk ?? 0) + (meta?.status === "slip" ? 1 : 0);
        } else {
          day.junk = (day.junk ?? 0) + value;
        }
        break;
      case "exercise":
        // Minutes only from a tracker that measures time. A checkbox or a
        // session count is real movement and must not be added to a figure
        // the whole page then judges against 150 MINUTES a week — ticking a
        // box daily would read as 7 minutes and score 5 out of 100.
        if (type === "duration") {
          day.exercise = (day.exercise ?? 0) + value;
        } else if (value > 0) {
          day.exerciseSessions += 1;
        }
        break;
      case "steps":
        day.steps = (day.steps ?? 0) + value;
        break;
      case "mood":
        day.mood = scale(value);
        break;
      case "stress":
        day.stress = scale(value);
        break;
      case "energy":
        day.energy = scale(value);
        break;
      case "sitting":
        day.sitting += value;
        // The unbroken block is the largest single session, not the total:
        // eight hours across four trackers is four sessions, and the back
        // knows the difference even when the clock does not.
        if (sittingIds.has(id)) {
          day.sittingLongest = Math.max(day.sittingLongest, value);
        }
        break;
      case "screen":
        day.screen += value;
        break;
      case "outdoors":
        day.outdoors = (day.outdoors ?? 0) + value;
        break;
      case "caffeine":
        // Cups downstream, since that is what the domain prints and scores.
        // Milligrams is the natural unit to pick — the page's own reference
        // band is stated in milligrams — so it has to be converted, not read
        // as "200 cups a day".
        day.caffeine =
          (day.caffeine ?? 0) + (unit === "mg" ? value / MG_PER_CUP : value);
        break;
      case "smoking":
        // Same inversion as junk: a "quit smoking" streak counts its slips.
        if (type === "streak") {
          day.smoking = (day.smoking ?? 0) + (meta?.status === "slip" ? 1 : 0);
        } else {
          day.smoking = (day.smoking ?? 0) + value;
        }
        break;
      case "clean": {
        // A slip is stored as value 0 *with* meta, so the meta is the answer
        // and the value is not — see `lib/draft`.
        const status = meta?.status;
        if (status === "slip") day.cleanSlipped += 1;
        else if (status === "clean" || value > 0) day.cleanHeld += 1;
        break;
      }
      case "meditation":
        day.meditation = (day.meditation ?? 0) + value;
        break;
      case "prayer":
        day.prayer = value;
        break;
      case "weight": {
        // A measurement, never a sum: two weigh-ins on one day are the same
        // body twice, and the later one is the answer. Converted to kilograms
        // because BMI and the 35 ml/kg water target both assume them, and a
        // pounds figure read as kilograms puts BMI at 50 and the water target
        // two litres high.
        const kg =
          unit === "lb" || unit === "lbs" || unit.startsWith("pound")
            ? value * KG_PER_LB
            : value;
        day.weight = kg > 0 ? Math.round(kg * 10) / 10 : day.weight;
        break;
      }
    }

    byDate.set(date, day);
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The cortisol model's own view of the same roles.
 *
 * `lib/cortisol.ts` has read its inputs through `CortisolSources` since
 * before roles existed, and it is tested against that shape. Rather than
 * change a model that works, the role map is translated into it — so the
 * curve now benefits from AI detection and from a manual override without
 * one line of the model knowing either exists.
 */
export function sourcesFromRoles(map: RoleMap): CortisolSources {
  return {
    sleepId: trackerFor(map, "sleep"),
    dietId: trackerFor(map, "diet"),
    junkId: trackerFor(map, "junk"),
    exerciseIds: trackersFor(map, "exercise"),
    moodId: trackerFor(map, "mood"),
  };
}

/** The same days, reduced to what the cortisol model reads. */
export function toCortisolDays(days: HealthDay[]): CortisolDay[] {
  return days.map((d) => ({
    date: d.date,
    bed: d.bed,
    wake: d.wake,
    nightMinutes: d.nightMinutes,
    napMinutes: d.napMinutes,
    quality: d.quality,
    diet: d.diet,
    junk: d.junk,
    exercise: d.exercise,
    mood: d.mood,
  }));
}
