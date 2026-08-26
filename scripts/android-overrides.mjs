/**
 * Puts this repository's fingerprints on the Android project that CI just
 * generated. Run immediately after `npx cap add android`.
 *
 *   node scripts/android-overrides.mjs
 *
 * `android/` is not committed — it is scaffolded from scratch on every build,
 * which keeps a hundred Gradle files out of a Next.js repo and means the
 * native project can never drift from the Capacitor version in package.json.
 * The cost is that anything Capacitor does not generate has to be put back,
 * and this is the thing that puts it back.
 *
 * The design rule throughout: **write files the generator never writes.**
 * Gradle merges repeated `android { }` blocks and AGP merges build-type
 * source sets, so signing, versioning, the manifest addition and the
 * notification icon all arrive as new files. Exactly one generated line is
 * touched — an appended `apply from:` — and it is an append, never a
 * substitution. A `sed` over generated text is the thing that rots silently:
 * the day the template writes `versionCode = 1` instead of `versionCode 1`,
 * a substitution becomes a no-op, the build stays green, and every user gets
 * "app not installed" on the next upgrade.
 *
 * Idempotent. Running it twice changes nothing the second time.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const overlay = join(root, "android-overlay");
const app = join(root, "android", "app");
const APPLY_LINE = "apply from: 'signing.gradle'";

if (!existsSync(app)) {
  console.error("android/app is missing — run `npx cap add android` first.");
  process.exit(1);
}

/** 1. Signing and versioning, in a file Capacitor has never heard of. */
copyFileSync(join(overlay, "signing.gradle"), join(app, "signing.gradle"));
console.log("→ android/app/signing.gradle");

/** 2. The one line of contact with generated content. */
const buildGradlePath = join(app, "build.gradle");
const buildGradle = readFileSync(buildGradlePath, "utf8");
if (buildGradle.includes(APPLY_LINE)) {
  console.log("→ build.gradle already applies signing.gradle");
} else {
  writeFileSync(buildGradlePath, `${buildGradle.replace(/\s*$/, "\n\n")}${APPLY_LINE}\n`);
  console.log(`→ build.gradle += ${APPLY_LINE}`);
}

/**
 * 3. The manifest addition, through AGP's merger rather than an edit.
 *
 * Build-type source sets outrank src/main, and a build type only sees its
 * own — so `release` alone would leave a debug build without the exact-alarm
 * permission, and the difference would only show up as a reminder that
 * arrives an hour late on a debug device.
 */
for (const variant of ["release", "debug"]) {
  const dir = join(app, "src", variant);
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(overlay, "AndroidManifest.xml"), join(dir, "AndroidManifest.xml"));
  console.log(`→ android/app/src/${variant}/AndroidManifest.xml`);
}

/** 4. The notification icon, looked up by the bare name in capacitor.config.ts. */
const drawable = join(app, "src", "main", "res", "drawable");
mkdirSync(drawable, { recursive: true });
copyFileSync(join(overlay, "ic_stat_pit.xml"), join(drawable, "ic_stat_pit.xml"));
console.log("→ android/app/src/main/res/drawable/ic_stat_pit.xml");

/**
 * 5. The canary.
 *
 * Every assumption above is about the shape of a file somebody else
 * generates. When that shape changes, the failure is not an error — it is an
 * APK that builds, signs, uploads and then cannot be installed. So the
 * assumptions are asserted out loud, and the build stops here instead.
 */
const expectations = [
  [
    /apply plugin: ['"]com\.android\.application['"]/,
    "app/build.gradle no longer applies com.android.application",
  ],
  [
    /versionCode\s*=?\s*1\b/,
    "app/build.gradle no longer declares versionCode 1 — check signing.gradle still overrides it",
  ],
  [
    /apply from: ['"]capacitor\.build\.gradle['"]/,
    "app/build.gradle no longer applies capacitor.build.gradle",
  ],
  [
    /applicationId ['"]app\.protrackive\.pit['"]/,
    "applicationId is not app.protrackive.pit — appId in capacitor.config.ts did not take, and this APK would install beside the real one rather than over it",
  ],
];

const broken = expectations.filter(([re]) => !re.test(buildGradle)).map(([, why]) => why);
if (broken.length > 0) {
  console.error(
    "\n✗ The generated Android project is not the shape this script expects:\n" +
      broken.map((b) => `  - ${b}`).join("\n") +
      "\n\n  Capacitor's template has changed. Read android/app/build.gradle and\n" +
      "  update android-overlay/ and this script together.\n"
  );
  process.exit(1);
}

console.log("✓ Generated project matches expectations.");
