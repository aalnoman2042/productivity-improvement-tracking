import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { guard } from "@/lib/rateLimit";
import {
  COOKIE_NAME,
  cookieOptions,
  hashPassword,
  signSession,
  verifyPassword,
} from "@/lib/auth";

/** Change your password, proving you know the current one. */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Signed in, but the current password is still a secret worth guessing —
  // a borrowed unlocked phone shouldn't get unlimited tries at it.
  const blocked = await guard(
    [{ action: "password", subject: String(userId) }],
    "attempts"
  );
  if (blocked) return blocked;

  const body = await req.json().catch(() => null);
  const current = typeof body?.current === "string" ? body.current : "";
  const next = typeof body?.next === "string" ? body.next : "";

  if (next.length < 8) {
    return NextResponse.json(
      { error: "New password must be at least 8 characters" },
      { status: 400 }
    );
  }

  const d = await db();
  const user = await d.collection("users").findOne({ _id: userId });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!verifyPassword(current, user.passwordHash)) {
    return NextResponse.json(
      { error: "Your current password is wrong" },
      { status: 403 }
    );
  }

  await d.collection("users").updateOne(
    { _id: userId },
    {
      $set: { passwordHash: hashPassword(next) },
      // Any pending reset link is void once the password changes.
      $unset: { resetTokenHash: "", resetExpires: "" },
    }
  );

  // Issue a fresh session so the current device stays signed in.
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, await signSession(String(userId)), cookieOptions);
  return res;
}
