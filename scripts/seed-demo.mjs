/**
 * Fills an account with a month of realistic demo data so every screen has
 * something to show. Writes straight to MongoDB with proper BSON types.
 *
 *   node scripts/seed-demo.mjs you@example.com [YYYY-MM-DD] [--days 30]
 *   node scripts/seed-demo.mjs demo@example.com --create "Demo" "password"
 *
 * It REPLACES that account's trackers and entries. Nothing else is touched.
 *
 * Every tracker *type* is represented, and so is every shape of goal — daily
 * and weekly, "at least" and "at most" — because the point of a demo account
 * is that someone opening it can see what the app does without being told.
 * The month is deliberately imperfect: three blank days, two streak slips, a
 * prayer that gets missed more than the others, and an archived tracker with
 * history still attached.
 */
import { MongoClient, ObjectId } from "mongodb";
import { randomBytes, scryptSync } from "node:crypto";
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

/* ---- arguments: two positional, plus flags that take a known arity ---- */
const ARITY = { "--create": 2, "--days": 1 };
const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const arity = ARITY[argv[i]];
  if (arity === undefined) {
    positional.push(argv[i]);
    continue;
  }
  flags[argv[i]] = argv.slice(i + 1, i + 1 + arity);
  i += arity;
}

const EMAIL = (positional[0] || "").toLowerCase();
const TODAY = positional[1] || new Date().toISOString().slice(0, 10);
const DAYS = Number(flags["--days"]?.[0]) || 30;
const CREATE = flags["--create"] ?? null;

if (!/^\d{4}-\d{2}-\d{2}$/.test(TODAY)) {
  console.error(`"${TODAY}" is not a date — expected YYYY-MM-DD.`);
  process.exit(1);
}

if (!EMAIL) {
  console.error(
    "Usage: node scripts/seed-demo.mjs <account-email> [YYYY-MM-DD] [--days N]\n" +
      '       add --create "<name>" "<password>" to make the account if it is missing'
  );
  process.exit(1);
}

/* ---- deterministic pseudo-random, so reruns produce the same month ---- */
let seed = 20260801;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (lo, hi) => lo + rnd() * (hi - lo);
const int = (lo, hi) => Math.round(pick(lo, hi));
const chance = (p) => rnd() < p;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

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

/* ---------------------------- the trackers ----------------------------- */
/* Between them these cover all eight types, five categories, daily and
   weekly goals, and both directions. */
const TRACKERS = [
  // sleep — bedtime, wake time and quality
  { name: "Sleep", type: "sleep", unit: "min", category: "sleep", color: "#4a3aa7", goal: { target: 420, period: "day", direction: "min" } },
  // duration — the stopwatch types
  { name: "Self study", type: "duration", unit: "min", category: "study", color: "#2a78d6", goal: { target: 180, period: "day", direction: "min" } },
  { name: "Reading", type: "duration", unit: "min", category: "study", color: "#e87ba4", goal: { target: 30, period: "day", direction: "min" } },
  { name: "Work", type: "duration", unit: "min", category: "work", color: "#1baf7a", goal: null },
  { name: "Workout", type: "duration", unit: "min", category: "fitness", color: "#eb6834", goal: { target: 45, period: "day", direction: "min" } },
  // a duration you want *less* of — the same type, the opposite goal
  { name: "Screen time", type: "duration", unit: "min", category: "health", color: "#8b5cf6", goal: { target: 120, period: "day", direction: "max" } },
  // count — up and down
  { name: "Water", type: "count", unit: "glasses", category: "food", color: "#eda100", goal: { target: 8, period: "day", direction: "min" } },
  { name: "Junk food", type: "count", unit: "times", category: "food", color: "#e34948", goal: { target: 2, period: "week", direction: "max" } },
  // scale — 1–5 ratings
  { name: "Diet quality", type: "scale", unit: "/5", category: "food", color: "#d55181", goal: null },
  { name: "Mood", type: "scale", unit: "/5", category: "health", color: "#0ea5e9", goal: null },
  // measure — a decimal that drifts
  { name: "Weight", type: "measure", unit: "kg", category: "health", color: "#008300", goal: null },
  // check — done or not
  { name: "Meditation", type: "check", unit: "", category: "health", color: "#3987e5", goal: { target: 1, period: "day", direction: "min" } },
  // prayer — which of the five, not just how many
  { name: "Namaz", type: "prayer", unit: "", category: "faith", color: "#059669", goal: { target: 5, period: "day", direction: "min" } },
  { name: "Quran", type: "duration", unit: "min", category: "faith", color: "#14b8a6", goal: { target: 15, period: "day", direction: "min" } },
  // streak — days since the last slip
  { name: "No fap", type: "streak", unit: "", category: "discipline", color: "#7c3aed", goal: null },
  // archived — hidden from the log, history intact, so the Trackers page
  // shows what archiving actually does
  { name: "Guitar practice", type: "duration", unit: "min", category: "hobby", color: "#f59e0b", goal: null, archived: true },
];

const PRAYER_KEYS = ["fajr", "dhuhr", "asr", "maghrib", "isha"];
/**
 * How reliably each prayer gets prayed. Fajr is the one that gets missed —
 * which is the whole reason `meta.parts` stores *which* prayers rather than
 * just how many, so the demo data has to actually show it.
 */
const PRAYER_ODDS = { fajr: 0.42, dhuhr: 0.88, asr: 0.82, maghrib: 0.95, isha: 0.9 };

/* ------------------------------ connect -------------------------------- */
const client = await new MongoClient(URI).connect();
const db = client.db(DB);

let user = await db.collection("users").findOne({ email: EMAIL });

if (!user) {
  if (!CREATE) {
    console.error(
      `No account found for ${EMAIL} — sign up in the app first, or pass\n` +
        `  --create "<name>" "<password>"  to make it here.`
    );
    await client.close();
    process.exit(1);
  }
  const [name, password] = CREATE;
  if (!name || !password) {
    console.error('--create needs a name and a password: --create "Demo" "secret"');
    await client.close();
    process.exit(1);
  }
  // Same scheme as lib/auth.ts. Note this bypasses the sign-up form's
  // 8-character minimum on purpose — a demo account often wants a password
  // short enough to type from a slide.
  const salt = randomBytes(16);
  const passwordHash = `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 64).toString("hex")}`;
  const insert = await db.collection("users").insertOne({
    email: EMAIL,
    name,
    passwordHash,
    createdAt: new Date(),
  });
  user = { _id: insert.insertedId, name };
  console.log(`Created account ${name} <${EMAIL}>.`);
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
  archived: Boolean(t.archived),
  order: i,
  createdAt: now,
}));
await db.collection("trackers").insertMany(trackerDocs);
const id = Object.fromEntries(trackerDocs.map((t) => [t.name, t._id]));

/* ---- a month of believable days, gently improving --------------------- */

// Three days left blank on purpose: a perfect grid teaches you nothing about
// what a gap looks like, and finding gaps is what the history calendar is for.
const skip = new Set([addDays(TODAY, -26), addDays(TODAY, -22), addDays(TODAY, -15)]);

// Two slips, far enough apart to leave a best run worth beating and a current
// run worth protecting.
const slips = new Set([addDays(TODAY, -24), addDays(TODAY, -9)]);

const entries = [];
let weight = 74.6;

for (let i = DAYS - 1; i >= 0; i--) {
  const date = addDays(TODAY, -i);
  const progress = (DAYS - 1 - i) / (DAYS - 1); // 0 → 1 across the month
  const wd = dow(date);
  const weekend = wd === 5 || wd === 6; // Fri/Sat

  weight -= pick(0.02, 0.1);
  if (skip.has(date)) continue;

  // Bedtime walks back from around 1am to around 11:30pm over the month, so
  // the sleep clock chart has a trend to show and "to bed earlier" is true.
  const bed = 1440 + int(0, 80) - Math.round(progress * 95);
  const slept = int(345, 490) + Math.round(progress * 35);
  const quality = clamp(Math.round(2 + progress * 1.4 + pick(-0.6, 1.2)), 1, 5);
  const gymDay = wd === 0 || wd === 2 || wd === 4 || (wd === 6 && chance(0.6));

  // Namaz: each prayer decided on its own, all of them getting better over
  // the month — and Fajr starting from much further back.
  const parts = PRAYER_KEYS.filter((k) =>
    chance(Math.min(0.98, PRAYER_ODDS[k] + progress * 0.18))
  );

  const clean = !slips.has(date);

  const day = [
    [id["Sleep"], slept, { start: hhmm(bed), end: hhmm(bed + slept), quality }],
    [id["Self study"], weekend ? int(0, 120) + Math.round(progress * 30) : int(60, 210) + Math.round(progress * 70)],
    [id["Reading"], chance(0.75) ? int(15, 55) : 0],
    [id["Work"], weekend ? int(0, 90) : int(240, 480)],
    [id["Workout"], gymDay ? int(35, 80) + Math.round(progress * 10) : 0],
    [id["Screen time"], Math.max(20, int(90, 260) - Math.round(progress * 70))],
    [id["Water"], Math.min(12, int(4, 8) + Math.round(progress * 2))],
    [id["Junk food"], Math.max(0, int(0, 3) - Math.round(progress * 1.5))],
    [id["Diet quality"], clamp(Math.round(2.5 + progress * 1.2 + pick(-0.8, 0.8)), 1, 5)],
    [id["Mood"], clamp(Math.round(2.6 + progress * 1.1 + pick(-0.9, 0.9)), 1, 5)],
    [id["Weight"], Math.round(weight * 10) / 10],
    [id["Meditation"], chance(0.35 + progress * 0.35) ? 1 : 0],
    [id["Namaz"], parts.length, parts.length > 0 ? { parts } : null],
    [id["Quran"], chance(0.55 + progress * 0.3) ? int(8, 35) : 0],
    // A slip is value 0 *with* a status, which is what keeps it on record
    // instead of reading as a day that was never filled in.
    [id["No fap"], clean ? 1 : 0, { status: clean ? "clean" : "slip" }],
    // Archived halfway through: entries stop, but the history stays.
    [id["Guitar practice"], i > DAYS - 12 && chance(0.6) ? int(20, 45) : 0],
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

/* ------------------------------- report -------------------------------- */
const logged = new Set(entries.map((e) => e.date)).size;
const active = trackerDocs.filter((t) => !t.archived).length;
const namaz = entries.filter((e) => String(e.trackerId) === String(id["Namaz"]));
const fajr = namaz.filter((e) => e.meta?.parts?.includes("fajr")).length;

console.log(
  `Seeded ${user.name} <${EMAIL}>\n` +
    `  ${active} active trackers + ${trackerDocs.length - active} archived, ` +
    `covering all 8 types\n` +
    `  ${entries.length} entries across ${logged} days ` +
    `(${addDays(TODAY, -(DAYS - 1))} → ${TODAY})\n` +
    `  ${skip.size} days left blank, ${slips.size} streak slips, ` +
    `Fajr prayed on ${fajr}/${namaz.length} logged days`
);

await client.close();
