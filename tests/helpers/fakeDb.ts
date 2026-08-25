import { ObjectId } from "mongodb";

/**
 * Just enough MongoDB to run a route handler.
 *
 * Not a database. It is a stand-in for the four or five operations these
 * handlers actually perform, so that a *route* can be tested — the layer
 * where both of the bugs that genuinely hurt this project lived (every save
 * wiping `entries.note`; nothing polling the cron). A pure-`lib` test could
 * not have caught either.
 *
 * The rule that keeps this honest: it only ever grows an operation when a
 * route under test needs one, and it never gains behaviour Mongo doesn't
 * have. A fake that is cleverer than the real thing tests fiction.
 */

export type Row = Record<string, unknown>;

/** Mongo's own comparison rules, for the handful of shapes routes use. */
function matches(row: Row, query: Row): boolean {
  for (const [key, cond] of Object.entries(query)) {
    const value = row[key];
    if (cond && typeof cond === "object" && !(cond instanceof ObjectId)) {
      const c = cond as Record<string, unknown>;
      if ("$gte" in c && !(String(value) >= String(c.$gte))) return false;
      if ("$lte" in c && !(String(value) <= String(c.$lte))) return false;
      if ("$gt" in c && !(String(value) > String(c.$gt))) return false;
      if ("$lt" in c && !(String(value) < String(c.$lt))) return false;
      if ("$ne" in c && same(value, c.$ne)) return false;
      if ("$in" in c) {
        const list = c.$in as unknown[];
        if (!list.some((v) => same(value, v))) return false;
      }
      continue;
    }
    if (!same(value, cond)) return false;
  }
  return true;
}

function same(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId || b instanceof ObjectId) return String(a) === String(b);
  return a === b;
}

class FakeCollection {
  rows: Row[] = [];

  constructor(seed: Row[] = []) {
    this.rows = seed.map((r) => ({ _id: new ObjectId(), ...r }));
  }

  find(query: Row = {}) {
    let out = this.rows.filter((r) => matches(r, query));
    const cursor = {
      sort(spec: Record<string, number>) {
        const [key, dir] = Object.entries(spec)[0] ?? ["_id", 1];
        out = [...out].sort((a, b) =>
          String(a[key]) < String(b[key]) ? -dir : String(a[key]) > String(b[key]) ? dir : 0
        );
        return cursor;
      },
      skip(n: number) {
        out = out.slice(n);
        return cursor;
      },
      limit(n: number) {
        out = out.slice(0, n);
        return cursor;
      },
      toArray: async () => out.map((r) => ({ ...r })),
      next: async () => (out.length > 0 ? { ...out[0] } : null),
    };
    return cursor;
  }

  async findOne(query: Row = {}) {
    const row = this.rows.find((r) => matches(r, query));
    return row ? { ...row } : null;
  }

  async countDocuments(query: Row = {}) {
    return this.rows.filter((r) => matches(r, query)).length;
  }

  async insertOne(doc: Row) {
    const row = { _id: new ObjectId(), ...doc };
    this.rows.push(row);
    return { insertedId: row._id };
  }

  async updateOne(
    query: Row,
    update: { $set?: Row; $setOnInsert?: Row },
    options: { upsert?: boolean } = {}
  ) {
    const row = this.rows.find((r) => matches(r, query));
    if (row) {
      Object.assign(row, update.$set ?? {});
      return { matchedCount: 1, upsertedCount: 0 };
    }
    if (!options.upsert) return { matchedCount: 0, upsertedCount: 0 };
    this.rows.push({
      _id: new ObjectId(),
      ...flatten(query),
      ...(update.$setOnInsert ?? {}),
      ...(update.$set ?? {}),
    });
    return { matchedCount: 0, upsertedCount: 1 };
  }

  async deleteOne(query: Row) {
    const i = this.rows.findIndex((r) => matches(r, query));
    if (i < 0) return { deletedCount: 0 };
    this.rows.splice(i, 1);
    return { deletedCount: 1 };
  }

  async deleteMany(query: Row) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !matches(r, query));
    return { deletedCount: before - this.rows.length };
  }

  async bulkWrite(ops: Record<string, Row>[]) {
    for (const op of ops) {
      if (op.deleteOne) {
        await this.deleteOne((op.deleteOne as { filter: Row }).filter);
      } else if (op.updateOne) {
        const u = op.updateOne as unknown as {
          filter: Row;
          update: { $set?: Row; $setOnInsert?: Row };
          upsert?: boolean;
        };
        await this.updateOne(u.filter, u.update, { upsert: u.upsert });
      }
    }
    return { ok: 1 };
  }
}

/** A query's equality terms become the fields of an upserted document. */
function flatten(query: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(query)) {
    if (v && typeof v === "object" && !(v instanceof ObjectId)) continue;
    out[k] = v;
  }
  return out;
}

export class FakeDb {
  private collections = new Map<string, FakeCollection>();

  constructor(seed: Record<string, Row[]> = {}) {
    for (const [name, rows] of Object.entries(seed)) {
      this.collections.set(name, new FakeCollection(rows));
    }
  }

  collection(name: string) {
    let c = this.collections.get(name);
    if (!c) this.collections.set(name, (c = new FakeCollection()));
    return c;
  }

  /** What a collection holds now — the assertion surface of a write test. */
  rows(name: string): Row[] {
    return this.collection(name).rows;
  }
}
