import { NextResponse } from "next/server";
import { ObjectId, type AnyBulkWriteOperation } from "mongodb";
import { db, dbReady } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { formatMinutes, isBeyondToday, isValidDateStr } from "@/lib/dates";
import { DAY_MINUTES } from "@/lib/draft";
import { parseMeta } from "@/lib/entryMeta";

export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const date = params.get("date");
  if (!isValidDateStr(date)) {
    return NextResponse.json({ error: "date=YYYY-MM-DD required" }, { status: 400 });
  }

  const d = await db();
  const rows = await d
    .collection("entries")
    .find(
      { userId, date },
      { projection: { trackerId: 1, value: 1, note: 1, meta: 1, _id: 0 } }
    )
    .toArray();
  return NextResponse.json(
    rows.map((r) => ({
      trackerId: String(r.trackerId),
      value: Number(r.value),
      note: r.note ?? null,
      meta: r.meta ?? null,
    }))
  );
}

/**
 * Save one day at once.
 * Body: { date, entries: [{ trackerId, value, meta?, note? }] }
 * A value of 0 (with no sleep times) clears that tracker's entry for the day.
 */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const date = body?.date;
  const entries = body?.entries;
  if (!isValidDateStr(date) || !Array.isArray(entries)) {
    return NextResponse.json({ error: "Bad body" }, { status: 400 });
  }
  // A day that hasn't happened yet cannot have been lived. The daily page
  // offers tomorrow for *planning* — tasks only — and this is what makes
  // that safe: the refusal lives on the server, where no client can skip it.
  if (isBeyondToday(date)) {
    return NextResponse.json(
      { error: "That day hasn't happened yet — you can only plan it" },
      { status: 400 }
    );
  }

  const now = new Date();
  const ops: AnyBulkWriteOperation[] = [];

  for (const e of entries) {
    if (typeof e?.trackerId !== "string" || !ObjectId.isValid(e.trackerId)) {
      return NextResponse.json({ error: "Bad trackerId" }, { status: 400 });
    }
    const value = Number(e?.value);
    if (!Number.isFinite(value) || value < 0 || value > 100000) {
      return NextResponse.json(
        { error: "Value must be a number between 0 and 100000" },
        { status: 400 }
      );
    }

    const filter = { userId, trackerId: new ObjectId(e.trackerId), date };
    const meta = parseMeta(e?.meta);

    // Nothing recorded and nothing extra attached — clear the day.
    // A slip is *not* nothing: it arrives as value 0 with a status, so it
    // has meta and survives this check.
    if (value === 0 && !meta) {
      ops.push({ deleteOne: { filter } });
      continue;
    }

    const note =
      typeof e?.note === "string" && e.note.trim()
        ? e.note.trim().slice(0, 300)
        : null;

    ops.push({
      updateOne: {
        filter,
        update: {
          $set: { value, meta, note, updatedAt: now },
          $setOnInsert: { createdAt: now },
        },
        upsert: true,
      },
    });
  }

  const d = await dbReady();

  // A day only has 24 hours — strictly. Judge the day as it would stand
  // after this save: incoming time values win over stored ones, and every
  // minute-counted tracker (time spent and sleep) shares the same budget.
  const timeDocs = await d
    .collection("trackers")
    .find(
      { userId, type: { $in: ["duration", "sleep"] } },
      { projection: { _id: 1 } }
    )
    .toArray();
  const timeIds = new Set(timeDocs.map((t) => String(t._id)));
  const incoming = new Map<string, number>();
  for (const e of entries) {
    if (timeIds.has(String(e.trackerId))) {
      incoming.set(String(e.trackerId), Number(e.value));
    }
  }
  if (incoming.size > 0) {
    const stored = await d
      .collection("entries")
      .find(
        { userId, date, trackerId: { $in: timeDocs.map((t) => t._id) } },
        { projection: { trackerId: 1, value: 1 } }
      )
      .toArray();
    const storedByTracker = new Map(
      stored.map((r) => [String(r.trackerId), Number(r.value)])
    );
    let total = 0;
    for (const id of timeIds) {
      total += incoming.get(id) ?? storedByTracker.get(id) ?? 0;
    }
    if (total > DAY_MINUTES) {
      return NextResponse.json(
        {
          error: `A day only has 24 hours — this would put ${date} at ${formatMinutes(total)} of logged time`,
        },
        { status: 400 }
      );
    }
  }

  if (ops.length > 0) await d.collection("entries").bulkWrite(ops);
  return NextResponse.json({ ok: true });
}
