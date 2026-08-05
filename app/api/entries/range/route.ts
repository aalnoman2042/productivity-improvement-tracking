import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { isValidDateStr } from "@/lib/dates";

/** Longest span that can be wiped in one go — a slip shouldn't cost years. */
const MAX_RANGE_DAYS = 400;

function readRange(url: string): { from: string; to: string } | null {
  const params = new URL(url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  if (!isValidDateStr(from) || !isValidDateStr(to) || from > to) return null;
  return { from, to };
}

function spanDays(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
  ) + 1;
}

/**
 * What a delete would actually remove: `?from=YYYY-MM-DD&to=YYYY-MM-DD`.
 * The count it returns is what the confirmation phrase is built from, so
 * nobody can confirm a deletion without having seen its size.
 */
export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const range = readRange(req.url);
  if (!range) {
    return NextResponse.json(
      { error: "from and to must be YYYY-MM-DD, and from can't be after to" },
      { status: 400 }
    );
  }
  if (spanDays(range.from, range.to) > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: `That's more than ${MAX_RANGE_DAYS} days — narrow the range` },
      { status: 400 }
    );
  }

  const d = await db();
  const rows = await d
    .collection("entries")
    .find(
      { userId, date: { $gte: range.from, $lte: range.to } },
      { projection: { date: 1, _id: 0 } }
    )
    .toArray();

  const dates = [...new Set(rows.map((r) => String(r.date)))].sort();

  return NextResponse.json({
    from: range.from,
    to: range.to,
    days: dates.length,
    entries: rows.length,
    dates,
  });
}

/**
 * Delete every entry in a date range. Destructive and unrecoverable, so it
 * asks for three things that a stray tap can't supply on its own:
 * the range, the exact number of days the caller was shown, and the typed
 * phrase. A mismatch between `days` and what's really there means the data
 * changed since they looked — refuse and make them look again.
 *
 * Body: { from, to, days, confirm: "delete N days" }
 */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const from = body?.from;
  const to = body?.to;

  if (!isValidDateStr(from) || !isValidDateStr(to) || from > to) {
    return NextResponse.json(
      { error: "from and to must be YYYY-MM-DD, and from can't be after to" },
      { status: 400 }
    );
  }
  if (spanDays(from, to) > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: `That's more than ${MAX_RANGE_DAYS} days — narrow the range` },
      { status: 400 }
    );
  }

  const d = await db();
  const filter = { userId, date: { $gte: from, $lte: to } };
  const rows = await d
    .collection("entries")
    .find(filter, { projection: { date: 1 } })
    .toArray();
  const dates = [...new Set(rows.map((r) => String(r.date)))];

  if (dates.length === 0) {
    return NextResponse.json(
      { error: "There's nothing logged in that range" },
      { status: 400 }
    );
  }

  if (Number(body?.days) !== dates.length) {
    return NextResponse.json(
      {
        error: "That range has changed since you checked it — review it again",
        days: dates.length,
      },
      { status: 409 }
    );
  }

  const phrase = `delete ${dates.length} ${dates.length === 1 ? "day" : "days"}`;
  if (String(body?.confirm ?? "").trim().toLowerCase() !== phrase) {
    return NextResponse.json(
      { error: `Type "${phrase}" to confirm`, phrase },
      { status: 400 }
    );
  }

  const res = await d.collection("entries").deleteMany(filter);

  return NextResponse.json({
    ok: true,
    days: dates.length,
    entries: res.deletedCount,
    dates: dates.sort(),
  });
}
