import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { toBook } from "@/lib/bookDoc";
import { toTracker } from "@/lib/trackerDoc";
import { APP_VERSION } from "@/lib/version";

// Always read the database at the moment of the request — an export served
// from a cache would be an old copy pretending to be a backup.
export const dynamic = "force-dynamic";

/**
 * Everything you've logged, in a file that's yours to keep.
 *
 * `?format=csv` is one row per entry, made for Excel and Google Sheets.
 * `?format=json` is the full backup — trackers with their goals, entries
 * with their meta, the notes written about each day and the bookshelf — in a
 * shape close enough to the database that nothing is lost in translation.
 * The CSV stays entries-only: it is a spreadsheet of days, and a shelf of
 * books is not that.
 *
 * Archived trackers and their history are included in both: an export that
 * silently dropped part of your data would be worse than none.
 */

/** Quote a CSV field only when it needs it, doubling any quotes inside. */
function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const format = new URL(req.url).searchParams.get("format") ?? "csv";
  if (format !== "csv" && format !== "json") {
    return NextResponse.json({ error: "format must be csv or json" }, { status: 400 });
  }

  const d = await db();
  const [user, trackerDocs, entryDocs, noteDocs, bookDocs, taskDocs, restDocs] =
    await Promise.all([
    d.collection("users").findOne(
      { _id: userId },
      { projection: { name: 1, email: 1, createdAt: 1 } }
    ),
    d.collection("trackers").find({ userId }).sort({ order: 1 }).toArray(),
    d.collection("entries").find({ userId }).sort({ date: 1 }).toArray(),
    d.collection("dayNotes").find({ userId }).sort({ date: 1 }).toArray(),
    d.collection("books").find({ userId }).sort({ createdAt: 1 }).toArray(),
    d.collection("tasks").find({ userId }).sort({ date: 1, order: 1 }).toArray(),
    d.collection("restDays").find({ userId }).sort({ date: 1 }).toArray(),
  ]);

  const trackers = trackerDocs.map(toTracker);
  const byId = new Map(trackers.map((t) => [t.id, t]));
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "json") {
    const body = {
      app: "PIT",
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      account: {
        name: user?.name ?? null,
        email: user?.email ?? null,
        createdAt: user?.createdAt instanceof Date ? user.createdAt.toISOString() : null,
      },
      trackers,
      dayNotes: noteDocs.map((n) => ({
        date: String(n.date),
        text: String(n.text ?? ""),
      })),
      books: bookDocs.map(toBook),
      // The to-do list is not part of the record the numbers are drawn from,
      // but it is still something the account holds — a backup that quietly
      // dropped it would be a backup that isn't one.
      tasks: taskDocs.map((t) => ({
        date: String(t.date),
        text: String(t.text),
        done: Boolean(t.done),
        order: Number(t.order ?? 0),
      })),
      // Days taken off on purpose. They hold no data at all, and that is
      // exactly why they have to travel: restore without them and every
      // planned rest reads as the week somebody quit.
      restDays: restDocs.map((r) => ({
        date: String(r.date),
        reason: (r.reason as string | null) ?? null,
      })),
      entries: entryDocs.map((e) => ({
        trackerId: String(e.trackerId),
        tracker: byId.get(String(e.trackerId))?.name ?? null,
        date: String(e.date),
        value: Number(e.value),
        note: (e.note as string | null | undefined) ?? null,
        meta: e.meta ?? null,
      })),
    };
    return NextResponse.json(body, {
      headers: {
        "Content-Disposition": `attachment; filename="pit-export-${stamp}.json"`,
      },
    });
  }

  const header = [
    "date",
    "tracker",
    "type",
    "category",
    "value",
    "unit",
    "note",
    "sleep_start",
    "sleep_end",
    "sleep_quality",
    "prayers",
    "streak_status",
  ];
  const rows = [header.join(",")];

  for (const e of entryDocs) {
    const t = byId.get(String(e.trackerId));
    const meta = (e.meta ?? {}) as {
      start?: string | null;
      end?: string | null;
      quality?: number | null;
      parts?: string[] | null;
      status?: string | null;
    };
    rows.push(
      [
        cell(e.date),
        cell(t?.name ?? "(deleted tracker)"),
        cell(t?.type ?? ""),
        cell(t?.category ?? ""),
        cell(e.value),
        cell(t?.unit ?? ""),
        cell(e.note),
        cell(meta.start),
        cell(meta.end),
        cell(meta.quality),
        // "+" between prayers, so the field never fights the delimiter.
        cell(Array.isArray(meta.parts) ? meta.parts.join("+") : ""),
        cell(meta.status),
      ].join(",")
    );
  }

  // The BOM is for Excel, which otherwise guesses the encoding and mangles
  // anything beyond ASCII.
  return new NextResponse("﻿" + rows.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pit-export-${stamp}.csv"`,
    },
  });
}
