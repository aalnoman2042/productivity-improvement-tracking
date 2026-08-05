"use client";

import { useState } from "react";

/**
 * "Share as image" for the status page.
 *
 * The snapshot is drawn onto a canvas and handed to the phone's share sheet
 * as a PNG — no public URL, no auth hole, nothing readable by anyone the
 * user didn't send it to. Browsers without file-sharing (desktop, mostly)
 * download the same image instead.
 *
 * Colours are fixed rather than theme-derived: the image lands in other
 * people's chats, where "matches the sender's dark mode" means nothing.
 */

export type StatusShareData = {
  /** "1 week", "2 weeks", "Month" */
  rangeLabel: string;
  /** "Tuesday 5 Aug" */
  dateLabel: string;
  daysLogged: number;
  days: number;
  streak: number;
  /** "72%" — or "—" when no goals are set. */
  goalsPct: string;
  improve: { title: string; level: "bad" | "warn" }[];
  /** "Study — 5/7 days" */
  wins: string[];
  fails: string[];
};

const W = 1080;
const H = 1350;
const PAD = 72;

const BG = "#0d1526";
const CARD = "#16233a";
const TEXT = "#e2e8f0";
const DIM = "#94a3b8";
const RED = "#f87171";
const AMBER = "#fbbf24";
const GREEN = "#4ade80";

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

function rr(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/** Break `text` on spaces to fit `maxWidth`, keeping at most `maxLines`. */
function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const tryLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(tryLine).width <= maxWidth || !line) {
      line = tryLine;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && ctx.measureText(lines[maxLines - 1]).width > maxWidth) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, "…");
  }
  return lines;
}

function draw(data: StatusShareData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // Brand band along the top.
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, "#3987e5");
  grad.addColorStop(1, "#6a5ce0");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, 14);

  // Header
  ctx.fillStyle = grad;
  ctx.font = `800 60px ${FONT}`;
  ctx.fillText("PIT", PAD, 128);
  const pitWidth = ctx.measureText("PIT").width;
  ctx.fillStyle = TEXT;
  ctx.font = `700 52px ${FONT}`;
  ctx.fillText("· Status", PAD + pitWidth + 18, 128);

  ctx.fillStyle = DIM;
  ctx.font = `400 34px ${FONT}`;
  ctx.fillText(`${data.rangeLabel} · ${data.dateLabel}`, PAD, 184);

  // The three headline tiles
  const tileY = 236;
  const tileH = 180;
  const gap = 24;
  const tileW = (W - PAD * 2 - gap * 2) / 3;
  const tiles: { label: string; value: string; hint: string }[] = [
    {
      label: "Days logged",
      value: `${data.daysLogged}/${data.days}`,
      hint: "",
    },
    {
      label: "Logging streak",
      value: String(data.streak),
      hint: data.streak === 1 ? "day in a row" : "days in a row",
    },
    { label: "Goals hit", value: data.goalsPct, hint: "" },
  ];
  tiles.forEach((tile, i) => {
    const x = PAD + i * (tileW + gap);
    ctx.fillStyle = CARD;
    rr(ctx, x, tileY, tileW, tileH, 20);
    ctx.fill();
    ctx.fillStyle = DIM;
    ctx.font = `500 28px ${FONT}`;
    ctx.fillText(tile.label, x + 28, tileY + 54);
    ctx.fillStyle = TEXT;
    ctx.font = `800 60px ${FONT}`;
    ctx.fillText(tile.value, x + 28, tileY + 126);
    if (tile.hint) {
      ctx.fillStyle = DIM;
      ctx.font = `400 24px ${FONT}`;
      ctx.fillText(tile.hint, x + 28, tileY + 160);
    }
  });

  // Fix first
  let y = tileY + tileH + 84;
  ctx.fillStyle = TEXT;
  ctx.font = `700 40px ${FONT}`;
  ctx.fillText("Fix first", PAD, y);
  y += 22;

  if (data.improve.length === 0) {
    y += 44;
    ctx.fillStyle = GREEN;
    ctx.font = `500 32px ${FONT}`;
    ctx.fillText("Nothing stands out — keep going.", PAD, y);
    y += 30;
  } else {
    ctx.font = `500 32px ${FONT}`;
    for (const item of data.improve.slice(0, 4)) {
      const lines = wrap(ctx, item.title, W - PAD * 2 - 44, 2);
      for (let i = 0; i < lines.length; i++) {
        y += 48;
        if (i === 0) {
          ctx.fillStyle = item.level === "bad" ? RED : AMBER;
          ctx.beginPath();
          ctx.arc(PAD + 10, y - 11, 8, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = TEXT;
        ctx.fillText(lines[i], PAD + 44, y);
      }
      y += 8;
    }
  }

  // Goals, two columns: what's slipping and what's holding
  if (data.fails.length > 0 || data.wins.length > 0) {
    y += 72;
    const colW = (W - PAD * 2 - 48) / 2;
    const colY = y;
    const cols: { head: string; color: string; items: string[] }[] = [
      { head: "Falling short", color: RED, items: data.fails },
      { head: "Holding up", color: GREEN, items: data.wins },
    ];
    cols.forEach((col, i) => {
      if (col.items.length === 0) return;
      const x = PAD + i * (colW + 48);
      let cy = colY;
      ctx.fillStyle = col.color;
      ctx.font = `700 32px ${FONT}`;
      ctx.fillText(col.head, x, cy);
      ctx.font = `400 28px ${FONT}`;
      ctx.fillStyle = TEXT;
      for (const item of col.items.slice(0, 3)) {
        cy += 46;
        ctx.fillText(wrap(ctx, item, colW, 1)[0] ?? "", x, cy);
      }
    });
  }

  // Footer
  ctx.fillStyle = DIM;
  ctx.font = `400 26px ${FONT}`;
  ctx.fillText("Tracked with PIT — Productivity Improvement Tracker", PAD, H - 56);

  return canvas;
}

export default function ShareStatus({
  data,
  disabled = false,
}: {
  data: StatusShareData | null;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function share() {
    if (!data) return;
    setBusy(true);
    try {
      const canvas = draw(data);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png")
      );
      if (!blob) return;
      const file = new File([blob], "pit-status.png", { type: "image/png" });

      if (
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] })
      ) {
        try {
          await navigator.share({ files: [file], title: "My PIT status" });
          return;
        } catch (err) {
          // Backing out of the share sheet isn't an error, and it certainly
          // shouldn't be "rewarded" with an unasked-for download.
          if ((err as Error).name === "AbortError") return;
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "pit-status.png";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={share}
      disabled={disabled || busy || !data}
      className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full border border-edge px-3.5 py-1.5 text-sm font-medium text-secondary hover:bg-surface-2 disabled:opacity-40"
      title="Share this as an image"
    >
      <span aria-hidden="true">📤</span>
      {busy ? "Preparing…" : "Share"}
    </button>
  );
}
