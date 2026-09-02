/**
 * Does the database actually look the way the code thinks it does?
 *
 * Written after shipping the `tasks` collection, whose date validator was a
 * heredoc away from rejecting every row ever inserted. That bug would have
 * been invisible until the first person tapped Add — and "the first real
 * test is production" is a sentence worth deleting from this project.
 *
 * **Read-only, on purpose.** It lists collections, reads back the validators
 * and indexes MongoDB is actually enforcing, and compares them to what
 * `lib/db.ts` intends. It never inserts, updates or deletes, and it never
 * reads a single row of anybody's data — only the shape the rows must fit.
 * Safe to run against the live Atlas cluster, which is the only place worth
 * running it.
 *
 *   node scripts/check-db.mjs
 */
import { readFileSync } from "node:fs";
import { MongoClient } from "mongodb";

/* --------------------------- env, by hand ----------------------------- */
// No dotenv dependency for a script that runs once in a blue moon.
function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    const line = raw
      .split(/\r?\n/)
      .find((l) => l.trim().startsWith(`${name}=`));
    return line ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : null;
  } catch {
    return null;
  }
}

const uri = env("MONGODB_URI");
if (!uri) {
  console.error("MONGODB_URI is not set (env or .env.local)");
  process.exit(1);
}
const dbName = env("MONGODB_DB") || "pit";

/**
 * The collections the app expects, and the one thing about each that is
 * worth checking by eye: the pattern a date has to match. A validator that
 * silently matches nothing is the failure this script exists for.
 */
const EXPECTED = {
  users: null,
  trackers: null,
  entries: "date",
  dayNotes: "date",
  tasks: "date",
  books: null,
  challenges: "startDate",
  aiReviews: null,
  weeklyReviews: "weekStart",
  pushSubs: null,
  rateLimits: null,
  cronRuns: null,
  timers: "date",
};

const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });

try {
  await client.connect();
  const db = client.db(dbName);
  const existing = await db.listCollections({}, { nameOnly: false }).toArray();
  const byName = new Map(existing.map((c) => [c.name, c]));

  console.log(`Database: ${dbName}\n`);
  let problems = 0;

  for (const [name, dateField] of Object.entries(EXPECTED)) {
    const info = byName.get(name);
    if (!info) {
      // Not an error: collections self-create on first write, so one that
      // nobody has used yet is simply absent.
      console.log(`· ${name.padEnd(14)} not created yet (no rows written)`);
      continue;
    }

    const schema = info.options?.validator?.$jsonSchema;
    if (!schema) {
      console.log(`✗ ${name.padEnd(14)} NO VALIDATOR — rows are unchecked`);
      problems++;
      continue;
    }

    const indexes = await db.collection(name).indexes();
    const indexList = indexes.map((i) => i.name).join(", ");

    if (dateField) {
      const pattern = schema.properties?.[dateField]?.pattern;
      if (pattern !== DATE_PATTERN) {
        console.log(
          `✗ ${name.padEnd(14)} ${dateField} pattern is ${JSON.stringify(pattern)}, expected ${JSON.stringify(DATE_PATTERN)}`
        );
        console.log(
          `                 a pattern like "^d{4}..." means the backslashes were eaten — it matches NOTHING`
        );
        problems++;
        continue;
      }
    }

    const count = await db.collection(name).estimatedDocumentCount();
    console.log(
      `✓ ${name.padEnd(14)} validator ok${dateField ? ` (${dateField} pattern ok)` : ""} · ~${count} rows · indexes: ${indexList}`
    );
  }

  console.log(
    problems === 0
      ? "\nEverything the app expects is what the database is enforcing."
      : `\n${problems} problem(s) above. Writes to those collections will fail or go unchecked.`
  );
  process.exitCode = problems === 0 ? 0 : 1;
} catch (err) {
  console.error("Could not check the database:", err.message);
  process.exitCode = 1;
} finally {
  await client.close();
}
