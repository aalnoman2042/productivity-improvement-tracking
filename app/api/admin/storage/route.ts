import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentAdminId } from "@/lib/admin";
import {
  DEFAULT_LIMIT_MB,
  bySize,
  type CollectionSize,
  type StorageReport,
} from "@/lib/storage";

/**
 * How much room the database is using, collection by collection.
 *
 * The question this answers is not "how much data do I have" — the admin
 * page already counts rows — but "how close is this to the ceiling?", which
 * on a free Atlas cluster is the difference between an app that works and
 * one that has stopped accepting writes.
 *
 * Sizes only. No document is read, no field is inspected, and nothing here
 * says whose data it is: `$collStats` reports on a collection as a whole,
 * which is exactly as much as an admin needs to see and no more.
 */

export const dynamic = "force-dynamic";

/** Set when the cluster isn't the free tier, so the bar tells the truth. */
const limitMb = Number(process.env.ATLAS_LIMIT_MB) || DEFAULT_LIMIT_MB;

export async function GET() {
  const adminId = await currentAdminId();
  // Non-admins get the 404 a wrong URL would: the endpoint's existence is
  // itself admin-only, same as the page's.
  if (!adminId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const d = await db();

  // Cluster-wide totals, and then each collection on its own. `dbStats`
  // covers everything including collections the app doesn't know about;
  // the per-collection list is what makes a total actionable.
  //
  // It is also a **privileged command a cluster may refuse**, and a refusal
  // must not cost the whole card: the per-collection figures below add up to
  // very nearly the same answer, so a database that won't talk about itself
  // as a whole still gets a total. Only collections this connection can see
  // are counted then, which is the honest limit of that fallback.
  let stats: Record<string, unknown> = {};
  let totalsFromCollections = false;
  try {
    stats = await d.command({ dbStats: 1 });
  } catch (err) {
    console.warn("dbStats refused, summing collections instead:", err);
    totalsFromCollections = true;
  }
  const names = (await d.listCollections({}, { nameOnly: true }).toArray()).map(
    (c) => c.name
  );

  const collections: CollectionSize[] = [];
  for (const name of names) {
    try {
      const [row] = await d
        .collection(name)
        .aggregate([{ $collStats: { storageStats: {} } }])
        .toArray();
      const s = row?.storageStats ?? {};
      collections.push({
        name,
        count: Number(s.count ?? 0),
        dataSize: Number(s.size ?? 0),
        storageSize: Number(s.storageSize ?? 0),
        indexSize: Number(s.totalIndexSize ?? 0),
      });
    } catch {
      // A view, or a collection the cluster won't report on. Skipping one is
      // better than failing the page — the totals above still include it.
      continue;
    }
  }

  const summed = collections.reduce(
    (acc, c) => ({
      dataSize: acc.dataSize + c.dataSize,
      storageSize: acc.storageSize + c.storageSize,
      indexSize: acc.indexSize + c.indexSize,
      objects: acc.objects + c.count,
    }),
    { dataSize: 0, storageSize: 0, indexSize: 0, objects: 0 }
  );

  const report: StorageReport = {
    collections: bySize(collections),
    totals: totalsFromCollections
      ? summed
      : {
          dataSize: Number(stats.dataSize ?? 0),
          storageSize: Number(stats.storageSize ?? 0),
          indexSize: Number(stats.indexSize ?? 0),
          objects: Number(stats.objects ?? 0),
        },
    limitBytes: limitMb * 1024 * 1024,
  };

  return NextResponse.json(report);
}
