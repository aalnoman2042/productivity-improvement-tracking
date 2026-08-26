/**
 * Makes the signing key the Android APK is built with — once, on this machine.
 *
 *   npm run keystore
 *
 * Android identifies an app by the key that signed it, not by its version. So
 * this key is what lets a new APK install *over* the old one: sign with a
 * different key and the phone refuses the update outright, and the only way
 * forward is to uninstall, which takes the app's data with it. Generate this
 * once, back it up, and never lose it.
 *
 * It has to be made here rather than in CI because the repository is public,
 * and everything CI can hand back — build artifacts, workflow inputs, logs —
 * is public with it. A key generated on a runner would be a key anyone could
 * download. So it is born on this machine and only ever leaves as an
 * encrypted GitHub secret.
 *
 * No JDK required. `keytool` would be the usual tool, but Git Bash already
 * ships OpenSSL, and since JDK 9 keytool's own default keystore format *is*
 * PKCS#12 — so what this writes is the same kind of file keytool would.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const P12 = "pit-release.p12";
const ALIAS = "pit";
const KEY = "pit-key.pem";
const CERT = "pit-cert.pem";

/** Thirty years. A signing certificate that expires is a key that stops being
 *  able to publish updates, so it is made to outlive every version of the app
 *  it will ever sign. */
const DAYS = 10950;

function openssl(args, env) {
  return execFileSync("openssl", args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

try {
  openssl(["version"]);
} catch {
  console.error(
    "OpenSSL was not found. Run this from Git Bash, which ships it — or\n" +
      "install it and put it on PATH."
  );
  process.exit(1);
}

if (existsSync(P12)) {
  console.error(
    `${P12} already exists.\n\n` +
      "That is almost certainly the key your installed APK was signed with.\n" +
      "Replacing it means every phone with PIT installed has to uninstall\n" +
      "before it can update again. If you really mean to start over, delete\n" +
      `${P12} by hand first.`
  );
  process.exit(1);
}

// Passed through the environment rather than on the command line: an
// argument is visible to anything that can list processes.
const password = randomBytes(24).toString("base64url");
let fingerprint = "(unavailable)";

try {
  openssl([
    "req", "-x509", "-newkey", "rsa:4096", "-sha256", "-noenc",
    "-days", String(DAYS),
    "-keyout", KEY, "-out", CERT,
    "-subj", "/CN=PIT/O=aalnoman2042/C=BD",
  ]);

  // Read while the certificate still exists — the `finally` below removes it.
  fingerprint = openssl(["x509", "-in", CERT, "-noout", "-fingerprint", "-sha256"])
    .toString()
    .trim();

  openssl(
    [
      "pkcs12", "-export",
      "-inkey", KEY, "-in", CERT,
      "-name", ALIAS, "-out", P12,
      "-passout", "env:PIT_KEYSTORE_PASSWORD",
    ],
    { PIT_KEYSTORE_PASSWORD: password }
  );
} finally {
  // The unbundled halves are the private key in the clear. The .p12 holds
  // everything; these are only litter, and litter that matters.
  for (const f of [KEY, CERT]) if (existsSync(f)) rmSync(f);
}

writeFileSync(`${P12}.b64`, readFileSync(P12).toString("base64"));

console.log(`
Wrote ${P12}.

──────────────────────────────────────────────────────────────────────────
BACK THIS UP FIRST. Put ${P12} and the password below in a password
manager. Lose either one and you can never ship an update that installs
over the current app — every phone would have to uninstall first.
──────────────────────────────────────────────────────────────────────────

Now add three repository secrets, at
Settings → Secrets and variables → Actions → New repository secret:

  ANDROID_KEYSTORE_BASE64     the one long line in ${P12}.b64
  ANDROID_KEYSTORE_PASSWORD   ${password}
  ANDROID_KEY_ALIAS           ${ALIAS}

Then delete ${P12}.b64 — the .p12 itself is the copy worth keeping.

The key's fingerprint, if you ever need to prove which key signed an APK:
  ${fingerprint}
`);
