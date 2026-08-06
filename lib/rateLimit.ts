import { NextResponse } from "next/server";
import { db } from "./db";

/**
 * Attempt limiting for the routes that are reachable without a session.
 *
 * `proxy.ts` waves every `/api/auth/*` request straight through — it has to,
 * since that's where you go to *get* a session — which left password guessing
 * and reset-mail sending unbounded. This is the floor under that: a counter
 * per (action, subject) in a fixed window, kept in MongoDB so it holds across
 * serverless instances rather than resetting whenever a new one warms up.
 *
 * Deliberately simple. It isn't trying to stop a distributed attacker; it's
 * trying to stop one script hammering one endpoint, which is the threat a
 * single-user app with an invite code actually faces.
 */

export type Rule = { limit: number; windowMs: number };

/**
 * Two subjects per route where it's worth it: the address stops one client
 * working through a password list, and the email stops a rotating pool
 * converging on a single account (or pumping one inbox full of reset mail).
 */
export const RULES = {
  login: { limit: 10, windowMs: 15 * 60_000 },
  loginEmail: { limit: 6, windowMs: 15 * 60_000 },
  signup: { limit: 10, windowMs: 60 * 60_000 },
  forgot: { limit: 8, windowMs: 60 * 60_000 },
  forgotEmail: { limit: 3, windowMs: 60 * 60_000 },
  reset: { limit: 10, windowMs: 60 * 60_000 },
  password: { limit: 10, windowMs: 15 * 60_000 },
  // The AI analysis calls a free external API — the cap protects its quota,
  // not the login box. Counted per user, not per address.
  coach: { limit: 10, windowMs: 60 * 60_000 },
} satisfies Record<string, Rule>;

export type Action = keyof typeof RULES;

/**
 * The client's address. On Vercel `x-forwarded-for` is set by the platform
 * and overwrites anything the client sent, so the left-most entry is the real
 * caller and can't be spoofed. Behind a proxy that *doesn't* do that, this
 * header is caller-controlled and the per-address rule becomes advisory —
 * which is why the rules that matter are also counted per account.
 *
 * Locally there's no header at all and everything shares one bucket, which is
 * the right answer for one machine.
 */
export function clientIp(req: Request): string {
  const h = req.headers;
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip")?.trim() || "local";
}

export type Verdict = {
  ok: boolean;
  /** Attempts left in this window, after counting the current one. */
  remaining: number;
  /** Whole seconds until the window resets — what `Retry-After` wants. */
  retryAfter: number;
};

const ALLOW: Verdict = { ok: true, remaining: Infinity, retryAfter: 0 };

/**
 * Count this attempt and say whether it's allowed.
 *
 * One round trip: the upsert resets the window when `resetAt` has passed and
 * increments otherwise, so there's no read-then-write race between two
 * requests arriving together.
 */
export async function hit(
  action: Action,
  subject: string,
  rule: Rule = RULES[action]
): Promise<Verdict> {
  const key = `${action}:${subject}`;
  const now = new Date();

  try {
    const d = await db();
    const row = await d.collection("rateLimits").findOneAndUpdate(
      { _id: key as unknown as never },
      [
        {
          $set: {
            // A window that has run out starts again at 1, rather than
            // carrying yesterday's count into today.
            count: {
              $cond: [
                { $gt: ["$resetAt", now] },
                { $add: [{ $ifNull: ["$count", 0] }, 1] },
                1,
              ],
            },
            resetAt: {
              $cond: [
                { $gt: ["$resetAt", now] },
                "$resetAt",
                new Date(now.getTime() + rule.windowMs),
              ],
            },
          },
        },
      ],
      { upsert: true, returnDocument: "after" }
    );

    const count = Number(row?.count ?? 1);
    const resetAt = row?.resetAt instanceof Date ? row.resetAt : now;
    return {
      ok: count <= rule.limit,
      remaining: Math.max(0, rule.limit - count),
      retryAfter: Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000)),
    };
  } catch (err) {
    // The limiter is a guard rail, not a gate: if the database is unhappy,
    // signing in should still work.
    console.error("Rate limit check failed:", err);
    return ALLOW;
  }
}

/** The 429 to return when `hit` says no. */
export function tooMany(verdict: Verdict, what: string): NextResponse {
  const mins = Math.ceil(verdict.retryAfter / 60);
  return NextResponse.json(
    {
      error: `Too many ${what}. Try again in ${mins === 1 ? "a minute" : `${mins} minutes`}.`,
      retryAfter: verdict.retryAfter,
    },
    { status: 429, headers: { "Retry-After": String(verdict.retryAfter) } }
  );
}

/**
 * Count an attempt against every subject at once and return the first refusal.
 * Written as one pass so a caller can't check the address and forget the email.
 */
export async function guard(
  checks: { action: Action; subject: string }[],
  what: string
): Promise<NextResponse | null> {
  const verdicts = await Promise.all(
    checks.map((c) => hit(c.action, c.subject))
  );
  const blocked = verdicts.find((v) => !v.ok);
  return blocked ? tooMany(blocked, what) : null;
}
