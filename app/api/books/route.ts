import { NextResponse } from "next/server";
import { db, dbReady } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { isValidDateStr, toDateStr } from "@/lib/dates";
import { afterStatusChange, normalizeStatus, parsePages } from "@/lib/books";
import { parseAuthor, parseBookNote, parseTitle, toBook } from "@/lib/bookDoc";

/** The shelf, newest addition first — the page groups it by status itself. */
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const d = await db();
  const docs = await d
    .collection("books")
    .find({ userId })
    .sort({ createdAt: -1 })
    .toArray();
  return NextResponse.json(docs.map(toBook));
}

/**
 * Add a book. Body: { title, author?, pages?, status?, note?, today? }.
 *
 * `today` is the client's date — the server's clock is in another timezone
 * and "finished today" has to mean the reader's today, not Vercel's.
 */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const title = parseTitle(body?.title);
  if (!title) {
    return NextResponse.json({ error: "A title is required" }, { status: 400 });
  }

  const today = isValidDateStr(body?.today) ? body.today : toDateStr(new Date());
  const pages = parsePages(body?.pages);
  const dates = afterStatusChange(
    { status: "wishlist", pages, pagesRead: 0, startedOn: null, finishedOn: null },
    normalizeStatus(body?.status),
    today
  );

  const d = await dbReady();
  const res = await d.collection("books").insertOne({
    userId,
    title,
    author: parseAuthor(body?.author),
    pages,
    rating: null,
    note: parseBookNote(body?.note),
    ...dates,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const doc = await d.collection("books").findOne({ _id: res.insertedId });
  return NextResponse.json(doc ? toBook(doc) : { ok: true }, { status: 201 });
}
