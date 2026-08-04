import { NextResponse } from "next/server";
import { ObjectId, type AnyBulkWriteOperation } from "mongodb";
import { db, dbReady } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { isValidDateStr } from "@/lib/dates";
import { PRAYER_KEYS, orderPrayers } from "@/lib/prayers";

const HHMM = /^\d{2}:\d{2}$/;

/**
 * The extras an entry can carry: sleep clock times, which of the five prayers
 * were prayed, and whether a clean-streak day was clean or a slip.
 * Returns null when there's nothing worth storing.
 */
function parseMeta(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;

  const start = typeof m.start === "string" && HHMM.test(m.start) ? m.start : null;
  const end = typeof m.end === "string" && HHMM.test(m.end) ? m.end : null;
  const q = Number(m.quality);
  const quality = Number.isFinite(q) && q >= 1 && q <= 5 ? Math.round(q) : null;

  const named: string[] = [];
  if (Array.isArray(m.parts)) {
    for (const p of m.parts) {
      if (typeof p === "string" && PRAYER_KEYS.includes(p)) named.push(p);
    }
  }
  const parts = orderPrayers(named);

  const status = m.status === "clean" || m.status === "slip" ? m.status : null;

  if (!start && !end && !quality && parts.length === 0 && !status) return null;
  return { start, end, quality, parts: parts.length > 0 ? parts : null, status };
}

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
  if (ops.length > 0) await d.collection("entries").bulkWrite(ops);
  return NextResponse.json({ ok: true });
}
