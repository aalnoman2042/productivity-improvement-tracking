/**
 * Fills an account with a month of realistic demo data so the dashboard has
 * something to show. Writes straight to MongoDB with proper BSON types.
 *
 *   node scripts/seed-demo.mjs you@example.com [YYYY-MM-DD]
 *
 * It REPLACES that account's trackers and entries. Nothing else is touched.
 */
import { MongoClient, ObjectId } from "mongodb";
import { readFileSync } from "node:fs";

/* ---- config from .env.local (so this matches the running app) ---- */
let env = {};
try {
  env = Object.fromEntries(
    readFileSync(new URL("../.env.local", import.meta.url), "utf8")
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );
} catch {}

const URI = process.env.MONGODB_URI || env.MONGODB_URI || "mongodb://localhost:27017";
const DB = process.env.MONGODB_DB || env.MONGODB_DB || "pit";
const EMAIL = (process.argv[2] || "").toLowerCase();
const TODAY = process.argv[3] || new Date().toISOString().slice(0, 10);
const DAYS = 30;

if (!EMAIL) {
  console.error("Usage: node scripts/seed-demo.mjs <account-email> [YYYY-MM-DD]");
  process.exit(1);
}

/* ---- deterministic pseudo-random, so reruns produce the same month ---- */
let seed = 20260801;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (lo, hi) => lo + rnd() * (hi - lo);
const int = (lo, hi) => Math.round(pick(lo, hi));

const addDays = (str, n) => {
  const [y, m, d] = str.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  const p = (x) => String(x).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
};
const dow = (str) => {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
};
const hhmm = (mins) => {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

const TRACKERS = [
  { name: "Sleep", type: "sleep", unit: "min", category: "sleep", color: "#4a3aa7", goal: { target: 420, period: "day", direction: "min" } },
  { name: "Self study", type: "duration", unit: "min", category: "study", color: "#2a78d6", goal: { target: 180, period: "day", direction: "min" } },
  { name: "Reading", type: "duration", unit: "min", category: "study", color: "#e87ba4", goal: { target: 30, period: "day", direction: "min" } },
  { name: "Work", type: "duration", unit: "min", category: "work", color: "#1baf7a", goal: null },
  { name: "Workout", type: "duration", unit: "min", category: "fitness", color: "#eb6834", goal: { target: 45, period: "day", direction: "min" } },
  { name: "Water", type: "count", unit: "glasses", category: "food", color: "#eda100", goal: { target: 8, period: "day", direction: "min" } },
  { name: "Junk food", type: "count", unit: "times", category: "food", color: "#e34948", goal: { target: 2, period: "week", direction: "max" } },
  { name: "Diet quality", type: "scale", unit: "/5", category: "food", color: "#d55181", goal: null },
  { name: "Weight", type: "measure", unit: "kg", category: "health", color: "#008300", goal: null },
  { name: "Meditation", type: "check", unit: "", category: "health", color: "#3987e5", goal: { target: 1, period: "day", direction: "min" } },
];

const client = await new MongoClient(URI).connect();
const db = client.db(DB);

const user = await db.collection("users").findOne({ email: EMAIL });
if (!user) {
  console.error(`No account found for ${EMAIL} — sign up in the app first.`);
  await client.close();
  process.exit(1);
}
const userId = user._id;

await db.collection("entries").deleteMany({ userId });
await db.collection("trackers").deleteMany({ userId });

const now = new Date();
const trackerDocs = TRACKERS.map((t, i) => ({
  _id: new ObjectId(),
  userId,
  name: t.name,
  type: t.type,
  unit: t.unit,
  color: t.color,
  category: t.category,
  goal: t.goal,
  archived: false,
  order: i,
  createdAt: now,
}));
await db.collection("trackers").insertMany(trackerDocs);
const id = Object.fromEntries(trackerDocs.map((t) => [t.name, t._id]));

/* ---- a month of believable days, gently improving ---- */
const skip = new Set([addDays(TODAY, -26), addDays(TODAY, -22), addDays(TODAY, -15)]);
const entries = [];
let weight = 74.6;

for (let i = DAYS - 1; i >= 0; i--) {
  const date = addDays(TODAY, -i);
  const progress = (DAYS - 1 - i) / (DAYS - 1); // 0 → 1 across the month
  const wd = dow(date);
  const weekend = wd === 5 || wd === 6; // Fri/Sat

  weight -= pick(0.02, 0.1);
  if (skip.has(date)) continue;

  const bed = 1380 + int(0, 110) - Math.round(progress * 35);
  const slept = int(345, 500) + Math.round(progress * 25);
  const quality = Math.max(1, Math.min(5, Math.round(2 + progress * 1.4 + pick(-0.6, 1.2))));
  const gymDay = wd === 0 || wd === 2 || wd === 4 || (wd === 6 && rnd() > 0.4);

  const day = [
    [id["Sleep"], slept, { start: hhmm(bed), end: hhmm(bed + slept), quality }],
    [id["Self study"], weekend ? int(0, 120) + Math.round(progress * 30) : int(60, 210) + Math.round(progress * 70)],
    [id["Reading"], rnd() > 0.25 ? int(15, 55) : 0],
    [id["Work"], weekend ? int(0, 90) : int(240, 480)],
    [id["Workout"], gymDay ? int(35, 80) + Math.round(progress * 10) : 0],
    [id["Water"], Math.min(12, int(4, 8) + Math.round(progress * 2))],
    [id["Junk food"], Math.max(0, int(0, 3) - Math.round(progress * 1.5))],
    [id["Diet quality"], Math.max(1, Math.min(5, Math.round(2.5 + progress * 1.2 + pick(-0.8, 0.8))))],
    [id["Weight"], Math.round(weight * 10) / 10],
    [id["Meditation"], rnd() < 0.35 + progress * 0.35 ? 1 : 0],
  ];

  for (const [trackerId, value, meta] of day) {
    if (!value && !meta) continue; // nothing logged for that one
    entries.push({
      userId,
      trackerId,
      date,
      value,
      note: null,
      meta: meta ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }
}

await db.collection("entries").insertMany(entries);

const logged = new Set(entries.map((e) => e.date)).size;
console.log(
  `Seeded ${user.name} <${EMAIL}>: ${TRACKERS.length} trackers, ${entries.length} entries across ${logged} days ` +
    `(${addDays(TODAY, -(DAYS - 1))} → ${TODAY}; ${skip.size} days left blank on purpose).`
);

await client.close();
