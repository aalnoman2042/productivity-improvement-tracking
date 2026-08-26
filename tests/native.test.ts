import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NATIVE_UA_MARKER, isNativeShell } from "../lib/native";

/**
 * How PIT knows it is the Android app.
 *
 * The whole native branch — local reminders instead of push, no install
 * prompt, a header that clears the status bar — hangs off one substring in a
 * user agent. That substring is written in three files that cannot import
 * each other: Capacitor appends it (`capacitor.config.ts`), an inline script
 * in the root layout reads it before the first paint, and `lib/native.ts`
 * reads it everywhere else. Nothing in the type system holds those three
 * together, and if they ever disagree the failure is silent: the app simply
 * behaves like a browser that cannot receive notifications, and no reminder
 * ever arrives. So the agreement is asserted here instead.
 */

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** Real strings. An Android WebView reports itself as Chrome with `wv`. */
const UA = {
  shell:
    "Mozilla/5.0 (Linux; Android 14; SM-S911B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36 PITApp/1",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  plainWebview:
    "Mozilla/5.0 (Linux; Android 14; SM-S911B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36",
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isNativeShell", () => {
  it("knows the shell by the marker Capacitor appends", () => {
    vi.stubGlobal("navigator", { userAgent: UA.shell });
    expect(isNativeShell()).toBe(true);
  });

  it("is false in a browser, including a bare WebView that is not ours", () => {
    for (const ua of [UA.androidChrome, UA.plainWebview, UA.iphoneSafari]) {
      vi.stubGlobal("navigator", { userAgent: ua });
      expect(isNativeShell()).toBe(false);
    }
  });

  /**
   * "PIT" on its own is three letters that turn up in ordinary strings — a
   * build tag, a device codename, a city. Matching them would put a browser
   * into a mode where it schedules alarms it cannot schedule.
   */
  it("does not match a user agent that merely contains PIT", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Linux; Android 14; PIT-L29 Build/PITA) Chrome/126.0.0.0",
    });
    expect(isNativeShell()).toBe(false);
  });

  it("survives an environment with no navigator at all", () => {
    vi.stubGlobal("navigator", undefined);
    expect(isNativeShell()).toBe(false);
  });
});

describe("the marker is the same in all three places that spell it out", () => {
  it("is what capacitor.config.ts appends to the user agent", () => {
    const config = read("../capacitor.config.ts");
    const appended = /appendUserAgent:\s*"([^"]+)"/.exec(config);
    expect(appended, "capacitor.config.ts no longer sets android.appendUserAgent").not.toBeNull();
    expect(appended![1]).toContain(NATIVE_UA_MARKER);
  });

  it("is what the root layout looks for before the first paint", () => {
    const layout = read("../app/layout.tsx");
    expect(layout).toContain(`indexOf('${NATIVE_UA_MARKER}')`);
    // The attribute the stamp sets, and that globals.css hangs off.
    expect(layout).toContain(`setAttribute('data-shell','native')`);
  });

  it("is the attribute globals.css hides install prompts on", () => {
    const css = read("../app/globals.css");
    expect(css).toContain('[data-shell="native"] .hide-installed');
  });
});
