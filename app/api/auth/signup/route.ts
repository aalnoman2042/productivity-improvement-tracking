import { NextResponse } from "next/server";
import { dbReady } from "@/lib/db";
import { COOKIE_NAME, cookieOptions, hashPassword, signSession } from "@/lib/auth";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const invite = typeof body?.invite === "string" ? body.invite.trim() : "";

  const expectedInvite = process.env.INVITE_CODE;
  if (!expectedInvite) {
    return NextResponse.json(
      { error: "Sign-up is not configured (INVITE_CODE missing)" },
      { status: 500 }
    );
  }
  if (invite !== expectedInvite) {
    return NextResponse.json({ error: "Invalid invite code" }, { status: 403 });
  }
  if (!name || name.length > 60) {
    return NextResponse.json({ error: "Please enter your name" }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 }
    );
  }

  const d = await dbReady();
  const existing = await d.collection("users").findOne({ email });
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists" },
      { status: 409 }
    );
  }

  const res = await d.collection("users").insertOne({
    email,
    name,
    passwordHash: hashPassword(password),
    createdAt: new Date(),
  });

  const token = await signSession(String(res.insertedId));
  const out = NextResponse.json({ ok: true, name });
  out.cookies.set(COOKIE_NAME, token, cookieOptions);
  return out;
}
