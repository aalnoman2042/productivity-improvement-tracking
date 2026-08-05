/**
 * Generates the install-sheet screenshots referenced from app/manifest.ts.
 *   node scripts/make-screenshots.mjs
 *
 * Chrome shows these on the rich install dialog. They're drawn, not
 * captured — stylised but honest mockups of the log and the stats page,
 * in the app's real palette.
 */
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const BG = "#f3f4f6";
const CARD = "#ffffff";
const EDGE = "#e5e7eb";
const TEXT = "#111827";
const DIM = "#6b7280";
const ACCENT = "#1c5cab";
const GRAD = `<linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0%" stop-color="#2a78d6"/><stop offset="55%" stop-color="#1c5cab"/>
  <stop offset="100%" stop-color="#4a3aa7"/></linearGradient>`;

const FONT = `font-family="Segoe UI, Roboto, sans-serif"`;

function header(w) {
  return `
  <rect width="${w}" height="132" fill="${CARD}"/>
  <rect y="130" width="${w}" height="2" fill="${EDGE}"/>
  <circle cx="86" cy="66" r="30" fill="url(#brand)"/>
  <text x="136" y="82" ${FONT} font-size="44" font-weight="700" fill="${ACCENT}">PIT</text>`;
}

function trackerRow(y, w, name, value, color, pct) {
  const barW = Math.round((w - 400) * pct);
  return `
  <rect x="48" y="${y}" width="${w - 96}" height="128" rx="18" fill="${CARD}" stroke="${EDGE}" stroke-width="2"/>
  <circle cx="110" cy="${y + 64}" r="16" fill="${color}"/>
  <text x="150" y="${y + 58}" ${FONT} font-size="36" font-weight="600" fill="${TEXT}">${name}</text>
  <rect x="150" y="${y + 78}" width="${w - 400}" height="14" rx="7" fill="${BG}"/>
  <rect x="150" y="${y + 78}" width="${barW}" height="14" rx="7" fill="${color}"/>
  <text x="${w - 78}" y="${y + 74}" ${FONT} font-size="34" font-weight="700" fill="${TEXT}" text-anchor="end">${value}</text>`;
}

function logShot(w, h) {
  const rows = [
    ["Sleep", "7h 20m", "#4a3aa7", 0.9],
    ["Namaz", "5/5", "#008300", 1],
    ["Self study", "3h 10m", "#2a78d6", 0.85],
    ["Workout", "45m", "#eb6834", 0.7],
    ["Water", "8 glasses", "#eda100", 1],
    ["Quran", "20m", "#1baf7a", 0.8],
    ["No fap", "34 days", "#4a3aa7", 1],
    ["Weight", "72.4 kg", "#008300", 0.6],
  ];
  let y = 320;
  const rowSvg = rows
    .map((r) => {
      const s = trackerRow(y, w, r[0], r[1], r[2], r[3]);
      y += 152;
      return s;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs>${GRAD}</defs>
  <rect width="${w}" height="${h}" fill="${BG}"/>
  ${header(w)}
  <text x="48" y="220" ${FONT} font-size="52" font-weight="700" fill="${TEXT}">Daily log</text>
  <text x="48" y="272" ${FONT} font-size="34" fill="${DIM}">Tap or type — it saves itself.</text>
  ${rowSvg}
  <rect x="48" y="${y + 8}" width="${w - 96}" height="100" rx="18" fill="url(#brand)"/>
  <text x="${w / 2}" y="${y + 72}" ${FONT} font-size="40" font-weight="600" fill="#ffffff" text-anchor="middle">8 of 8 filled in 🎉</text>
  </svg>`;
}

function bars(x, y, w, h, values, color) {
  const gap = 18;
  const bw = (w - gap * (values.length - 1)) / values.length;
  return values
    .map((v, i) => {
      const bh = Math.round(h * v);
      return `<rect x="${x + i * (bw + gap)}" y="${y + h - bh}" width="${bw}" height="${bh}" rx="8" fill="${color}" opacity="${0.55 + 0.45 * v}"/>`;
    })
    .join("");
}

function statsShot(w, h) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs>${GRAD}</defs>
  <rect width="${w}" height="${h}" fill="${BG}"/>
  ${header(w)}
  <text x="48" y="220" ${FONT} font-size="52" font-weight="700" fill="${TEXT}">Stats</text>
  <text x="48" y="272" ${FONT} font-size="34" fill="${DIM}">A week of your time, at a glance.</text>

  <rect x="48" y="310" width="${(w - 120) / 2}" height="150" rx="18" fill="${CARD}" stroke="${EDGE}" stroke-width="2"/>
  <text x="76" y="380" ${FONT} font-size="52" font-weight="700" fill="${TEXT}">24h 30m</text>
  <text x="76" y="428" ${FONT} font-size="30" fill="${DIM}">time logged</text>
  <rect x="${48 + (w - 120) / 2 + 24}" y="310" width="${(w - 120) / 2}" height="150" rx="18" fill="${CARD}" stroke="${EDGE}" stroke-width="2"/>
  <text x="${76 + (w - 120) / 2 + 24}" y="380" ${FONT} font-size="52" font-weight="700" fill="${TEXT}">86%</text>
  <text x="${76 + (w - 120) / 2 + 24}" y="428" ${FONT} font-size="30" fill="${DIM}">goals met</text>

  <rect x="48" y="500" width="${w - 96}" height="560" rx="18" fill="${CARD}" stroke="${EDGE}" stroke-width="2"/>
  <text x="84" y="570" ${FONT} font-size="36" font-weight="600" fill="${TEXT}">Study — this week</text>
  ${bars(84, 620, w - 168, 380, [0.55, 0.8, 0.65, 1, 0.45, 0.9, 0.75], ACCENT)}

  <rect x="48" y="1100" width="${w - 96}" height="560" rx="18" fill="${CARD}" stroke="${EDGE}" stroke-width="2"/>
  <text x="84" y="1170" ${FONT} font-size="36" font-weight="600" fill="${TEXT}">Sleep — hours per night</text>
  ${bars(84, 1220, w - 168, 380, [0.7, 0.75, 0.6, 0.85, 0.8, 0.95, 0.9], "#4a3aa7")}

  <text x="${w / 2}" y="${h - 80}" ${FONT} font-size="32" fill="${DIM}" text-anchor="middle">Sleep · study · namaz · streaks — all in one place</text>
  </svg>`;
}

function wideShot(w, h) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs>${GRAD}</defs>
  <rect width="${w}" height="${h}" fill="${BG}"/>
  ${header(w)}
  <text x="64" y="230" ${FONT} font-size="48" font-weight="700" fill="${TEXT}">Your week, side by side</text>

  <rect x="64" y="280" width="${(w - 192) / 2}" height="620" rx="18" fill="${CARD}" stroke="${EDGE}" stroke-width="2"/>
  <text x="100" y="350" ${FONT} font-size="34" font-weight="600" fill="${TEXT}">Study</text>
  ${bars(100, 400, (w - 192) / 2 - 72, 440, [0.55, 0.8, 0.65, 1, 0.45, 0.9, 0.75], ACCENT)}

  <rect x="${64 + (w - 192) / 2 + 64}" y="280" width="${(w - 192) / 2}" height="620" rx="18" fill="${CARD}" stroke="${EDGE}" stroke-width="2"/>
  <text x="${100 + (w - 192) / 2 + 64}" y="350" ${FONT} font-size="34" font-weight="600" fill="${TEXT}">Sleep</text>
  ${bars(100 + (w - 192) / 2 + 64, 400, (w - 192) / 2 - 72, 440, [0.7, 0.75, 0.6, 0.85, 0.8, 0.95, 0.9], "#4a3aa7")}

  <text x="${w / 2}" y="${h - 60}" ${FONT} font-size="30" fill="${DIM}" text-anchor="middle">Track everything that makes a day good — and watch the trends.</text>
  </svg>`;
}

const targets = [
  { file: "public/screenshot-log.png", svg: logShot(1080, 1920) },
  { file: "public/screenshot-stats.png", svg: statsShot(1080, 1920) },
  { file: "public/screenshot-wide.png", svg: wideShot(1920, 1080) },
];

for (const t of targets) {
  await sharp(Buffer.from(t.svg)).png().toFile(path.join(root, t.file));
  console.log(`wrote ${t.file}`);
}
