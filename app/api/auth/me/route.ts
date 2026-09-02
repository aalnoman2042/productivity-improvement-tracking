import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { isAdminEmail } from "@/lib/admin";
import { canSeeHealth } from "@/lib/access";

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const d = await db();
  const user = await d
    .collection("users")
    .findOne({ _id: userId }, { projection: { name: 1, email: 1, invited: 1 } });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({
    id: String(user._id),
    name: user.name,
    email: user.email,
    // Shows the Admin doorway on the Account page. Cosmetic only — the
    // admin API re-checks the email itself on every request.
    admin: isAdminEmail(user.email),
    // Shows the Health doorway. Invited members while it is in testing —
    // the page reads your trackers with the shared AI allowance — and
    // everyone once HEALTH_OPEN is set. The routes decide either way.
    health: canSeeHealth(user),
  });
}
