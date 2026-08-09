import { MongoClient, type Db } from "mongodb";

// Cache the client across dev hot-reloads so we don't pile up connections.
const g = globalThis as typeof globalThis & {
  _pitMongo?: Promise<MongoClient>;
  _pitSchema?: Promise<void>;
};

function getClient(): Promise<MongoClient> {
  const existing = g._pitMongo;
  if (existing) return existing;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  const connecting = new MongoClient(uri, {
    // Every page load is a handful of small queries, so the pool stays tiny —
    // but idle sockets are kept long enough that the next request on a warm
    // instance doesn't pay for a new handshake.
    maxPoolSize: 10,
    minPoolSize: 0,
    maxIdleTimeMS: 60_000,
    // Fail fast and show an error rather than hanging the page for 30 seconds.
    serverSelectionTimeoutMS: 8_000,
    connectTimeoutMS: 8_000,
  }).connect();

  // Don't leave a rejected promise cached for every later request to trip
  // over — a failed connect should be retried by the next one.
  connecting.catch(() => {
    if (g._pitMongo === connecting) g._pitMongo = undefined;
  });

  g._pitMongo = connecting;
  return connecting;
}

/**
 * BSON schema validators — these are what keep the data properly typed in
 * MongoDB (ObjectId refs, Date timestamps, numeric values, real booleans)
 * instead of whatever JSON happens to arrive.
 */
const VALIDATORS: Record<string, object> = {
  users: {
    bsonType: "object",
    required: ["email", "name", "passwordHash", "createdAt"],
    properties: {
      email: { bsonType: "string", description: "lowercase, unique" },
      name: { bsonType: "string" },
      passwordHash: { bsonType: "string" },
      createdAt: { bsonType: "date" },
      // Password reset: only the hash of the token is kept, never the token.
      resetTokenHash: { bsonType: ["string", "null"] },
      resetExpires: { bsonType: ["date", "null"] },
      // Stamped into every session; changing the password orphans old tokens.
      passwordChangedAt: { bsonType: ["date", "null"] },
      // Nightly "did you log today?" push. The cron decides *when* it fires;
      // tzOffset only decides *which day* the reminder is about.
      reminder: {
        bsonType: ["object", "null"],
        properties: {
          enabled: { bsonType: "bool" },
          // Minutes to add to UTC to get local time (+360 for UTC+6).
          tzOffset: { bsonType: "number", minimum: -840, maximum: 840 },
          // The last day-to-log we nagged about, so a re-run can't double-send.
          lastSentFor: { bsonType: ["string", "null"] },
          // The Sunday whose week-in-review has been sent, same idea.
          lastDigestFor: { bsonType: ["string", "null"] },
        },
      },
    },
  },
  trackers: {
    bsonType: "object",
    required: ["userId", "name", "type", "unit", "color", "category", "archived", "createdAt"],
    properties: {
      userId: { bsonType: "objectId" },
      name: { bsonType: "string", maxLength: 60 },
      type: {
        enum: [
          "duration",
          "sleep",
          "count",
          "scale",
          "check",
          "measure",
          "prayer",
          "streak",
        ],
      },
      unit: { bsonType: "string" },
      color: { bsonType: "string", pattern: "^#[0-9a-fA-F]{6}$" },
      // Free-form so you can invent your own categories.
      category: { bsonType: "string", minLength: 1, maxLength: 30 },
      goal: {
        bsonType: ["object", "null"],
        required: ["target", "period", "direction"],
        properties: {
          target: { bsonType: "number", minimum: 0 },
          period: { enum: ["day", "week"] },
          direction: { enum: ["min", "max"] },
        },
      },
      // Good habits are built up, bad ones cut down — growth on a bad one
      // reads as falling behind. Absent on old rows, which read as "good".
      habit: { enum: ["good", "bad", null] },
      archived: { bsonType: "bool" },
      order: { bsonType: "number" },
      createdAt: { bsonType: "date" },
    },
  },
  entries: {
    bsonType: "object",
    required: ["userId", "trackerId", "date", "value", "updatedAt"],
    properties: {
      userId: { bsonType: "objectId" },
      trackerId: { bsonType: "objectId" },
      date: { bsonType: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      value: { bsonType: "number", minimum: 0 },
      note: { bsonType: ["string", "null"] },
      meta: {
        bsonType: ["object", "null"],
        properties: {
          start: { bsonType: ["string", "null"], pattern: "^\\d{2}:\\d{2}$" },
          end: { bsonType: ["string", "null"], pattern: "^\\d{2}:\\d{2}$" },
          quality: { bsonType: ["number", "null"], minimum: 1, maximum: 5 },
          // Namaz: which of the five prayers were prayed.
          parts: {
            bsonType: ["array", "null"],
            items: { bsonType: "string" },
            maxItems: 5,
          },
          // Clean-streak trackers: a slip is stored as value 0 *with* meta, so
          // it stays on record instead of reading as a day you never logged.
          status: { enum: ["clean", "slip", null] },
        },
      },
      createdAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" },
    },
  },
  // "This tracker, every day, for N days." A challenge owns no entries —
  // it just watches a tracker over a date window, so deleting one costs
  // nothing but the challenge itself.
  challenges: {
    bsonType: "object",
    required: ["userId", "name", "trackerId", "startDate", "days", "direction", "createdAt"],
    properties: {
      userId: { bsonType: "objectId" },
      name: { bsonType: "string", maxLength: 60 },
      trackerId: { bsonType: "objectId" },
      startDate: { bsonType: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      days: { bsonType: "number", minimum: 1, maximum: 365 },
      // The daily bar for numeric trackers; null means "just log it".
      target: { bsonType: ["number", "null"], minimum: 0 },
      direction: { enum: ["min", "max"] },
      createdAt: { bsonType: "date" },
    },
  },
  // "Life right now" analyses written by the AI coach — one row per run,
  // newest is what the Status page shows. Text only; the numbers it was
  // built from live in the entries themselves.
  aiReviews: {
    bsonType: "object",
    required: ["userId", "text", "createdAt"],
    properties: {
      userId: { bsonType: "objectId" },
      text: { bsonType: "string", maxLength: 10000 },
      // The numbers the review was written against, computed by the app —
      // kept so an old review is never re-read beside newer figures.
      snapshot: { bsonType: ["object", "null"] },
      today: { bsonType: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      model: { bsonType: ["string", "null"] },
      createdAt: { bsonType: "date" },
    },
  },
  // One row per browser that agreed to receive reminders — a phone and a
  // laptop are separate rows, so both get the nudge.
  pushSubs: {
    bsonType: "object",
    required: ["userId", "endpoint", "keys", "createdAt"],
    properties: {
      userId: { bsonType: "objectId" },
      endpoint: { bsonType: "string" },
      keys: {
        bsonType: "object",
        required: ["p256dh", "auth"],
        properties: {
          p256dh: { bsonType: "string" },
          auth: { bsonType: "string" },
        },
      },
      label: { bsonType: ["string", "null"] },
      createdAt: { bsonType: "date" },
      lastUsedAt: { bsonType: ["date", "null"] },
    },
  },
  // Attempt counters for the routes reachable without a session. `_id` is
  // "action:subject" and rows delete themselves once the window has passed.
  rateLimits: {
    bsonType: "object",
    required: ["count", "resetAt"],
    properties: {
      _id: { bsonType: "string" },
      count: { bsonType: "number" },
      resetAt: { bsonType: "date" },
    },
  },
  // One row per run of the nightly reminder, so "did it fire?" has an answer
  // that doesn't depend on noticing you weren't reminded.
  cronRuns: {
    bsonType: "object",
    required: ["job", "startedAt", "ok"],
    properties: {
      job: { bsonType: "string" },
      startedAt: { bsonType: "date" },
      finishedAt: { bsonType: ["date", "null"] },
      ok: { bsonType: "bool" },
      tookMs: { bsonType: ["number", "null"] },
      checked: { bsonType: ["number", "null"] },
      notified: { bsonType: ["number", "null"] },
      stakes: { bsonType: ["number", "null"] },
      skipped: { bsonType: ["number", "null"] },
      digests: { bsonType: ["number", "null"] },
      error: { bsonType: ["string", "null"] },
    },
  },
};

async function ensureSchema(d: Db): Promise<void> {
  const existing = new Set(
    (await d.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name)
  );

  // One round trip per collection, so run them together rather than in turn.
  await Promise.all(
    Object.entries(VALIDATORS).map(([name, schema]) => {
      const validator = { $jsonSchema: schema };
      return existing.has(name)
        ? // Keep validators current without touching the stored documents.
          d.command({ collMod: name, validator, validationLevel: "moderate" })
        : d.createCollection(name, { validator });
    })
  );

  await Promise.all([
    d.collection("users").createIndex({ email: 1 }, { unique: true }),
    d.collection("trackers").createIndex({ userId: 1, order: 1 }),
    d
      .collection("entries")
      .createIndex({ userId: 1, trackerId: 1, date: 1 }, { unique: true }),
    d.collection("entries").createIndex({ userId: 1, date: 1 }),
    d.collection("challenges").createIndex({ userId: 1, createdAt: -1 }),
    d.collection("aiReviews").createIndex({ userId: 1, createdAt: -1 }),
    // The same browser re-subscribing must update its row, not add another.
    d.collection("pushSubs").createIndex({ endpoint: 1 }, { unique: true }),
    d.collection("pushSubs").createIndex({ userId: 1 }),
    // Both of these are self-cleaning: MongoDB drops the row once the date
    // field is in the past (plus the TTL), so neither collection grows.
    d
      .collection("rateLimits")
      .createIndex({ resetAt: 1 }, { expireAfterSeconds: 0 }),
    d
      .collection("cronRuns")
      .createIndex({ startedAt: -1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 }),
  ]);
}

/**
 * Start the validator/index sync if it hasn't been started on this instance,
 * and hand back the promise so a caller that needs it can wait.
 *
 * It is deliberately *not* awaited by `db()`. The sync is a dozen round trips
 * to the database, and a serverless instance is thrown away and rebuilt often
 * enough that paying for it on the way to every read made the app feel slow to
 * open. Reads run straight away; the sync catches up behind them.
 */
function startSchemaSync(d: Db): Promise<void> | null {
  if (process.env.PIT_SKIP_SCHEMA_SYNC === "1") return null;
  if (!g._pitSchema) {
    g._pitSchema = ensureSchema(d).catch((err) => {
      // Let the next request try again rather than caching the failure.
      g._pitSchema = undefined;
      console.error("Schema sync failed:", err);
    });
  }
  return g._pitSchema;
}

export async function db(): Promise<Db> {
  const client = await getClient();
  const d = client.db(process.env.MONGODB_DB || "pit");
  startSchemaSync(d);
  return d;
}

/**
 * Like `db()`, but waits for the indexes to exist first. Used by the writes
 * that depend on a unique index to be correct — creating an account, and
 * upserting a day's entries.
 */
export async function dbReady(): Promise<Db> {
  const client = await getClient();
  const d = client.db(process.env.MONGODB_DB || "pit");
  await startSchemaSync(d);
  return d;
}
