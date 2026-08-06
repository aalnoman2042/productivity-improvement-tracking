import type { Document, WithId } from "mongodb";
import type { Goal, Habit } from "./trackers";

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
    // Trackers from before the field read as "good" — how they always behaved.
    habit: (doc.habit === "bad" ? "bad" : "good") as Habit,
    archived: Boolean(doc.archived),
    order: Number(doc.order ?? 0),
  };
}

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
