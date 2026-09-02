import { NextResponse } from "next/server";
import { dbReady } from "@/lib/db";
import { currentHealthUserId } from "@/lib/access";
import { aiConfigured } from "@/lib/ai";
import { loadRoleState, refreshRoles, type RoleState } from "@/lib/roleStore";
import {
  ROLES,
  buildMap,
  cleanOverrides,
  missingRoles,
  roleCoverage,
  type Overrides,
  type Role,
} from "@/lib/trackerRoles";

/**
 * What each tracker means, and who decided.
 *
 * The health page cannot read a field called "hydration" because there is no
 * such field — people name their own trackers. This route is how the names
 * become inputs:
 *
 * - **GET** returns the current map, and **re-reads it with the AI when it is
 *   due** — never run before, the tracker list changed, or the answer is more
 *   than a week old (`lib/roleStore`). Nobody is asked first. The answer to
 *   "what does the tracker called Tuition mean" does not change often enough
 *   to be worth a decision, and a page that shows worse numbers until you
 *   press something is a page that shows worse numbers.
 * - **POST** forces a re-read now, for when somebody has just renamed
 *   something and does not want to wait a week. Same limits.
 * - **PATCH** records a manual override, which beats both forever.
 *
 * **This is the slow route on purpose.** It is deliberately separate from
 * `/api/health`, which the page needs immediately: the numbers paint from the
 * map the account already has while this one does the talking, and when it
 * comes back having changed something it says so (`refreshed`) and the page
 * re-reads itself. Putting a model call on the critical path would trade a
 * fast page every day for a correct one once a week.
 *
 * The model is shown **names, types, units, categories and habit flags** —
 * never a value, never a date, never a note. It answers with labels from a
 * closed list and computes nothing at all; every figure on the health page is
 * arithmetic in `lib/health.ts` over days you logged. That is the app's
 * oldest rule about AI, and a page about somebody's body is the last place to
 * start bending it.
 */

/**
 * Room for one model call plus the round trips around it. The light model
 * answers this prompt in a couple of seconds; the ceiling is here so a slow
 * provider degrades into "kept the old map" rather than into a dead request.
 */
export const maxDuration = 30;

export async function GET() {
  const userId = await currentHealthUserId();
  if (!userId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const d = await dbReady();
  const loaded = await loadRoleState(d, userId);
  // Every failure inside here returns the map the account already had, so
  // this can never be the reason the panel fails to render.
  const refresh = await refreshRoles(d, userId, loaded);

  return NextResponse.json({
    ...describe(refresh.state),
    aiConfigured: aiConfigured(),
    // The page re-reads its numbers when this is true — they were computed
    // from the previous map a moment ago.
    refreshed: refresh.ran,
    detected: refresh.detected,
  });
}

/** Force a re-read now rather than waiting for it to fall due. */
export async function POST() {
  const userId = await currentHealthUserId();
  if (!userId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const d = await dbReady();
  const loaded = await loadRoleState(d, userId);
  const refresh = await refreshRoles(d, userId, loaded, { force: true });

  // Asked for by hand, so the reason it did not happen is worth saying —
  // unlike the automatic path, where a quiet failure to improve a map that
  // already works is not news.
  if (!refresh.ran && refresh.error) {
    return NextResponse.json({ error: refresh.error }, { status: 503 });
  }

  return NextResponse.json({
    ...describe(refresh.state),
    aiConfigured: aiConfigured(),
    refreshed: refresh.ran,
    detected: refresh.detected,
    model: refresh.model,
  });
}

/**
 * A manual override. `role: null` mutes a tracker — "this fills nothing" —
 * which is a real answer and not the same as never having said anything.
 * `clear: true` clears the override and hands the tracker back to the rules
 * and the AI.
 */
export async function PATCH(req: Request) {
  const userId = await currentHealthUserId();
  if (!userId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as {
    trackerId?: unknown;
    role?: unknown;
    clear?: unknown;
  } | null;

  const trackerId = typeof body?.trackerId === "string" ? body.trackerId : "";
  if (!trackerId) {
    return NextResponse.json({ error: "A trackerId is required" }, { status: 400 });
  }

  const d = await dbReady();
  const state = await loadRoleState(d, userId);
  if (!state.trackers.some((t) => t.id === trackerId && !t.archived)) {
    return NextResponse.json({ error: "No such tracker" }, { status: 404 });
  }

  const next: Overrides = { ...state.overrides };
  if (body?.clear === true) {
    delete next[trackerId];
  } else if (body?.role === null) {
    next[trackerId] = null;
  } else {
    const role = typeof body?.role === "string" ? (body.role as Role) : null;
    if (!role || !ROLES.some((r) => r.id === role)) {
      return NextResponse.json({ error: "Unknown role" }, { status: 400 });
    }
    const spec = ROLES.find((r) => r.id === role);
    const tracker = state.trackers.find((t) => t.id === trackerId);
    // The same type check the AI's answer goes through. A 1-5 scale cannot be
    // a count of glasses however anybody insists, and letting it through here
    // would put a rating where a volume belongs.
    if (spec && tracker && spec.types.length > 0 && !spec.types.includes(tracker.type)) {
      return NextResponse.json(
        {
          error: `A "${tracker.type}" tracker can't fill ${spec.label} — that role reads ${spec.types.join(" or ")} trackers`,
        },
        { status: 400 }
      );
    }
    next[trackerId] = role;
  }

  const cleaned = cleanOverrides(next, state.trackers);
  await d
    .collection("users")
    .updateOne({ _id: userId }, { $set: { "health.overrides": cleaned } });

  // The stored AI answer is untouched by an override, so it is taken from
  // `state.ai` rather than from the merged map — the map has already dropped
  // any AI answer that lost its tracker to a rule.
  const map = buildMap(state.trackers, state.ai, cleaned, state.map.aiAt);
  return NextResponse.json({
    ...describe({ ...state, map, overrides: cleaned }),
    aiConfigured: aiConfigured(),
    refreshed: false,
  });
}

/** The shape every method here answers with, so the page has one reader. */
function describe(state: RoleState) {
  return {
    assignments: state.map.assignments,
    aiAt: state.map.aiAt,
    ageDays: state.ageDays === null ? null : Math.round(state.ageDays),
    stale: state.stale,
    never: state.never,
    overrides: state.overrides,
    coverage: roleCoverage(state.map),
    missing: missingRoles(state.map),
    roles: ROLES.map((r) => ({
      id: r.id,
      label: r.label,
      feeds: r.feeds,
      types: r.types,
      many: r.many,
    })),
    trackers: state.trackers
      .filter((t) => !t.archived)
      .map((t) => ({ id: t.id, name: t.name, type: t.type, unit: t.unit })),
  };
}
