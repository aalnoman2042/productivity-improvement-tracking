/**
 * Generates the app icons from one SVG source.
 *   node scripts/make-icons.mjs
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
mkdirSync(path.join(root, "public"), { recursive: true });

/**
 * Rising bars and a climbing arrow, on the brand gradient.
 *
 * Drawn to survive being small. An app icon is read at 48px in a browser tab
 * and ~120px on a home screen, so every decision here is about what still
 * holds at a glance: three shapes, one line, and nothing touching anything
 * else. Three rules produced this layout, each of them a redraw:
 *
 * 1. **Clearance is the design.** The arrow runs in its own band above the
 *    bars. The first version's elbow landed on the tallest bar and its tail
 *    cap sat on the shortest one — at 48px that is not a chart with an arrow
 *    over it, it is a smudge. The `CLEARANCE` check below asserts the gap at
 *    every bar edge and at the head's lowest corner, and throws rather than
 *    writing a bad icon. Move a number here and the script tells you.
 *
 * 2. **An arrowhead is a dart, not a triangle with a flat back.** A
 *    perpendicular-backed triangle on a line this shallow renders as a
 *    pennant pointing sideways. This one is the classic four-point dart:
 *    tip, two swept-back corners, and a notch on the axis that the shaft
 *    runs into — so head and line are visibly one object.
 *
 * 3. **A chevron of two fat strokes is not the answer either.** It was tried
 *    (arms at ±34°) and at a 30° line angle one arm goes horizontal while
 *    the round joins blob together: it reads as a hook. Filled geometry beats
 *    stroked geometry for a head.
 *
 * `inset` leaves the safe zone a maskable icon needs: the background stays
 * full-bleed and only the artwork shrinks, which is the point of maskable.
 */
function svg({ inset = 0 } = {}) {
  const s = 512;
  const scale = 1 - inset * 2;

  const FLOOR = 408;
  const BAR_W = 76;
  const bars = [
    { x: 102, top: 320, alpha: 0.58 },
    { x: 218, top: 276, alpha: 0.79 },
    { x: 334, top: 220, alpha: 1 },
  ];

  const tail = { x: 112, y: 288 };
  const tip = { x: 398, y: 128 };
  const STROKE = 28;
  const HEAD = 72; // tip to the back corners, along the axis
  const HALF = 40; // half the head's width
  const NOTCH = 66; // how far back the base bites in — barely concave, so the
                    // head stays a solid dart rather than a swallowtail

  const dx = tip.x - tail.x;
  const dy = tip.y - tail.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy; // perpendicular
  const py = ux;

  const at = (back, side) => ({
    x: tip.x - ux * back + px * side,
    y: tip.y - uy * back + py * side,
  });
  const corner1 = at(HEAD, HALF);
  const corner2 = at(HEAD, -HALF);
  const notch = at(NOTCH, 0);
  // The shaft runs all the way to the back of the head, so the two read as
  // one stroke rather than a line with a shape parked at the end.
  const shaftEnd = at(HEAD - 4, 0);

  const n = (v) => v.toFixed(1);
  const pt = (q) => `${n(q.x)},${n(q.y)}`;

  // Nothing may come within this of a bar. Checked, not eyeballed.
  const CLEARANCE = 12;
  const fail = (what, gap) => {
    throw new Error(`${what}: ${gap.toFixed(1)}px clear, want >= ${CLEARANCE}`);
  };
  for (const b of bars) {
    for (const x of [b.x, b.x + BAR_W]) {
      if (x < tail.x || x > tip.x) continue;
      const yOnLine = tail.y + ((x - tail.x) / dx) * dy;
      const gap = b.top - (yOnLine + STROKE / 2);
      if (gap < CLEARANCE) fail(`shaft over the bar at x=${x}`, gap);
    }
  }
  const tallest = bars.reduce((t, b) => (b.top < t.top ? b : t));
  const headLow = Math.max(corner1.y, corner2.y);
  if (tallest.top - headLow < CLEARANCE) {
    fail("arrowhead over the tallest bar", tallest.top - headLow);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#4b96ec"/>
      <stop offset="52%" stop-color="#1c5cab"/>
      <stop offset="100%" stop-color="#46339f"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.24"/>
      <stop offset="55%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.24" cy="0.14" r="0.75">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="${s}" height="${s}" rx="116" fill="url(#brand)"/>
  <rect width="${s}" height="${s}" rx="116" fill="url(#glow)"/>
  <rect width="${s}" height="${s}" rx="116" fill="url(#sheen)"/>
  <!-- A hairline just inside the edge, so the tile keeps its shape against a
       white home screen or a light browser tab. -->
  <rect x="2.5" y="2.5" width="${s - 5}" height="${s - 5}" rx="114"
        fill="none" stroke="#ffffff" stroke-opacity="0.11" stroke-width="5"/>

  <g transform="translate(${s * inset} ${s * inset}) scale(${scale})">
    <!-- The floor the bars stand on. Without it they hang in the middle of
         the tile and stop reading as a chart. -->
    <rect x="96" y="${FLOOR}" width="320" height="12" rx="6"
          fill="#ffffff" opacity="0.4"/>
${bars
  .map(
    (b) =>
      `    <rect x="${b.x}" y="${b.top}" width="${BAR_W}" height="${FLOOR - b.top + 4}" rx="24" fill="#ffffff" opacity="${b.alpha}"/>`
  )
  .join('\n')}

    <path d="M${tail.x} ${tail.y} L${pt(shaftEnd).replace(',', ' ')}"
          fill="none" stroke="#ffffff" stroke-width="${STROKE}" stroke-linecap="round"/>
    <polygon points="${pt(tip)} ${pt(corner1)} ${pt(notch)} ${pt(corner2)}" fill="#ffffff"/>
  </g>
</svg>`;
}

const png = (markup, size) =>
  sharp(Buffer.from(markup)).resize(size, size).png().toBuffer();

const targets = [
  { file: "public/icon-192.png", size: 192, opts: {} },
  { file: "public/icon-512.png", size: 512, opts: {} },
  { file: "public/icon-maskable-512.png", size: 512, opts: { inset: 0.14 } },
  { file: "app/icon.png", size: 512, opts: {} },
  { file: "app/apple-icon.png", size: 180, opts: { inset: 0.06 } },
];

for (const t of targets) {
  const buf = await png(svg(t.opts), t.size);
  await sharp(buf).toFile(path.join(root, t.file));
  console.log(`wrote ${t.file} (${t.size}px)`);
}
