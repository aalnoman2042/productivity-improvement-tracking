import { SignJWT, jwtVerify } from "jose";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "pit_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(s);
}

/**
 * `passwordChangedAt` rides inside the token so a password change can cut off
 * every session issued before it. A JWT can't be revoked, but it can be dated
 * — and a date older than the password is a session that no longer speaks for
 * the account.
 */
export async function signSession(
  userId: string,
  passwordChangedAt?: Date | null
): Promise<string> {
  return new SignJWT({
    uid: userId,
    pwd: passwordChangedAt ? Math.floor(passwordChangedAt.getTime() / 1000) : 0,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

export type Session = {
  uid: string;
  /** When the account's password was set, in epoch seconds — 0 for "never changed". */
  pwd: number;
};

/** Returns the session from a token, or null if it isn't valid. */
export async function readSession(
  token: string | undefined
): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.uid !== "string") return null;
    return {
      uid: payload.uid,
      // Sessions issued before this claim existed carry no stamp — they're
      // valid for accounts that have never changed their password.
      pwd: typeof payload.pwd === "number" ? payload.pwd : 0,
    };
  } catch {
    return null;
  }
}

/* ---- Password hashing (scrypt, from Node's crypto — no native deps) ---- */

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(expected, actual);
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: SESSION_MAX_AGE,
  path: "/",
};
