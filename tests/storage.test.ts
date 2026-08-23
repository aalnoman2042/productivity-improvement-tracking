import { describe, expect, it } from "vitest";
import {
  bySize,
  formatBytes,
  headroom,
  usedBytes,
  type CollectionSize,
} from "../lib/storage";

const col = (name: string, storageSize: number, indexSize: number): CollectionSize => ({
  name,
  count: 1,
  dataSize: storageSize,
  storageSize,
  indexSize,
});

describe("formatBytes", () => {
  it("counts plain bytes without decimals", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(999)).toBe("999 B");
  });

  it("steps up through the units", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 ** 3)).toBe("1.0 GB");
  });

  it("drops the decimal once the number is big enough to carry itself", () => {
    expect(formatBytes(1024 * 512)).toBe("512 KB");
    expect(formatBytes(1024 * 9.5)).toBe("9.5 KB");
  });

  it("reports the real figures from this app's own cluster", () => {
    // Measured against Atlas, so the formatting is pinned to real inputs.
    expect(formatBytes(174434)).toBe("170 KB");
    expect(formatBytes(974848)).toBe("952 KB");
    expect(formatBytes(516096)).toBe("504 KB");
  });

  it("never shows a negative or nonsense size", () => {
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(NaN)).toBe("0 B");
    expect(formatBytes(Infinity)).toBe("0 B");
  });
});

describe("usedBytes", () => {
  it("counts indexes, because the cluster does", () => {
    // On a small database the indexes are usually most of the total. Showing
    // data size alone would under-report the thing that actually fills up.
    expect(
      usedBytes({ dataSize: 100, storageSize: 500, indexSize: 900, objects: 7 })
    ).toBe(1400);
  });
});

describe("headroom", () => {
  const limit = 512 * 1024 * 1024;

  it("stays quiet well past halfway", () => {
    expect(headroom(limit * 0.4, limit).level).toBe("fine");
    expect(headroom(limit * 0.69, limit).level).toBe("fine");
  });

  it("speaks up at seventy per cent", () => {
    expect(headroom(limit * 0.7, limit).level).toBe("watch");
  });

  it("calls it full at ninety", () => {
    // Crossing the ceiling stops writes rather than slowing them, so the
    // warning has to arrive while there is still time to act on it.
    expect(headroom(limit * 0.9, limit).level).toBe("full");
    expect(headroom(limit, limit).level).toBe("full");
  });

  it("cannot draw a bar past full, even when the cluster is", () => {
    expect(headroom(limit * 1.4, limit).percent).toBe(100);
  });

  it("survives a limit of zero rather than dividing by it", () => {
    expect(headroom(1000, 0).percent).toBe(0);
  });

  it("puts this app's real usage nowhere near the ceiling", () => {
    expect(headroom(516096 + 974848, limit).level).toBe("fine");
  });
});

describe("bySize", () => {
  it("puts the biggest first, counting indexes with the data", () => {
    const out = bySize([col("small", 100, 100), col("big", 100, 9000), col("mid", 500, 500)]);
    expect(out.map((c) => c.name)).toEqual(["big", "mid", "small"]);
  });

  it("breaks a tie by name rather than by luck", () => {
    expect(bySize([col("b", 10, 10), col("a", 10, 10)]).map((c) => c.name)).toEqual([
      "a",
      "b",
    ]);
  });

  it("leaves the caller's array alone", () => {
    const cols = [col("b", 1, 1), col("a", 9, 9)];
    const copy = [...cols];
    bySize(cols);
    expect(cols).toEqual(copy);
  });
});
