import { NextResponse } from "next/server";
import { dbReady } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { COOKIE_NAME, cookieOptions, verifyPassword } from "@/lib/auth";

/**
 * Delete an account, and everything that was ever in it.
 *
 * The most destructive thing this app can do, so it is the most guarded:
 *
 * 1. **The current password**, checked against the stored hash. A session
 *    cookie proves the browser was logged in once; it does not prove the
 *    person holding the phone right now is the owner. Everything else here
 *    is recoverable by re-typing it. This is not.
 * 2. **A typed phrase**, `delete my account`, the same shape as the guard on
 *    deleting a single tracker — because muscle memory for "type the scary
 *    words" is a feature, and because a confirm dialog is one mis-tap.
 * 3. It says the **counts** back before it happens, from the client's own
 *    read of `/api/export` — the person should see the size of what they are
 *    about to lose, in days and entries, not in the abstract.
 *
 * There is no soft delete and no grace period, deliberately. "We keep it for
 * 30 days in case you change your mind" means the data was not deleted, and
 * the honest thing an app can say when someone asks for their record to be
 * gone is that it is gone. Export first — the button sits right above this
 * one, and the confirmation says so.
 */

/** The words that have to be typed, exactly. */
export const DELETE_PHRASE = "delete my account";

/** Everything keyed to a user. Missing one here would orphan rows for ever. */
const OWNED = [
  "entries",
  "trackers",
  "dayNotes",
  "tasks",
  "books",
  "challenges",
  "restDays",
  "aiReviews",
  "weeklyReviews",
  "pushSubs",
] as const;

export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  const phrase =
    typeof body?.confirm === "string" ? body.confirm.trim().toLowerCase() : "";

  if (phrase !== DELETE_PHRASE) {
    return NextResponse.json(
      { error: `Type “${DELETE_PHRASE}” exactly to confirm` },
      { status: 400 }
    );
  }

  const d = await dbReady();
  const user = await d.collection("users").findOne({ _id: userId });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!password || !verifyPassword(password, String(user.passwordHash))) {
    return NextResponse.json(
      { error: "That password doesn't match this account" },
      { status: 403 }
    );
  }

  // The owned rows first, then the account itself. In this order a failure
  // half-way leaves an account that still owns its data and can be deleted
  // again; the other order leaves rows nobody can ever reach or remove.
  const deleted: Record<string, number> = {};
  for (const name of OWNED) {
    const res = await d.collection(name).deleteMany({ userId });
    deleted[name] = res.deletedCount ?? 0;
  }
  await d.collection("users").deleteOne({ _id: userId });

  // The session is meaningless now, but a cookie pointing at a user that no
  // longer exists would leave the browser in a state where every page
  // bounces to /login without ever saying why.
  const out = NextResponse.json({ ok: true, deleted });
  out.cookies.set(COOKIE_NAME, "", { ...cookieOptions, maxAge: 0 });
  return out;
}
