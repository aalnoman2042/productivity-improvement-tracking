import { NextResponse } from "next/server";
import { dbReady } from "@/lib/db";
import { clientIp, guard } from "@/lib/rateLimit";
import { COOKIE_NAME, cookieOptions, hashPassword, signSession } from "@/lib/auth";

export async function POST(req: Request) {
  // Counted before the invite code is even checked — otherwise this is a
  // free oracle for guessing it.
  const blocked = await guard(
    [{ action: "signup", subject: clientIp(req) }],
    "sign-up attempts"
  );
  if (blocked) return blocked;

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const invite = typeof body?.invite === "string" ? body.invite.trim() : "";

  /**
   * The invite code stopped being a door and became a key to one room.
   *
   * Anyone may have an account: the log, the charts, the score, the grades,
   * the report card and the export are arithmetic on your own numbers and
   * cost nothing to run. What the code buys is the **AI coach**, which runs
   * on a single shared free-tier allowance that cannot be divided between
   * strangers (`lib/access.ts`).
   *
   * A *wrong* code is still refused rather than quietly downgraded: someone
   * typing one meant to use one, and silently handing them a lesser account
   * would be the app deciding not to mention it. An *empty* one is simply
   * somebody signing up.
   */
  const expectedInvite = process.env.INVITE_CODE;
  if (invite && invite !== expectedInvite) {
    return NextResponse.json({ error: "Invalid invite code" }, { status: 403 });
  }
  const invited = Boolean(expectedInvite) && invite === expectedInvite;
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
    invited,
    createdAt: new Date(),
  });

  const token = await signSession(String(res.insertedId));
  const out = NextResponse.json({ ok: true, name });
  out.cookies.set(COOKIE_NAME, token, cookieOptions);
  return out;
}
