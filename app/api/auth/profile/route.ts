import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";

/** Update your own name and/or email. */
export async function PATCH(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const set: Record<string, string> = {};

  if (typeof body?.name === "string") {
    const name = body.name.trim();
    if (!name || name.length > 60) {
      return NextResponse.json({ error: "Enter your name" }, { status: 400 });
    }
    set.name = name;
  }

  if (typeof body?.email === "string") {
    const email = body.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid email" }, { status: 400 });
    }
    set.email = email;
  }

  if (Object.keys(set).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const d = await db();

  if (set.email) {
    const taken = await d
      .collection("users")
      .findOne({ email: set.email, _id: { $ne: userId } });
    if (taken) {
      return NextResponse.json(
        { error: "Another account already uses that email" },
        { status: 409 }
      );
    }
  }

  await d.collection("users").updateOne({ _id: userId }, { $set: set });
  return NextResponse.json({ ok: true, ...set });
}
