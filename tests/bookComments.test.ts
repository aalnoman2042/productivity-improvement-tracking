import { describe, expect, it } from "vitest";
import {
  MAX_BOOK_COMMENT,
  MAX_BOOK_COMMENTS,
  addComment,
  cleanComment,
  parseComments,
  removeComment,
  type BookComment,
} from "../lib/bookComments";

const made = (id: string, text = "good chapter"): BookComment => ({
  id,
  text,
  on: "2026-08-25",
});

describe("cleanComment", () => {
  it("trims, and refuses what isn't a comment", () => {
    expect(cleanComment("  chapter nine  ")).toBe("chapter nine");
    expect(cleanComment("   ")).toBeNull();
    expect(cleanComment(null)).toBeNull();
    expect(cleanComment(7)).toBeNull();
  });

  it("caps a comment rather than rejecting a long one", () => {
    expect(cleanComment("x".repeat(2000))).toHaveLength(MAX_BOOK_COMMENT);
  });
});

describe("parseComments", () => {
  it("survives a document with nothing on it", () => {
    expect(parseComments(undefined)).toEqual([]);
    expect(parseComments(null)).toEqual([]);
    expect(parseComments("not a list")).toEqual([]);
  });

  it("drops rows that aren't comments and keeps the ones that are", () => {
    const out = parseComments([
      made("a"),
      { id: "b" },
      { text: "no id" },
      null,
      42,
    ]);
    expect(out).toEqual([made("a")]);
  });

  it("keeps the words when the stamp is unreadable", () => {
    const out = parseComments([{ id: "a", text: "kept", on: "last tuesday" }]);
    expect(out).toEqual([{ id: "a", text: "kept", on: "" }]);
  });
});

describe("addComment", () => {
  it("adds to the end — oldest first, never reordered", () => {
    const list = [made("a", "first"), made("b", "second")];
    const out = addComment(list, made("c", "third"));
    expect(out?.map((c) => c.text)).toEqual(["first", "second", "third"]);
  });

  it("does not touch the list it was given", () => {
    const list = [made("a")];
    addComment(list, made("b"));
    expect(list).toHaveLength(1);
  });

  it("refuses rather than silently dropping when the book is full", () => {
    const full = Array.from({ length: MAX_BOOK_COMMENTS }, (_, i) =>
      made(String(i))
    );
    expect(addComment(full, made("one-too-many"))).toBeNull();
  });
});

describe("removeComment", () => {
  it("takes out one and leaves the rest in order", () => {
    const list = [made("a", "one"), made("b", "two"), made("c", "three")];
    expect(removeComment(list, "b").map((c) => c.text)).toEqual([
      "one",
      "three",
    ]);
  });

  it("is a no-op for an id that isn't there", () => {
    const list = [made("a")];
    expect(removeComment(list, "z")).toEqual(list);
  });
});
