import { describe, expect, it } from "vitest";
import { detectRoute } from "../lib/install";

/**
 * Guessing a browser from a user-agent is guesswork, and the strings lie on
 * purpose — every iOS browser claims to be Safari, and every in-app webview
 * claims to be a browser. These are real user agents, so the guess is pinned
 * to reality rather than to what the strings ought to look like.
 */

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
  iphoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15",
  iphoneFacebook:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBDV/iPhone14,2;FBMD/iPhone]",
  androidInstagram:
    "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 Instagram 331.0.0.37.90",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  desktopFirefox:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
};

describe("detectRoute", () => {
  it("takes the browser's own prompt whenever there is one", () => {
    // Whatever the string says, an offered prompt is the truth.
    expect(detectRoute(UA.androidChrome, true)).toBe("prompt");
    expect(detectRoute(UA.iphoneSafari, true)).toBe("prompt");
  });

  it("sends iPhone Safari to the Share sheet", () => {
    expect(detectRoute(UA.iphoneSafari, false)).toBe("ios-safari");
  });

  it("sends other iPhone browsers to Safari first", () => {
    // Their Add to Home Screen makes a shortcut Apple won't push to.
    expect(detectRoute(UA.iphoneChrome, false)).toBe("ios-other");
    expect(detectRoute(UA.iphoneFirefox, false)).toBe("ios-other");
  });

  it("spots an in-app browser before anything else", () => {
    // The Facebook webview on iPhone is iOS *and* in-app; in-app wins,
    // because there is no install route inside it at all.
    expect(detectRoute(UA.iphoneFacebook, false)).toBe("in-app");
    expect(detectRoute(UA.androidInstagram, false)).toBe("in-app");
  });

  it("falls back to the browser menu for everything else", () => {
    expect(detectRoute(UA.desktopFirefox, false)).toBe("menu");
    expect(detectRoute("", false)).toBe("menu");
  });
});
