import { ROLES, ROLE_IDS, type Assignment, type Role } from "./trackerRoles";
import type { Tracker } from "./trackers";

/**
 * The AI half of tracker detection — and a careful account of what it is
 * allowed to do.
 *
 * The problem is real and the rules alone cannot finish it. A keyword list
 * knows "Junk food" and "Water". It does not know that "Baje khabar" is junk,
 * that "Doom time" is a screen tracker, that "Chair hours" is sitting, or
 * that someone's tracker called "The Grind" is their desk work. People name
 * their own trackers and they name them like people, not like a schema.
 *
 * So this asks a model. What it asks for is **one label per tracker** and
 * nothing else:
 *
 * - It is sent names, types, units, categories and habit flags. No values, no
 *   dates, no notes, no email — the same line the coach holds, which is that
 *   the model sees what things are called and never what anyone wrote or how
 *   any day went.
 * - It answers with role ids from a closed list. Anything else is dropped by
 *   `parseRoleAnswer` rather than trusted, so a hallucinated role cannot
 *   reach the engine.
 * - It computes **nothing**. Every figure on the health page is arithmetic in
 *   `lib/health.ts` over the days you logged. That is the app's oldest rule
 *   about AI (no number on the coach card comes from the model), and a page
 *   about someone's body is the last place to start bending it.
 *
 * Called once per change to the tracker list — see `signatureOf`. On a free
 * tier of about a thousand requests a day shared by everyone, a detector that
 * ran on every page load would be the most expensive thing in the app and
 * would return the same answer every time.
 */

/** The vocabulary, built from the roles themselves so the two cannot drift. */
function vocabulary(): string {
  return ROLES.map(
    (r) =>
      `- ${r.id} (${r.label}): ${r.feeds} Accepts tracker types: ${
        r.types.length > 0 ? r.types.join(", ") : "any"
      }.`
  ).join("\n");
}

export function roleSystemPrompt(): string {
  return `You label personal-tracking trackers with the health role each one fills.

The person invented these tracker names themselves, in whatever language and shorthand they like. Your entire job is to read a name and say which role it fills, so that arithmetic elsewhere can read the right numbers. You never calculate anything and you never give health advice.

THE ROLES — use these ids and no others:
${vocabulary()}

RULES
1. Answer with one entry per tracker you are confident about. Leave a tracker out entirely rather than guessing; a missing role is handled gracefully, a wrong one silently corrupts a number.
2. One role per tracker. Never assign the same tracker twice.
3. Respect the type. A "scale" tracker is a 1-5 rating and can never be a count of glasses; a "duration" tracker is minutes and can never be a body weight.
4. Roles marked "many" (exercise, sitting, screen, clean) may take several trackers. Every other role takes exactly one — pick the single best fit.
5. Read the habit flag. "bad" means the person is cutting it down, which is what separates junk food from water when both are counts of things eaten.
6. Understand meaning, not spelling. "Hydration", "Water intake", "Glasses", "পানি" and "Drink water" are all water. "Bad food", "Cheat meal", "Outside food", "Baje khabar" and "Junk" are all junk. "Tuition", "Coaching", "Video editing", "Client work" and "Reading" are all sitting, because they are all hours in a chair.
7. Sitting versus screen: if the hours are work or study, it is sitting. If the hours are entertainment on a device, it is screen.
8. Be conservative with "clean" — it is for streak-type trackers about abstaining from a habit, and it is private. Label it and say nothing about it.

Answer with JSON only: {"roles":[{"id":"<tracker id>","role":"<role id>","confidence":0.0-1.0,"why":"<six words or fewer>"}]}`;
}

/** What the model is shown. Names and shape only — never a value, never a note. */
export function roleFacts(trackers: Tracker[]): {
  trackers: {
    id: string;
    name: string;
    type: string;
    unit: string;
    category: string;
    habit: string;
    goal: string | null;
  }[];
} {
  return {
    trackers: trackers
      .filter((t) => !t.archived)
      .map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        unit: t.unit ?? "",
        category: t.category ?? "",
        habit: t.habit ?? "good",
        // The goal says what direction is winning, which is often the clearest
        // evidence of all: "max 2 a day" is a habit being cut.
        goal: t.goal
          ? `${t.goal.direction} ${t.goal.target} per ${t.goal.period}`
          : null,
      })),
  };
}

/** Below this the model is guessing, and a guess is worse than a gap. */
export const AI_FLOOR = 0.5;

/**
 * The model's JSON into assignments, or an empty list.
 *
 * Everything is checked against reality rather than trusted: the tracker id
 * must be one that was sent, the role must be one that exists, the type must
 * be one that role accepts, and the confidence must clear the floor. A model
 * that invents a tracker, invents a role, or calls a 1-5 scale a body weight
 * contributes nothing instead of contributing a wrong number.
 */
export function parseRoleAnswer(raw: string, trackers: Tracker[]): Assignment[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!data || typeof data !== "object") return [];

  const rows = (data as { roles?: unknown }).roles;
  if (!Array.isArray(rows)) return [];

  const byId = new Map(trackers.filter((t) => !t.archived).map((t) => [t.id, t]));
  const seen = new Set<string>();
  const out: Assignment[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;

    const trackerId = typeof r.id === "string" ? r.id : "";
    const tracker = byId.get(trackerId);
    if (!tracker || seen.has(trackerId)) continue;

    const role = typeof r.role === "string" ? (r.role as Role) : null;
    if (!role || !ROLE_IDS.includes(role)) continue;

    const spec = ROLES.find((s) => s.id === role);
    if (!spec) continue;
    // The type check is the one that matters most: it is the difference
    // between a plausible-sounding label and a number read off the wrong row.
    if (spec.types.length > 0 && !spec.types.includes(tracker.type)) continue;

    const confidence = Number(r.confidence);
    const value = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.6;
    if (value < AI_FLOOR) continue;

    const why = typeof r.why === "string" ? r.why.trim().slice(0, 60) : "";

    seen.add(trackerId);
    out.push({
      trackerId,
      role,
      source: "ai",
      confidence: value,
      why: why || "read from the name",
    });
  }

  return out;
}

/** Assignments as stored on the account, and back again. */
export function serializeAi(list: Assignment[]): {
  trackerId: string;
  role: Role;
  confidence: number;
  why: string;
}[] {
  return list.map((a) => ({
    trackerId: a.trackerId,
    role: a.role,
    confidence: a.confidence,
    why: a.why,
  }));
}

export function deserializeAi(raw: unknown): Assignment[] {
  if (!Array.isArray(raw)) return [];
  const out: Assignment[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const trackerId = typeof r.trackerId === "string" ? r.trackerId : "";
    const role = typeof r.role === "string" ? (r.role as Role) : null;
    if (!trackerId || !role || !ROLE_IDS.includes(role)) continue;
    const confidence = Number(r.confidence);
    out.push({
      trackerId,
      role,
      source: "ai",
      confidence: Number.isFinite(confidence) ? confidence : 0.6,
      why: typeof r.why === "string" ? r.why : "read from the name",
    });
  }
  return out;
}
