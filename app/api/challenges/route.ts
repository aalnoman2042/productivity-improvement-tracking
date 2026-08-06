import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { db, dbReady } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { challengeEnd, MAX_CHALLENGE_DAYS } from "@/lib/challenges";
import { isValidDateStr } from "@/lib/dates";
import { SERIES_PALETTE } from "@/lib/palette";

/**
 * Every challenge, each with the tracker it watches and the values logged
 * inside its window. The window is bounded (a year at most), so sending the
 * raw days and letting the client judge them against *its* today is cheaper
 * and more honest than the server guessing the user's timezone.
 */
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const d = await db();
  const docs = await d
    .collection("challenges")
    .find({ userId })
    .sort({ createdAt: -1 })
    .toArray();
  if (docs.length === 0) return NextResponse.json([]);

  const trackerIds = [...new Set(docs.map((c) => String(c.trackerId)))].map(
    (id) => new ObjectId(id)
  );
  const trackers = await d
    .collection("trackers")
    .find(
      { userId, _id: { $in: trackerIds } },
      { projection: { name: 1, type: 1, unit: 1, color: 1, archived: 1 } }
    )
    .toArray();
  const byId = new Map(trackers.map((t) => [String(t._id), t]));

  // One query covers every challenge's window rather than one per challenge.
  const entries = await d
    .collection("entries")
    .find(
      {
        userId,
        $or: docs.map((c) => ({
          trackerId: c.trackerId,
          date: {
            $gte: String(c.startDate),
            $lte: challengeEnd({
              startDate: String(c.startDate),
              days: Number(c.days),
            }),
          },
        })),
      },
      { projection: { trackerId: 1, date: 1, value: 1 } }
    )
    .toArray();

  const rows = docs.map((c) => {
    const start = String(c.startDate);
    const end = challengeEnd({ startDate: start, days: Number(c.days) });
    const values: Record<string, number> = {};
    for (const e of entries) {
      if (
        String(e.trackerId) === String(c.trackerId) &&
        String(e.date) >= start &&
        String(e.date) <= end
      ) {
        values[String(e.date)] = Number(e.value);
      }
    }
    const t = byId.get(String(c.trackerId));
    return {
      id: String(c._id),
      name: String(c.name),
      trackerId: String(c.trackerId),
      startDate: start,
      days: Number(c.days),
      target: c.target == null ? null : Number(c.target),
      direction: c.direction === "max" ? "max" : "min",
      tracker: t
        ? {
            name: String(t.name),
            type: String(t.type),
            unit: String(t.unit),
            color: String(t.color),
            archived: Boolean(t.archived),
          }
        : null,
      values,
    };
  });

  return NextResponse.json(rows);
}

/**
 * Take a challenge.
 *
 * `{ name, days, startDate, trackerId?, target?, direction? }` — with a
 * `trackerId` the challenge watches a tracker you already log; without one a
 * fresh Yes/No tracker is created under 🏆 Challenge, so the day shows up on
 * the daily log with nothing else to set up.
 */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 60) : "";
  const days = Number(body?.days);
  const startDate = body?.startDate;
  const direction = body?.direction === "max" ? "max" : "min";
  const rawTarget = Number(body?.target);
  const target = Number.isFinite(rawTarget) && rawTarget > 0 ? rawTarget : null;

  if (!name) {
    return NextResponse.json({ error: "Give the challenge a name" }, { status: 400 });
  }
  if (!Number.isInteger(days) || days < 1 || days > MAX_CHALLENGE_DAYS) {
    return NextResponse.json(
      { error: `Length must be 1–${MAX_CHALLENGE_DAYS} days` },
      { status: 400 }
    );
  }
  if (!isValidDateStr(startDate)) {
    return NextResponse.json({ error: "Pick a start date" }, { status: 400 });
  }

  // The new collection (and possibly a new tracker) can be ahead of an old
  // validator, so this write waits for the schema sync like tracker creation.
  const d = await dbReady();

  let trackerId: ObjectId;
  if (body?.trackerId != null) {
    if (!ObjectId.isValid(body.trackerId)) {
      return NextResponse.json({ error: "Bad tracker" }, { status: 400 });
    }
    trackerId = new ObjectId(String(body.trackerId));
    const tracker = await d.collection("trackers").findOne({ _id: trackerId, userId });
    if (!tracker) {
      return NextResponse.json({ error: "That tracker doesn't exist" }, { status: 404 });
    }
  } else {
    // No tracker picked: the challenge brings its own Yes/No tracker, in the
    // first palette color not already taken.
    const mine = await d
      .collection("trackers")
      .find({ userId }, { projection: { color: 1 } })
      .toArray();
    const used = new Set(mine.map((t) => String(t.color).toLowerCase()));
    const free = SERIES_PALETTE.find((p) => !used.has(p.light.toLowerCase()));
    const res = await d.collection("trackers").insertOne({
      userId,
      name,
      type: "check",
      unit: "",
      color: free?.light ?? SERIES_PALETTE[0].light,
      category: "challenge",
      goal: null,
      archived: false,
      order: mine.length,
      createdAt: new Date(),
    });
    trackerId = res.insertedId;
  }

  const res = await d.collection("challenges").insertOne({
    userId,
    name,
    trackerId,
    startDate,
    days,
    target,
    direction,
    createdAt: new Date(),
  });

  return NextResponse.json(
    { ok: true, id: String(res.insertedId), trackerId: String(trackerId) },
    { status: 201 }
  );
}
