/**
 * Prints a fresh VAPID key pair — the identity your server uses to sign push
 * messages. Run it once and paste the output into .env.local (and into
 * Vercel's environment variables).
 *
 *   npm run vapid-keys
 *
 * Regenerating the keys invalidates every existing subscription, so everyone
 * has to switch reminders back on. Generate once and keep them.
 */
import { randomBytes } from "node:crypto";
import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log(`
Add these to .env.local and to your Vercel environment variables:

NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
VAPID_SUBJECT=mailto:you@example.com

Then set a secret the reminder cron must present:

CRON_SECRET=${randomBytes(24).toString("hex")}
`);
