import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { clientIp, guard } from "@/lib/rateLimit";
import { COOKIE_NAME, cookieOptions, hashPassword, signSession } from "@/lib/auth";

/** Consume a reset token and set a new password. */
export async function POST(req: Request) {
  // The token is 32 random bytes, so this isn't guessable — but an unbounded
  // endpoint that hashes and queries on every call still shouldn't exist.
  const blocked = await guard(
    [{ action: "reset", subject: clientIp(req) }],
    "reset attempts"
  );
  if (blocked) return blocked;

  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 }
    );
  }
  if (!token) {
    return NextResponse.json({ error: "This link is not valid" }, { status: 400 });
  }

  const resetTokenHash = createHash("sha256").update(token).digest("hex");
  const d = await db();
  const user = await d.collection("users").findOne({
    resetTokenHash,
    resetExpires: { $gt: new Date() },
  });

  if (!user) {
    return NextResponse.json(
      { error: "This link has expired or was already used. Request a new one." },
      { status: 400 }
    );
  }

  await d.collection("users").updateOne(
    { _id: user._id },
    {
      $set: { passwordHash: hashPassword(password) },
      $unset: { resetTokenHash: "", resetExpires: "" },
    }
  );

  // Signed in straight away, so there's no second step.
  const res = NextResponse.json({ ok: true, name: user.name });
  res.cookies.set(COOKIE_NAME, await signSession(String(user._id)), cookieOptions);
  return res;
}
