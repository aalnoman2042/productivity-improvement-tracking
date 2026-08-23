import { NextResponse } from "next/server";
import { ObjectId, type AnyBulkWriteOperation } from "mongodb";
import { dbReady } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { isValidDateStr } from "@/lib/dates";
import { parseMeta } from "@/lib/entryMeta";
import { clampRead, normalizeStatus, parsePages, parseRating } from "@/lib/books";
import { parseAuthor, parseBookNote, parseTitle } from "@/lib/bookDoc";
import { MAX_DAY_NOTE, cleanNote } from "@/lib/notes";
import { cleanTask } from "@/lib/tasks";
import { parseGoal } from "@/lib/trackerDoc";
import {
  TRACKER_TYPES,
  normalizeCategory,
  type TrackerType,
} from "@/lib/trackers";

/**
 * Restore a JSON export made by `/api/export?format=json`.
 *
 * Deliberately a **merge**, never a wipe: trackers are matched to existing
 * ones by name and type (created when there's no match), and entries upsert
 * by day with the file's values winning. Restoring into an empty account is
 * a clean restore; restoring into a live one fills the gaps — and either
 * way, nothing that isn't in the file is touched.
 *
 * Day notes and books ride along the same way, and are optional: a backup
 * taken before either existed is still a valid backup.
 *
 * Every entry passes through the same validation as a day typed by hand.
 * An export is just a file, and a file can say anything.
 */

const MAX_TRACKERS = 200;
const MAX_ENTRIES = 200_000;
const MAX_DAY_NOTES = 20_000;
const MAX_BOOKS = 5_000;
const MAX_TASKS = 20_000;
const VALID_TYPES = new Set(TRACKER_TYPES.map((t) => t.value));

export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const inTrackers = body?.trackers;
  const inEntries = body?.entries;
  if (!Array.isArray(inTrackers) || !Array.isArray(inEntries)) {
    return NextResponse.json(
      { error: "That doesn't look like a PIT backup — expected trackers and entries" },
      { status: 400 }
    );
  }
  if (inTrackers.length > MAX_TRACKERS || inEntries.length > MAX_ENTRIES) {
    return NextResponse.json({ error: "That file is too large" }, { status: 400 });
  }

  const d = await dbReady();
  const existing = await d.collection("trackers").find({ userId }).toArray();
  const byKey = new Map(
    existing.map((t) => [`${String(t.name).toLowerCase()}|${t.type}`, t._id])
  );
  let maxOrder = existing.reduce((m, t) => Math.max(m, Number(t.order ?? 0)), -1);

  // File tracker id → the id it lands under here. Entries reference their
  // tracker by the *file's* id, which means nothing in this database.
  const idMap = new Map<string, ObjectId>();
  let trackersCreated = 0;
  let trackersMatched = 0;
  const now = new Date();

  for (const t of inTrackers) {
    const name =
      typeof t?.name === "string" ? t.name.trim().slice(0, 60) : "";
    const type = t?.type as TrackerType;
    const fileId = typeof t?.id === "string" ? t.id : null;
    if (!name || !fileId || !VALID_TYPES.has(type)) continue;

    const key = `${name.toLowerCase()}|${type}`;
    const matched = byKey.get(key);
    if (matched) {
      idMap.set(fileId, matched);
      trackersMatched++;
      continue;
    }

    maxOrder += 1;
    const doc = {
      userId,
      name,
      type,
      unit: typeof t?.unit === "string" ? t.unit.trim().slice(0, 12) : "",
      color: /^#[0-9a-fA-F]{6}$/.test(String(t?.color)) ? String(t.color) : "#1c5cab",
      category: normalizeCategory(t?.category) ?? "other",
      goal: parseGoal(t?.goal),
      archived: Boolean(t?.archived),
      order: maxOrder,
      createdAt: now,
    };
    const res = await d.collection("trackers").insertOne(doc);
    byKey.set(key, res.insertedId);
    idMap.set(fileId, res.insertedId);
    trackersCreated++;
  }

  let entriesUpserted = 0;
  let entriesSkipped = 0;
  const ops: AnyBulkWriteOperation[] = [];

  for (const e of inEntries) {
    const trackerId =
      typeof e?.trackerId === "string" ? idMap.get(e.trackerId) : undefined;
    const date = e?.date;
    const value = Number(e?.value);
    const meta = parseMeta(e?.meta);
    if (
      !trackerId ||
      !isValidDateStr(date) ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 100000 ||
      // Nothing recorded and nothing attached — not worth a row. (This also
      // keeps a slip, which arrives as value 0 *with* meta.)
      (value === 0 && !meta)
    ) {
      entriesSkipped++;
      continue;
    }

    const note =
      typeof e?.note === "string" && e.note.trim()
        ? e.note.trim().slice(0, 300)
        : null;

    ops.push({
      updateOne: {
        filter: { userId, trackerId, date },
        update: {
          $set: { value, meta, note, updatedAt: now },
          $setOnInsert: { createdAt: now },
        },
        upsert: true,
      },
    });
    entriesUpserted++;
  }

  // In slices, so a big history can't build one enormous command.
  for (let i = 0; i < ops.length; i += 1000) {
    await d.collection("entries").bulkWrite(ops.slice(i, i + 1000));
  }

  // --- What was written about the days themselves ------------------------
  let notesImported = 0;
  const inNotes = Array.isArray(body?.dayNotes)
    ? body.dayNotes.slice(0, MAX_DAY_NOTES)
    : [];
  const noteOps: AnyBulkWriteOperation[] = [];
  for (const n of inNotes) {
    const date = n?.date;
    const text = cleanNote(n?.text, MAX_DAY_NOTE);
    if (!isValidDateStr(date) || !text) continue;
    noteOps.push({
      updateOne: {
        filter: { userId, date },
        update: {
          $set: { text, updatedAt: now },
          $setOnInsert: { createdAt: now },
        },
        upsert: true,
      },
    });
    notesImported++;
  }
  for (let i = 0; i < noteOps.length; i += 1000) {
    await d.collection("dayNotes").bulkWrite(noteOps.slice(i, i + 1000));
  }

  // --- The to-do lists ----------------------------------------------------
  // Matched on (date, text), so importing the same backup twice leaves one
  // copy of each task rather than two — the same rule the bookshelf uses,
  // for the same reason.
  let tasksImported = 0;
  const inTasks = Array.isArray(body?.tasks) ? body.tasks.slice(0, MAX_TASKS) : [];
  const taskOps: AnyBulkWriteOperation[] = [];
  for (const t of inTasks) {
    const date = t?.date;
    const text = cleanTask(t?.text);
    if (!isValidDateStr(date) || !text) continue;
    taskOps.push({
      updateOne: {
        filter: { userId, date, text },
        update: {
          $set: { done: Boolean(t?.done) },
          $setOnInsert: {
            order: Number.isFinite(Number(t?.order)) ? Number(t.order) : 0,
            doneAt: null,
            createdAt: now,
          },
        },
        upsert: true,
      },
    });
    tasksImported++;
  }
  for (let i = 0; i < taskOps.length; i += 1000) {
    await d.collection("tasks").bulkWrite(taskOps.slice(i, i + 1000));
  }

  // --- The bookshelf ------------------------------------------------------
  // Matched on title and author, so importing the same backup twice leaves
  // one copy of each book rather than two.
  let booksImported = 0;
  const inBooks = Array.isArray(body?.books) ? body.books.slice(0, MAX_BOOKS) : [];
  const bookOps: AnyBulkWriteOperation[] = [];
  for (const b of inBooks) {
    const title = parseTitle(b?.title);
    if (!title) continue;
    const author = parseAuthor(b?.author);
    const pages = parsePages(b?.pages);
    bookOps.push({
      updateOne: {
        filter: { userId, title, author },
        update: {
          $set: {
            status: normalizeStatus(b?.status),
            pages,
            pagesRead: clampRead(b?.pagesRead, pages),
            rating: parseRating(b?.rating),
            startedOn: isValidDateStr(b?.startedOn) ? b.startedOn : null,
            finishedOn: isValidDateStr(b?.finishedOn) ? b.finishedOn : null,
            note: parseBookNote(b?.note),
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        upsert: true,
      },
    });
    booksImported++;
  }
  for (let i = 0; i < bookOps.length; i += 1000) {
    await d.collection("books").bulkWrite(bookOps.slice(i, i + 1000));
  }

  return NextResponse.json({
    ok: true,
    trackers: { created: trackersCreated, matched: trackersMatched },
    entries: { imported: entriesUpserted, skipped: entriesSkipped },
    dayNotes: { imported: notesImported },
    books: { imported: booksImported },
    tasks: { imported: tasksImported },
  });
}
