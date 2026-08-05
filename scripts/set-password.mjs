/**
 * Sets an account's password directly — the owner's fallback for when a
 * friend is locked out and email delivery isn't configured.
 *
 *   node scripts/set-password.mjs their@email.com "a new password"
 *
 * Only the password changes. Trackers and entries hang off the account's
 * id, never the password, so nothing logged is touched — this is a way
 * back in, not a reset.
 */
import { MongoClient } from "mongodb";
import { randomBytes, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";

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
const email = (process.argv[2] || "").toLowerCase();
const password = process.argv[3] || "";

if (!email || password.length < 8) {
  console.error(
    'Usage: node scripts/set-password.mjs <email> "<new password, 8+ chars>"'
  );
  process.exit(1);
}

// Same scheme as lib/auth.ts
const salt = randomBytes(16);
const passwordHash = `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 64).toString("hex")}`;

const client = await new MongoClient(URI).connect();
const db = client.db(DB);
const res = await db.collection("users").updateOne(
  { email },
  {
    // The stamp is what the app checks every session against, so setting it
    // here signs out any device still holding an older token — the same
    // thing changing your own password does.
    $set: { passwordHash, passwordChangedAt: new Date() },
    $unset: { resetTokenHash: "", resetExpires: "" },
  }
);

if (res.matchedCount === 0) {
  console.log(`No account found for ${email}`);
} else {
  // Say what survived, out loud: the point of this script is a way back in,
  // and the first question anyone asks is "is my data still there?".
  const user = await db.collection("users").findOne({ email }, { projection: { _id: 1 } });
  const [trackers, entries] = await Promise.all([
    db.collection("trackers").countDocuments({ userId: user._id }),
    db.collection("entries").countDocuments({ userId: user._id }),
  ]);
  console.log(`Password updated for ${email}.`);
  console.log(`Their data is untouched: ${trackers} trackers, ${entries} logged entries.`);
  console.log("Any pending reset links and other signed-in devices are now void.");
}

await client.close();
