/**
 * The app's own icons, as geometry.
 *
 * Every icon in this app used to be an emoji, and an emoji is not an icon:
 * it is a picture the *reader's operating system* draws. The same 📈 is a
 * flat orange chart on Windows, a glossy blue one on Android and something
 * else again in the WebView — different weights, different palettes, none of
 * them related to this app's line work or its two themes. That is what makes
 * a screen of them look assembled rather than designed, and no amount of CSS
 * reaches inside one to fix it.
 *
 * So these are drawn here instead. One grid (24×24), one stroke weight, round
 * caps and joins throughout, and `currentColor` everywhere — which is what
 * lets a nav icon go accent-blue when its tab is active and grey when it is
 * not, in both themes, with no second copy of the artwork.
 *
 * Rules for adding one:
 *  - Draw on the 24 grid with ~2.5 of padding, so it sits on the same optical
 *    square as its neighbours.
 *  - Strokes, not fills, except for genuine dots — a filled glyph at 20px
 *    next to a stroked one reads as a different set.
 *  - Test it at 18px before 32px. These are read small; detail that only
 *    resolves large is detail that turns to mush where it is actually used.
 */

export type IconPath = {
  d: string;
  /** Dots and pips only — see the rule above. */
  fill?: boolean;
};

export type IconName =
  | "calendar"
  | "trend"
  | "compass"
  | "list"
  | "medal"
  | "shield";

export const ICONS: Record<IconName, IconPath[]> = {
  /** Today — the daily log. A calendar with the day marked. */
  calendar: [
    { d: "M6 4.5h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-10a3 3 0 0 1 3-3z" },
    { d: "M3 9.5h18" },
    { d: "M8 2.5v4" },
    { d: "M16 2.5v4" },
    { d: "M13 14.75a1 1 0 1 1-2 0 1 1 0 0 1 2 0z", fill: true },
  ],

  /**
   * Stats — a line climbing out of an axis, with its own arrowhead.
   * Deliberately the same gesture as the app icon's rising arrow, so the
   * thing on the home screen and the thing in the tab bar are related.
   */
  trend: [
    { d: "M3.5 3v15.5a2 2 0 0 0 2 2H21" },
    { d: "M7.5 16.5 11 12l3 2.5 5-6.5" },
    { d: "M15.5 8h4v4" },
  ],

  /** Status — where you are, which is what a compass answers. */
  compass: [
    { d: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" },
    { d: "m15.6 8.4-2.1 5.1-5.1 2.1 2.1-5.1z" },
  ],

  /** Trackers — the things you keep, as a list. */
  list: [
    { d: "M9 6.5h11" },
    { d: "M9 12h11" },
    { d: "M9 17.5h11" },
    { d: "M5.85 6.5a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0z", fill: true },
    { d: "M5.85 12a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0z", fill: true },
    { d: "M5.85 17.5a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0z", fill: true },
  ],

  /**
   * Awards — a rosette, disc up and ribbon tails below.
   *
   * Drawn this way on the second attempt. The obvious medal — a disc hanging
   * from two ribbons that meet at a bar — renders at 18px as a narrow V over
   * a circle, which is a kettlebell. Tails *below* the disc keep the two
   * halves from converging into one shape.
   */
  medal: [
    { d: "M18 9a6 6 0 1 1-12 0 6 6 0 0 1 12 0z" },
    { d: "M8.2 14.1 7 21.5l5-2.9 5 2.9-1.2-7.4" },
  ],

  /** Admin — the only door in the app that is guarded. */
  shield: [
    { d: "M12 2.5 4.5 5.6v5.9c0 4.6 3.1 8.4 7.5 10 4.4-1.6 7.5-5.4 7.5-10V5.6z" },
    { d: "m8.9 11.9 2.2 2.2 4.2-4.2" },
  ],
};
