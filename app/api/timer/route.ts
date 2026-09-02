import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { db, dbReady } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { isBeyondToday, isValidDateStr } from "@/lib/dates";

/**
 * The one timer that is running right now.
 *
 * A stopwatch used to be a fact about a *browser* — it lived in localStorage,
 * so the laptop knew about it and nothing else did. Shut the laptop and the
 * hour went on counting somewhere you could no longer reach it: the phone in
 * your pocket showed no timer, offered no way to stop one, and the minutes
 * piled up until the machine came back. That is what this row fixes. The
 * timer belongs to the person, so every device they own can see it and any
 * one of them can end it.
 *
 * GET → `{ running }` — the timer, or null. POST starts one, or stops it
 * with `{ stop: true }`. It is a POST either way because `lib/sync`'s offline
 * queue speaks one verb, and starting a timer with no signal has to work.
 *
 * Both writes carry `startedAt`, and both use it to identify *which* timer
 * they mean. That is what makes the queue safe: a start that spent the night
 * waiting for signal cannot displace one begun since, and a stop can only
 * ever remove the timer it was actually pressed on.
 */

type RunningTimer = {
  trackerId: string;
  date: string;
  startedAt: number;
  kind: "duration" | "nap";
};

/** Enough clock skew between a phone and a laptop to be nobody's fault. */
const FUTURE_SLACK_MS = 5 * 60_000;

function shape(row: Record<string, unknown>): RunningTimer {
  return {
    trackerId: String(row.trackerId),
    date: String(row.date),
    startedAt: new Date(row.startedAt as Date).getTime(),
    kind: row.kind === "nap" ? "nap" : "duration",
  };
}

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const d = await db();
  const row = await d.collection("timers").findOne({ userId });
  return NextResponse.json({ running: row ? shape(row) : null });
}

export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  // Read as a number or not at all. `Number(null)` is 0, not NaN, and a stop
  // that names no timer sends exactly that — it must mean "whichever one is
  // running", never "the one that started at the epoch".
  const raw: unknown = body?.startedAt;
  const startedAt =
    typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  const d = await dbReady();

  if (body?.stop === true) {
    // Named rather than blanket: a stop that waited out an offline spell
    // must not take down a timer somebody started in the meantime. Without
    // a name it means "stop whatever is running", which is what pressing
    // stop on a page that has just been handed the timer means.
    const filter =
      startedAt === null ? { userId } : { userId, startedAt: new Date(startedAt) };
    await d.collection("timers").deleteOne(filter);
    return NextResponse.json({ ok: true, running: null });
  }

  const { trackerId, date } = body ?? {};
  const kind = body?.kind === "nap" ? "nap" : "duration";

  if (typeof trackerId !== "string" || !ObjectId.isValid(trackerId)) {
    return NextResponse.json({ error: "Bad trackerId" }, { status: 400 });
  }
  if (!isValidDateStr(date)) {
    return NextResponse.json({ error: "Bad date" }, { status: 400 });
  }
  // The same guard the log itself has: you cannot spend an hour on a day
  // nobody has lived. Tomorrow is for planning, not for counting.
  if (isBeyondToday(date)) {
    return NextResponse.json(
      { error: "That day hasn't happened yet" },
      { status: 400 }
    );
  }
  if (startedAt === null || startedAt <= 0) {
    return NextResponse.json({ error: "Bad startedAt" }, { status: 400 });
  }
  if (startedAt > Date.now() + FUTURE_SLACK_MS) {
    return NextResponse.json(
      { error: "A timer cannot have started in the future" },
      { status: 400 }
    );
  }

  const tracker = await d
    .collection("trackers")
    .findOne({ _id: new ObjectId(trackerId), userId }, { projection: { _id: 1 } });
  if (!tracker) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Later start wins. The case this is here for is a start delivered late:
  // begun on a phone with no signal, flushed hours afterwards, by which
  // time the desktop is counting something else. The newer timer is the
  // one the person is actually sitting in front of.
  const existing = await d.collection("timers").findOne({ userId });
  if (existing && new Date(existing.startedAt as Date).getTime() > startedAt) {
    return NextResponse.json({ ok: true, running: shape(existing) });
  }

  const now = new Date();
  await d.collection("timers").updateOne(
    { userId },
    {
      $set: {
        trackerId: new ObjectId(trackerId),
        date,
        startedAt: new Date(startedAt),
        kind,
        updatedAt: now,
      },
      $setOnInsert: { userId },
    },
    { upsert: true }
  );

  return NextResponse.json({
    ok: true,
    running: { trackerId, date, startedAt, kind } satisfies RunningTimer,
  });
}
