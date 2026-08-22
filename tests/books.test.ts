import { describe, expect, it } from "vitest";
import {
  afterStatusChange,
  bookStats,
  clampRead,
  parsePages,
  parseRating,
  progressOf,
  readingPace,
  shelfOrder,
  type Book,
  type BookStatus,
} from "../lib/books";

const TODAY = "2026-08-22";

function book(over: Partial<Book> = {}): Book {
  return {
    id: over.id ?? "b1",
    title: "Deep Work",
    author: "Cal Newport",
    status: "reading",
    pages: 300,
    pagesRead: 0,
    rating: null,
    startedOn: null,
    finishedOn: null,
    note: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

describe("parsing what a book says about itself", () => {
  it("takes a page count only when it is one", () => {
    expect(parsePages("300")).toBe(300);
    expect(parsePages(300.4)).toBe(300);
    expect(parsePages("")).toBeNull();
    expect(parsePages(0)).toBeNull();
    expect(parsePages(-5)).toBeNull();
    expect(parsePages("many")).toBeNull();
  });

  it("keeps a rating inside the five stars it has", () => {
    expect(parseRating(4)).toBe(4);
    expect(parseRating(0)).toBeNull();
    expect(parseRating(9)).toBeNull();
    expect(parseRating(null)).toBeNull();
  });

  it("never reads past the end of a book", () => {
    expect(clampRead(120, 300)).toBe(120);
    expect(clampRead(400, 300)).toBe(300);
    expect(clampRead(-4, 300)).toBe(0);
    // No total on record is not the same as a total of zero.
    expect(clampRead(400, null)).toBe(400);
  });
});

describe("progressOf", () => {
  it("is a share of the pages when there are pages", () => {
    expect(progressOf(book({ pagesRead: 150 }))).toBeCloseTo(0.5);
  });

  it("has nothing honest to draw without a page count", () => {
    expect(progressOf(book({ pages: null, pagesRead: 40 }))).toBeNull();
  });

  it("is full for a finished book, page count or not", () => {
    expect(progressOf(book({ status: "finished", pages: null }))).toBe(1);
  });
});

describe("afterStatusChange", () => {
  it("stamps the start date when a book is picked up", () => {
    const b = book({ status: "wishlist" });
    expect(afterStatusChange(b, "reading", TODAY)).toEqual({
      status: "reading",
      pagesRead: 0,
      startedOn: TODAY,
      finishedOn: null,
    });
  });

  it("leaves a start date that is already history alone", () => {
    const b = book({ status: "dropped", startedOn: "2026-07-04", pagesRead: 90 });
    expect(afterStatusChange(b, "reading", TODAY).startedOn).toBe("2026-07-04");
  });

  it("finishing fills the bar and dates the day", () => {
    const b = book({ pagesRead: 210, startedOn: "2026-08-02" });
    expect(afterStatusChange(b, "finished", TODAY)).toEqual({
      status: "finished",
      pagesRead: 300,
      startedOn: "2026-08-02",
      finishedOn: TODAY,
    });
  });

  it("finishing a book with no page count keeps the pages it has", () => {
    const b = book({ pages: null, pagesRead: 42 });
    expect(afterStatusChange(b, "finished", TODAY).pagesRead).toBe(42);
  });

  it("putting a book down keeps how far in you got", () => {
    const b = book({ pagesRead: 120, startedOn: "2026-08-02" });
    expect(afterStatusChange(b, "dropped", TODAY)).toEqual({
      status: "dropped",
      pagesRead: 120,
      startedOn: "2026-08-02",
      finishedOn: null,
    });
  });

  it("back on the wishlist means it hasn't been started", () => {
    const b = book({ pagesRead: 120, startedOn: "2026-08-02", finishedOn: TODAY });
    expect(afterStatusChange(b, "wishlist", TODAY)).toEqual({
      status: "wishlist",
      pagesRead: 0,
      startedOn: null,
      finishedOn: null,
    });
  });
});

describe("bookStats", () => {
  const shelf = [
    book({ id: "1", status: "finished", finishedOn: "2026-02-10", pages: 250 }),
    book({ id: "2", status: "finished", finishedOn: "2025-12-30", pages: 400 }),
    book({ id: "3", status: "reading", pages: 300, pagesRead: 100 }),
    book({ id: "4", status: "wishlist", pages: 180, pagesRead: 0 }),
    book({ id: "5", status: "dropped", pages: 500, pagesRead: 60 }),
  ];

  it("counts what was read, all time and this year", () => {
    const s = bookStats(shelf, TODAY);
    expect(s.finished).toBe(2);
    expect(s.finishedThisYear).toBe(1); // the 2025 one doesn't count for 2026
    expect(s.reading).toBe(1);
    expect(s.wishlist).toBe(1);
  });

  it("adds finished books whole and the rest as far as they got", () => {
    // 250 + 400 finished, 100 read of the current one, 60 of the abandoned one
    expect(bookStats(shelf, TODAY).pagesRead).toBe(810);
  });

  it("says nothing about an empty shelf", () => {
    expect(bookStats([], TODAY)).toEqual({
      finished: 0,
      finishedThisYear: 0,
      reading: 0,
      wishlist: 0,
      pagesRead: 0,
    });
  });
});

describe("readingPace", () => {
  it("divides the pages read by the days it took", () => {
    // Started on the 12th, 110 pages by the 22nd — 11 days inclusive, 10/day.
    const pace = readingPace(
      book({ startedOn: "2026-08-12", pagesRead: 110 }),
      TODAY
    );
    expect(pace).toEqual({ perDay: 10, daysLeft: 19 });
  });

  it("stays quiet when there is nothing to divide", () => {
    expect(readingPace(book({ startedOn: null, pagesRead: 100 }), TODAY)).toBeNull();
    expect(readingPace(book({ startedOn: "2026-08-12", pagesRead: 0 }), TODAY)).toBeNull();
    expect(
      readingPace(book({ pages: null, startedOn: "2026-08-12", pagesRead: 30 }), TODAY)
    ).toBeNull();
    expect(
      readingPace(book({ status: "finished", startedOn: "2026-08-12", pagesRead: 50 }), TODAY)
    ).toBeNull();
  });

  it("counts the first day as a day, not as zero", () => {
    const pace = readingPace(
      book({ startedOn: TODAY, pagesRead: 30 }),
      TODAY
    );
    expect(pace?.perDay).toBe(30);
  });
});

describe("shelfOrder", () => {
  const shelf = [
    book({ id: "old", status: "finished", finishedOn: "2026-01-05" }),
    book({ id: "new", status: "finished", finishedOn: "2026-08-01" }),
    book({ id: "reading", status: "reading", startedOn: "2026-08-10" }),
    book({ id: "wish-a", status: "wishlist", createdAt: "2026-08-01T10:00:00.000Z" }),
    book({ id: "wish-b", status: "wishlist", createdAt: "2026-08-20T10:00:00.000Z" }),
  ];

  const ids = (status: BookStatus) => shelfOrder(shelf, status).map((b) => b.id);

  it("reads the finished shelf backwards through time", () => {
    expect(ids("finished")).toEqual(["new", "old"]);
  });

  it("puts the newest idea at the top of the wishlist", () => {
    expect(ids("wishlist")).toEqual(["wish-b", "wish-a"]);
  });

  it("keeps a shelf to its own books", () => {
    expect(ids("reading")).toEqual(["reading"]);
  });
});
