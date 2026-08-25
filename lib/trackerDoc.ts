import type { Document, WithId } from "mongodb";
import type { Goal, Habit } from "./trackers";
import { parseTarget, type Target } from "./targets";

/**
 * Converting a stored tracker to the shape the client sees, and validating a
 * goal on the way in.
 *
 * These live here rather than in the route that uses them most: a `route.ts`
 * is only allowed to export request handlers, so anything shared between two
 * routes has to sit outside them.
 */

export function toTracker(doc: WithId<Document>) {
  return {
    id: String(doc._id),
    name: doc.name as string,
    type: doc.type as string,
    unit: doc.unit as string,
    color: doc.color as string,
    category: doc.category as string,
    goal: (doc.goal ?? null) as Goal,
    // The client only needs the times of day; lastSentFor is the cron's.
    reminder: (doc.reminder?.times ?? null) as string[] | null,
    // Whether those times are the ones typed or today's waqts. Sent as its
    // own field rather than folded into `reminder`, so every caller that
    // only ever wanted a list of times still gets exactly that.
    reminderMode: (doc.reminder
      ? doc.reminder.mode === "prayer"
        ? "prayer"
        : "fixed"
      : null) as "fixed" | "prayer" | null,
    // Trackers from before the field read as "good" — how they always behaved.
    habit: (doc.habit === "bad" ? "bad" : "good") as Habit,
    // Null on every tracker that isn't walking towards anything, which is
    // most of them: a target is the exception, not the default.
    target: parseTarget(doc.target) as Target | null,
    archived: Boolean(doc.archived),
    order: Number(doc.order ?? 0),
  };
}

export { parseTarget } from "./targets";

/** Validate an incoming habit flag; anything unclear is "good". */
export function parseHabit(raw: unknown): Habit {
  return raw === "bad" ? "bad" : "good";
}

/** Validate an incoming goal object; returns null for "no goal". */
export function parseGoal(raw: unknown): Goal {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  const target = Number(g.target);
  if (!Number.isFinite(target) || target <= 0) return null;
  const period = g.period === "week" ? "week" : "day";
  const direction = g.direction === "max" ? "max" : "min";
  return { target, period, direction };
}
