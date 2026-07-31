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

/** Rising bars + trend arrow on a brand gradient.
 *  `inset` leaves the safe zone that maskable icons need. */
function svg({ inset = 0 } = {}) {
  const s = 512;
  const scale = 1 - inset * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3d8ae8"/>
      <stop offset="55%" stop-color="#1c5cab"/>
      <stop offset="100%" stop-color="#4a3aa7"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.22"/>
      <stop offset="60%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${s}" height="${s}" rx="120" fill="url(#brand)"/>
  <rect width="${s}" height="${s}" rx="120" fill="url(#sheen)"/>
  <g transform="translate(${s * inset} ${s * inset}) scale(${scale})">
    <rect x="104" y="300" width="72" height="108" rx="22" fill="#ffffff" opacity="0.55"/>
    <rect x="220" y="248" width="72" height="160" rx="22" fill="#ffffff" opacity="0.78"/>
    <rect x="336" y="176" width="72" height="232" rx="22" fill="#ffffff"/>
    <path d="M128 236 L246 166 L372 96" fill="none" stroke="#ffffff" stroke-width="28"
          stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M296 92 L380 92 L380 176" fill="none" stroke="#ffffff" stroke-width="28"
          stroke-linecap="round" stroke-linejoin="round"/>
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
