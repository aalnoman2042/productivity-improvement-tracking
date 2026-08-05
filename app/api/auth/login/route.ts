import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clientIp, guard } from "@/lib/rateLimit";
import { COOKIE_NAME, cookieOptions, signSession, verifyPassword } from "@/lib/auth";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  // Counted per address *and* per account: one machine can't work through a
  // password list, and a pool of addresses can't gang up on one email.
  const blocked = await guard(
    [
      { action: "login", subject: clientIp(req) },
      ...(email ? [{ action: "loginEmail" as const, subject: email }] : []),
    ],
    "sign-in attempts"
  );
  if (blocked) return blocked;

  const d = await db();
  const user = await d.collection("users").findOne({ email });

  // Same message either way — don't reveal which emails have accounts.
  const bad = NextResponse.json(
    { error: "Wrong email or password" },
    { status: 401 }
  );
  if (!user || !verifyPassword(password, user.passwordHash)) return bad;

  const token = await signSession(
    String(user._id),
    user.passwordChangedAt instanceof Date ? user.passwordChangedAt : null
  );
  const out = NextResponse.json({ ok: true, name: user.name });
  out.cookies.set(COOKIE_NAME, token, cookieOptions);
  return out;
}
