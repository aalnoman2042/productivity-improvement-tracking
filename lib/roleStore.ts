import type { Db, ObjectId } from "mongodb";
import { askAI, aiConfigured } from "./ai";
import { hit } from "./rateLimit";
import {
  deserializeAi,
  parseRoleAnswer,
  roleFacts,
  roleSystemPrompt,
  serializeAi,
} from "./roleAI";
import { toTracker } from "./trackerDoc";
import type { Tracker } from "./trackers";
import {
  buildMap,
  cleanOverrides,
  signatureOf,
  type Assignment,
  type Overrides,
  type RoleMap,
} from "./trackerRoles";

/**
 * Where the role map lives, and when it needs re-reading.
 *
 * Two things are stored on the account and nothing else is: the **AI's last
 * answer**, and the reader's **manual overrides**. The rules are recomputed
 * every time because they are pure and instant, and a cached copy of a pure
 * function is just a second place for it to be wrong.
 *
 * **When the AI re-runs.** By itself, on whichever of these comes first:
 *
 * - the tracker list changed (`signature` no longer matches — a tracker
 *   renamed, added, archived, recategorised, or its habit flag flipped), or
 * - the answer is older than `AI_MAX_AGE_DAYS`.
 *
 * Nobody is asked. The old design put it behind a button because it spends
 * from a shared free-tier allowance, but a button is the wrong shape for
 * this: the answer to "what does the tracker called Tuition mean" does not
 * change often enough to be worth a decision, and a page that shows worse
 * numbers until you press something is a page that shows worse numbers.
 * Weekly plus on-change is roughly one request per person per week, which
 * the budget in `lib/rateLimit` absorbs without noticing.
 *
 * A stale answer is not a useless one. It still labels every tracker that
 * did not change, so it keeps being used right up until a fresh one lands —
 * and if the AI is unreachable, or the quota is spent, it simply keeps being
 * used and nothing on the page breaks.
 */

/** How long an answer stands before it is re-read. */
export const AI_MAX_AGE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type RoleState = {
  map: RoleMap;
  trackers: Tracker[];
  /**
   * The AI's stored answer, before the merge.
   *
   * Kept separately because the merged map is lossy on purpose: an AI
   * assignment that lost its tracker to a confident rule is not in `map` at
   * all. Rebuilding the AI list from `map` would therefore delete those
   * answers the first time anybody set an override — a bug that would only
   * show up as roles quietly going missing days later.
   */
  ai: Assignment[];
  /** True when the AI's answer predates the current tracker list. */
  stale: boolean;
  /** True when the AI has never run for this account. */
  never: boolean;
  /** Days since the AI last ran, or null if it never has. */
  ageDays: number | null;
  /**
   * Whether it should re-read now — never run, tracker list changed, or the
   * answer has aged out. The route acts on this without asking anybody.
   */
  due: boolean;
  overrides: Overrides;
};

/**
 * Pure so the cadence can be tested without a clock or a database. `now` is
 * passed in for the same reason every other date in this codebase is.
 */
export function isDue(
  aiAt: string | null,
  stale: boolean,
  now: number
): { due: boolean; ageDays: number | null } {
  if (aiAt === null) return { due: true, ageDays: null };
  const at = Date.parse(aiAt);
  // An unparseable timestamp is treated as no timestamp rather than as
  // NaN days old, which would compare false against everything and wedge
  // the refresh off forever.
  if (!Number.isFinite(at)) return { due: true, ageDays: null };
  const ageDays = Math.max(0, (now - at) / DAY_MS);
  return { due: stale || ageDays >= AI_MAX_AGE_DAYS, ageDays };
}

export async function loadRoleState(
  d: Db,
  userId: ObjectId,
  now = Date.now()
): Promise<RoleState> {
  const [trackerDocs, user] = await Promise.all([
    d.collection("trackers").find({ userId }).sort({ order: 1 }).toArray(),
    d.collection("users").findOne({ _id: userId }, { projection: { health: 1 } }),
  ]);

  const trackers = trackerDocs.map(toTracker) as Tracker[];
  const stored = (user?.health ?? null) as {
    roles?: unknown;
    overrides?: unknown;
    signature?: unknown;
    aiAt?: unknown;
  } | null;

  const ai = deserializeAi(stored?.roles);
  const overrides = cleanOverrides(stored?.overrides, trackers);
  const aiAt =
    stored?.aiAt instanceof Date
      ? stored.aiAt.toISOString()
      : typeof stored?.aiAt === "string"
        ? stored.aiAt
        : null;

  const signature = signatureOf(trackers);
  const storedSignature = typeof stored?.signature === "string" ? stored.signature : null;
  // Nothing to be stale about until there is an answer to be stale.
  const stale = ai.length > 0 && storedSignature !== signature;
  const { due, ageDays } = isDue(aiAt, stale, now);

  return {
    map: buildMap(trackers, ai, overrides, aiAt),
    trackers,
    ai,
    stale,
    never: aiAt === null,
    ageDays,
    // A person with no trackers has nothing to read, and asking a model to
    // label an empty list is a request spent on nothing.
    due: due && trackers.some((t) => !t.archived),
    overrides,
  };
}

/* ------------------------------ the refresh ------------------------------ */

export type Refresh = {
  /** Whether the AI actually ran and the stored answer changed. */
  ran: boolean;
  /** The map to use now — the fresh one when it ran, the old one when not. */
  state: RoleState;
  /** Why it did not run. Shown only when somebody asked for it by hand. */
  error: string | null;
  detected: number;
  model: string | null;
};

/**
 * Re-read what the trackers mean, if it is time to.
 *
 * Called on the ordinary read path, so it has one overriding duty: **it may
 * never take the page down.** Every way this can fail — no key configured, a
 * spent per-person allowance, a spent app-wide budget, a provider outage, a
 * malformed answer — returns the map the account already had and sets
 * `error`. The caller shows that only when a person pressed something; on the
 * automatic path it is swallowed, because a quiet failure to improve a map is
 * not news and the rules have already produced a working one.
 *
 * `force` is the manual path: it skips the due check but keeps every limit,
 * since "I pressed it" is not a reason to overspend a budget shared with
 * everyone else's coach.
 */
export async function refreshRoles(
  d: Db,
  userId: ObjectId,
  state: RoleState,
  options: { force?: boolean; now?: number } = {}
): Promise<Refresh> {
  const force = options.force === true;
  const unchanged = (error: string | null): Refresh => ({
    ran: false,
    state,
    error,
    detected: 0,
    model: null,
  });

  if (!force && !state.due) return unchanged(null);
  if (!aiConfigured()) {
    return unchanged("No AI key is set up, so trackers are matched by name only");
  }
  const live = state.trackers.filter((t) => !t.archived);
  if (live.length === 0) return unchanged("There are no trackers to read yet");

  // Per person, then the whole app. Both are counted here rather than in the
  // route so the automatic path cannot skip a limit the manual one respects.
  const verdict = await hit("roles", String(userId));
  if (!verdict.ok) {
    return unchanged("That has been re-read a few times this hour already — try later");
  }
  const budget = await hit("aiDay", "global");
  if (!budget.ok) {
    return unchanged("The app's shared AI budget for today is spent");
  }

  const answer = await askAI({
    system: roleSystemPrompt(),
    user: JSON.stringify(roleFacts(state.trackers)),
    json: true,
    // Labelling a list of names is not a reasoning problem, and the light
    // model at either provider does it as well as the big one for a fraction
    // of a minute that is capped at 8,000 tokens.
    light: true,
    temperature: 0.1,
    maxTokens: 2000,
  });
  if (!answer.ok) return unchanged(answer.error);

  const ai = parseRoleAnswer(answer.text, state.trackers);
  if (ai.length === 0) {
    return unchanged(
      "The AI answered with nothing it could use — your trackers are still matched by name"
    );
  }

  const now = options.now ?? Date.now();
  const at = new Date(now);
  await d.collection("users").updateOne(
    { _id: userId },
    {
      $set: {
        "health.roles": serializeAi(ai),
        "health.signature": signatureOf(state.trackers),
        "health.aiAt": at,
      },
    }
  );

  const aiAt = at.toISOString();
  return {
    ran: true,
    state: {
      ...state,
      map: buildMap(state.trackers, ai, state.overrides, aiAt),
      ai,
      stale: false,
      never: false,
      ageDays: 0,
      due: false,
    },
    error: null,
    detected: ai.length,
    model: answer.model,
  };
}
