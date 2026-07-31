/**
 * Sets an account's password directly — the owner's fallback for when a
 * friend is locked out and email delivery isn't configured.
 *
 *   node scripts/set-password.mjs their@email.com "a new password"
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
const res = await client.db(DB).collection("users").updateOne(
  { email },
  {
    $set: { passwordHash },
    $unset: { resetTokenHash: "", resetExpires: "" },
  }
);

console.log(
  res.matchedCount === 0
    ? `No account found for ${email}`
    : `Password updated for ${email}. Any pending reset links are now void.`
);

await client.close();
