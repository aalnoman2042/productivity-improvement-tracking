/**
 * How much room the database is using, said in units a person reads.
 *
 * The number that matters on a free Atlas cluster is not "how many rows" —
 * it is how close the whole thing is to the ceiling, because crossing it
 * stops writes rather than slowing them. Indexes count towards it too, and
 * on a small database they are usually *most* of it: this app's indexes are
 * several times the size of its data, which looks alarming and is normal.
 */

/** Atlas's shared free tier. Override when the cluster is a paid one. */
export const DEFAULT_LIMIT_MB = 512;

export type CollectionSize = {
  name: string;
  count: number;
  /** Bytes of documents, uncompressed. */
  dataSize: number;
  /** Bytes actually on disk after compression. */
  storageSize: number;
  indexSize: number;
};

export type StorageReport = {
  collections: CollectionSize[];
  totals: { dataSize: number; storageSize: number; indexSize: number; objects: number };
  limitBytes: number;
};

/**
 * "1.4 MB", "712 KB", "0 B".
 *
 * Binary units, because that is what the database reports and half a
 * megabyte of disagreement in a storage figure is the kind of thing that
 * makes someone doubt the whole page. One decimal place past a kilobyte:
 * "1.5 MB" is useful, "1.4832 MB" is noise.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** power;
  // Whole bytes are never fractional, and a figure under 10 deserves its
  // decimal more than a figure over 100 does.
  const decimals = power === 0 ? 0 : value < 10 ? 1 : value < 100 ? 1 : 0;
  return `${value.toFixed(decimals)} ${units[power]}`;
}

/** What the cluster is actually holding: everything on disk, indexes too. */
export function usedBytes(totals: StorageReport["totals"]): number {
  return totals.storageSize + totals.indexSize;
}

export type Headroom = {
  used: number;
  limit: number;
  /** 0–100, clamped — a bar can't be 140% full even when the cluster is. */
  percent: number;
  level: "fine" | "watch" | "full";
};

/**
 * How close to the ceiling, and whether that is worth a colour.
 *
 * The thresholds are deliberately late. A database at 40% is not news, and
 * an admin page that worries early is one whose warnings get ignored by the
 * time they mean something.
 */
export function headroom(used: number, limit: number): Headroom {
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return {
    used,
    limit,
    percent,
    level: percent >= 90 ? "full" : percent >= 70 ? "watch" : "fine",
  };
}

/** Biggest first — the only order that answers "what is taking the room?". */
export function bySize(collections: CollectionSize[]): CollectionSize[] {
  return [...collections].sort(
    (a, b) =>
      b.storageSize + b.indexSize - (a.storageSize + a.indexSize) ||
      a.name.localeCompare(b.name)
  );
}
