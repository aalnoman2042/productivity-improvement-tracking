import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { clientIp, guard } from "@/lib/rateLimit";
import { emailConfigured, resetEmail, sendEmail } from "@/lib/email";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Work out the site's own address so the link points back here. */
function siteUrl(req: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = new Headers(req.headers);
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function POST(req: Request) {
  if (!emailConfigured()) {
    return NextResponse.json(
      {
        error:
          "Password reset by email isn't set up on this site yet. Ask the owner to reset it for you.",
      },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

  // Always the same answer, so this can't be used to discover which
  // addresses have accounts.
  const done = NextResponse.json({
    ok: true,
    message: "If that email has an account, a reset link is on its way.",
  });

  if (!email) return done;

  // This route sends mail through a personal Gmail account, so it's counted
  // before it does any work — three links an hour is more than anyone
  // genuinely locked out needs, and it keeps the inbox from being a weapon.
  const blocked = await guard(
    [
      { action: "forgot", subject: clientIp(req) },
      { action: "forgotEmail", subject: email },
    ],
    "reset requests"
  );
  if (blocked) return blocked;

  const d = await db();
  const user = await d.collection("users").findOne({ email });
  if (!user) return done;

  const token = randomBytes(32).toString("hex");
  const resetTokenHash = createHash("sha256").update(token).digest("hex");

  await d.collection("users").updateOne(
    { _id: user._id },
    { $set: { resetTokenHash, resetExpires: new Date(Date.now() + TOKEN_TTL_MS) } }
  );

  const link = `${siteUrl(req)}/reset?token=${token}`;
  const mail = resetEmail(user.name as string, link);
  const sent = await sendEmail({ to: email, ...mail });

  if (!sent.ok) console.error("Password reset email failed:", sent.error);

  return done;
}
