import { MongoClient, type Db } from "mongodb";

// Cache the client across dev hot-reloads so we don't pile up connections.
const g = globalThis as typeof globalThis & {
  _pitMongo?: Promise<MongoClient>;
  _pitSchema?: Promise<void>;
};

function getClient(): Promise<MongoClient> {
  if (!g._pitMongo) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI is not set");
    g._pitMongo = new MongoClient(uri).connect();
  }
  return g._pitMongo;
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
    },
  },
  trackers: {
    bsonType: "object",
    required: ["userId", "name", "type", "unit", "color", "category", "archived", "createdAt"],
    properties: {
      userId: { bsonType: "objectId" },
      name: { bsonType: "string", maxLength: 60 },
      type: {
        enum: ["duration", "sleep", "count", "scale", "check", "measure"],
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
        },
      },
      createdAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" },
    },
  },
};

async function ensureSchema(d: Db): Promise<void> {
  const existing = new Set(
    (await d.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name)
  );

  for (const [name, schema] of Object.entries(VALIDATORS)) {
    const validator = { $jsonSchema: schema };
    if (existing.has(name)) {
      // Keep validators current without touching the documents already stored.
      await d.command({ collMod: name, validator, validationLevel: "moderate" });
    } else {
      await d.createCollection(name, { validator });
    }
  }

  await Promise.all([
    d.collection("users").createIndex({ email: 1 }, { unique: true }),
    d.collection("trackers").createIndex({ userId: 1, order: 1 }),
    d
      .collection("entries")
      .createIndex({ userId: 1, trackerId: 1, date: 1 }, { unique: true }),
    d.collection("entries").createIndex({ userId: 1, date: 1 }),
  ]);
}

export async function db(): Promise<Db> {
  const client = await getClient();
  const d = client.db(process.env.MONGODB_DB || "pit");
  if (!g._pitSchema) g._pitSchema = ensureSchema(d);
  await g._pitSchema;
  return d;
}
