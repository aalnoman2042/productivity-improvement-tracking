import { NextResponse } from "next/server";
import { ObjectId, type AnyBulkWriteOperation } from "mongodb";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { isValidDateStr } from "@/lib/dates";

const HHMM = /^\d{2}:\d{2}$/;

export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const date = params.get("date");
  if (!isValidDateStr(date)) {
    return NextResponse.json({ error: "date=YYYY-MM-DD required" }, { status: 400 });
  }

  const d = await db();
  const rows = await d.collection("entries").find({ userId, date }).toArray();
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

    // Sleep entries carry clock times; everything else is just a number.
    let meta: Record<string, unknown> | null = null;
    if (e?.meta && typeof e.meta === "object") {
      const m = e.meta as Record<string, unknown>;
      const start = typeof m.start === "string" && HHMM.test(m.start) ? m.start : null;
      const end = typeof m.end === "string" && HHMM.test(m.end) ? m.end : null;
      const q = Number(m.quality);
      const quality = Number.isFinite(q) && q >= 1 && q <= 5 ? Math.round(q) : null;
      if (start || end || quality) meta = { start, end, quality };
    }

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

  const d = await db();
  if (ops.length > 0) await d.collection("entries").bulkWrite(ops);
  return NextResponse.json({ ok: true });
}
