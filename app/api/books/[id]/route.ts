import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { isValidDateStr, toDateStr } from "@/lib/dates";
import {
  afterStatusChange,
  clampRead,
  isBookStatus,
  parsePages,
  parseRating,
} from "@/lib/books";
import { parseAuthor, parseBookNote, parseTitle, toBook } from "@/lib/bookDoc";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Change one book: its details, how far in you are, or which shelf it's on.
 *
 * Every field is optional — the page sends only what the tap meant. A status
 * change is the one that has side effects (start and finish dates, a filled
 * bar), and those are decided by `afterStatusChange` so the shelf and the
 * tests agree about them.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const d = await db();
  const _id = new ObjectId(id);
  const existing = await d.collection("books").findOne({ _id, userId });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const book = toBook(existing);
  const body = await req.json().catch(() => null);
  const today = isValidDateStr(body?.today) ? body.today : toDateStr(new Date());
  const set: Record<string, unknown> = { updatedAt: new Date() };

  if (body?.title !== undefined) {
    const title = parseTitle(body.title);
    if (!title) {
      return NextResponse.json({ error: "A title is required" }, { status: 400 });
    }
    set.title = title;
  }
  if (body?.author !== undefined) set.author = parseAuthor(body.author);
  if (body?.note !== undefined) set.note = parseBookNote(body.note);
  if (body?.rating !== undefined) set.rating = parseRating(body.rating);

  // The total can arrive with the same request that moves the shelf, so it's
  // resolved before the status is judged — finishing a book whose page count
  // you just typed should fill the bar with that number.
  const pages = body?.pages !== undefined ? parsePages(body.pages) : book.pages;
  if (body?.pages !== undefined) set.pages = pages;

  let pagesRead = book.pagesRead;
  if (body?.pagesRead !== undefined) {
    pagesRead = clampRead(body.pagesRead, pages);
    set.pagesRead = pagesRead;
  }

  if (body?.status !== undefined) {
    if (!isBookStatus(body.status)) {
      return NextResponse.json({ error: "Unknown shelf" }, { status: 400 });
    }
    Object.assign(
      set,
      afterStatusChange({ ...book, pages, pagesRead }, body.status, today)
    );
  }

  // Explicit dates stay the reader's to correct — a book finished last month
  // and only now filed shouldn't claim today.
  for (const field of ["startedOn", "finishedOn"] as const) {
    if (body?.[field] !== undefined) {
      set[field] = isValidDateStr(body[field]) ? body[field] : null;
    }
  }

  await d.collection("books").updateOne({ _id, userId }, { $set: set });
  const doc = await d.collection("books").findOne({ _id, userId });
  return NextResponse.json(doc ? toBook(doc) : { ok: true });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const d = await db();
  const res = await d
    .collection("books")
    .deleteOne({ _id: new ObjectId(id), userId });
  if (res.deletedCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
