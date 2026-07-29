/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Photo strip — the canonical photo-booth format, and the one thing the booth
 * did not have.
 *
 * A strip is N shots taken in quick succession and composited into ONE image.
 * That last word is the whole design: the strip leaves the render pipeline
 * completely alone. Each panel comes from the booth's existing
 * `StageCanvas.capturePhoto()` (unchanged, watermark and all), and this module
 * only decides where the panels go and paints them onto a fresh canvas. The
 * result is an ordinary 9:16 JPEG, so review, the challenge check, submitPost,
 * the wall and the keepsake card all receive exactly the shape they already
 * handle and need no changes whatsoever.
 *
 * Everything except the final `drawImage` loop is pure and tested.
 */

/** Panels in a strip. Three is the format's own convention and it fits 9:16
 *  without the panels becoming letterbox slivers. */
export const STRIP_SHOTS = 3;

/** Milliseconds of "hold that" between the shutter of one panel and the
 *  countdown of the next. Long enough to change your face, short enough that
 *  nobody in the queue thinks it has hung. */
export const STRIP_GAP_MS = 1400;

/** Seconds counted down before each panel after the first (the first uses the
 *  guest's own timer setting). */
export const STRIP_LEAD_SEC = 3;

export interface PanelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StripLayout {
  width: number;
  height: number;
  panels: PanelRect[];
  /** Outer margin / gutter in px, exposed so the caller paints the backing
   *  card to the same measurements. */
  pad: number;
  gap: number;
  /** Vertical space reserved under the last panel for the event footer. */
  footerH: number;
}

/**
 * Lay `shots` panels down a 9:16 card.
 *
 * The panels are the SAME aspect as the source captures (9:16) so nothing is
 * distorted — which means the strip cannot simply divide the height. Instead
 * the panel width is derived from the height each panel may occupy, and the
 * whole stack is centred horizontally. A 3-panel strip on 1080x1920 therefore
 * lands three ~314x559 panels, each a true 9:16 crop of its capture.
 */
export function stripLayout(width: number, height: number, shots = STRIP_SHOTS): StripLayout {
  const safeShots = Math.max(1, Math.floor(shots));
  const pad = Math.round(width * 0.045);
  const gap = Math.round(width * 0.028);
  const footerH = Math.round(height * 0.062);

  const usableH = height - pad * 2 - footerH - gap * (safeShots - 1);
  const panelH = Math.max(1, Math.floor(usableH / safeShots));
  // Keep the source aspect; never stretch a capture to fill the card.
  const panelW = Math.min(Math.round((panelH * 9) / 16), width - pad * 2);
  const x = Math.round((width - panelW) / 2);

  const panels: PanelRect[] = [];
  for (let i = 0; i < safeShots; i += 1) {
    panels.push({ x, y: pad + i * (panelH + gap), w: panelW, h: panelH });
  }
  return { width, height, panels, pad, gap, footerH };
}

/**
 * How many shots are still owed after `taken`.
 *
 * Exists so the booth's phase machine never does the arithmetic inline: an
 * off-by-one here is a strip that either posts early or never posts at all.
 */
export function shotsRemaining(taken: number, total = STRIP_SHOTS): number {
  return Math.max(0, total - Math.max(0, taken));
}

/** True once every panel has been captured. */
export function stripComplete(taken: number, total = STRIP_SHOTS): boolean {
  return shotsRemaining(taken, total) === 0;
}

/**
 * Human label for the strip's progress pill, 1-based ("Shot 2 of 3").
 * Clamped, so a stray index can never render "Shot 0 of 3" or "Shot 4 of 3".
 */
export function stripProgressLabel(taken: number, total = STRIP_SHOTS): string {
  const n = Math.min(total, Math.max(0, taken) + 1);
  return `Shot ${n} of ${total}`;
}

/**
 * Composite captured panels into one strip image.
 *
 * IMPERATIVE half — kept tiny, and every failure path is explicit:
 *   • a source that fails to decode is SKIPPED, leaving its slot as the card
 *     background rather than aborting a strip the guest already posed for;
 *   • no 2D context (a browser that refuses one) rejects, and the caller falls
 *     back to posting the last single capture.
 *
 * `sources` are the data-URLs from `capturePhoto()`, in order.
 */
export async function composeStrip(
  sources: string[],
  opts: {
    width: number;
    height: number;
    /** Card background — the booth passes the event's noir. */
    background: string;
    /** Panel border / rule colour. */
    accent: string;
    /** Footer line; omitted when the event has no signature to add. */
    footer?: string;
  },
): Promise<string> {
  const layout = stripLayout(opts.width, opts.height, sources.length);
  const canvas = document.createElement('canvas');
  canvas.width = opts.width;
  canvas.height = opts.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context for strip');

  ctx.fillStyle = opts.background;
  ctx.fillRect(0, 0, opts.width, opts.height);

  const images = await Promise.all(sources.map(loadOrNull));

  images.forEach((img, i) => {
    const rect = layout.panels[i];
    if (!rect) return;
    if (img) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.clip();
      // Cover-fit: sources are already 9:16 like the panel, so this is a plain
      // scale — but a caller passing an odd source still gets a crop, never a
      // stretch.
      const srcA = img.width / img.height;
      const dstA = rect.w / rect.h;
      let sw = img.width, sh = img.height, sx = 0, sy = 0;
      if (srcA > dstA) { sw = img.height * dstA; sx = (img.width - sw) / 2; }
      else { sh = img.width / dstA; sy = (img.height - sh) / 2; }
      ctx.drawImage(img, sx, sy, sw, sh, rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
    }
    ctx.strokeStyle = opts.accent;
    ctx.lineWidth = Math.max(1, Math.round(opts.width * 0.003));
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  });

  if (opts.footer) {
    const last = layout.panels[layout.panels.length - 1];
    const baseline = (last ? last.y + last.h : opts.height - layout.footerH) + layout.footerH * 0.62;
    ctx.fillStyle = opts.accent;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `italic 600 ${Math.round(opts.width * 0.038)}px Georgia, "Times New Roman", serif`;
    ctx.fillText(opts.footer, opts.width / 2, baseline);
  }

  return canvas.toDataURL('image/jpeg', 0.9);
}

function loadOrNull(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // skip this panel; never fail the strip
    img.src = src;
  });
}
