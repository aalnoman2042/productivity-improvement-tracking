import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";

/**
 * Update your own profile. The email address is fixed at sign-up — it's the
 * identity the account and its password reset are tied to — so any email in
 * the request is refused rather than quietly ignored.
 */
export async function PATCH(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);

  const d = await db();
  const user = await d.collection("users").findOne({ _id: userId });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (
    typeof body?.email === "string" &&
    body.email.trim().toLowerCase() !== user.email
  ) {
    return NextResponse.json(
      { error: "Your email can't be changed after sign-up" },
      { status: 403 }
    );
  }

  if (typeof body?.name !== "string") {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  const name = body.name.trim();
  if (!name || name.length > 60) {
    return NextResponse.json({ error: "Enter your name" }, { status: 400 });
  }

  await d.collection("users").updateOne({ _id: userId }, { $set: { name } });
  return NextResponse.json({ ok: true, name });
}
