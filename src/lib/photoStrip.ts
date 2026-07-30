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

/** The shot counts the booth's picker offers. */
export type StripShotCount = 2 | 3;
export const STRIP_SHOT_CHOICES: readonly StripShotCount[] = [2, 3];

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
  /** Panel corner radius, so painter and layout agree. */
  radius: number;
}

/**
 * Widest panel shape allowed per strip length. Panels used to keep the raw
 * 9:16 capture aspect, which left a 3-shot strip using ~29% of the card's
 * width — the "black space behind" the owner flagged. Panels now widen to
 * fill the card and the compositor cover-crops each capture into them
 * (face-biased, see CROP_FOCUS_Y): 2 shots stay portrait (4:5) so a pair
 * reads like two big moments; 3 shots go gently landscape (5:4) so the
 * classic strip fills the card edge to edge.
 */
export function stripPanelAspect(shots: number): number {
  return shots <= 2 ? 4 / 5 : 5 / 4;
}

/**
 * Lay `shots` panels down a 9:16 card.
 *
 * Panel height divides the usable column; panel width grows toward the card
 * edges but never past `stripPanelAspect(shots)`, so captures are cropped —
 * never stretched — and faces keep a flattering shape. The stack is centred
 * horizontally.
 */
export function stripLayout(width: number, height: number, shots = STRIP_SHOTS): StripLayout {
  const safeShots = Math.max(1, Math.floor(shots));
  const pad = Math.round(width * 0.04);
  const gap = Math.round(width * 0.028);
  const footerH = Math.round(height * 0.062);

  const usableH = height - pad * 2 - footerH - gap * (safeShots - 1);
  const panelH = Math.max(1, Math.floor(usableH / safeShots));
  let panelW = Math.min(Math.round(panelH * stripPanelAspect(safeShots)), width - pad * 2);
  // Keep the leftover width even, so the stack centres exactly instead of
  // sitting half a pixel off.
  if ((width - panelW) % 2 !== 0) panelW -= 1;
  const x = (width - panelW) / 2;

  const panels: PanelRect[] = [];
  for (let i = 0; i < safeShots; i += 1) {
    panels.push({ x, y: pad + i * (panelH + gap), w: panelW, h: panelH });
  }
  return { width, height, panels, pad, gap, footerH, radius: Math.round(width * 0.024) };
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
    /** Card base colour under the gradient wash — the booth passes the event's noir. */
    background: string;
    /** Panel border / rule colour. */
    accent: string;
    /** Event accent palette ([0] dominant) painted as the card's gradient
     *  ambience. Omitted ⇒ the wash derives from `accent` alone. */
    palette?: string[];
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

  paintCardBackground(ctx, opts.width, opts.height, opts.background, opts.palette ?? [opts.accent]);

  const images = await Promise.all(sources.map(loadOrNull));

  images.forEach((img, i) => {
    const rect = layout.panels[i];
    if (!rect) return;
    // Soft drop shadow behind the panel, so it floats on the card instead of
    // sitting flat against it.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = Math.round(opts.width * 0.022);
    ctx.shadowOffsetY = Math.round(opts.height * 0.004);
    ctx.fillStyle = opts.background;
    pathRoundedRect(ctx, rect.x, rect.y, rect.w, rect.h, layout.radius);
    ctx.fill();
    ctx.restore();
    if (img) {
      ctx.save();
      pathRoundedRect(ctx, rect.x, rect.y, rect.w, rect.h, layout.radius);
      ctx.clip();
      // Cover-fit crop, never a stretch. Panels are wider than the 9:16
      // captures now, so the vertical crop is biased toward the top of the
      // frame (CROP_FOCUS_Y) — that is where the booth asks guests to keep
      // their face.
      const srcA = img.width / img.height;
      const dstA = rect.w / rect.h;
      let sw = img.width, sh = img.height, sx = 0, sy = 0;
      if (srcA > dstA) { sw = img.height * dstA; sx = (img.width - sw) / 2; }
      else { sh = img.width / dstA; sy = (img.height - sh) * CROP_FOCUS_Y; }
      ctx.drawImage(img, sx, sy, sw, sh, rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
    }
    ctx.strokeStyle = hexToRgba(opts.accent, 0.75);
    ctx.lineWidth = Math.max(1, Math.round(opts.width * 0.003));
    pathRoundedRect(ctx, rect.x, rect.y, rect.w, rect.h, layout.radius);
    ctx.stroke();
  });

  // A hairline card border ties the composition together — the strip reads as
  // a designed keepsake rather than photos pasted on a void.
  ctx.strokeStyle = hexToRgba(opts.accent, 0.3);
  ctx.lineWidth = Math.max(2, Math.round(opts.width * 0.002));
  const inset = Math.round(layout.pad * 0.45);
  pathRoundedRect(
    ctx, inset, inset, opts.width - inset * 2, opts.height - inset * 2,
    Math.round(opts.width * 0.032),
  );
  ctx.stroke();

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

/** Vertical bias of the cover-crop: keep the band starting 30% into the
 *  leftover height, because faces sit above centre in a booth capture. */
const CROP_FOCUS_Y = 0.3;

/**
 * Card ambience: base fill, then a vertical wash and two radial glows drawn
 * from the event's accent palette — the canvas approximation of the app's
 * liquid-glass look. Pure gradients, no external assets, so it can never fail
 * a strip.
 */
function paintCardBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  base: string,
  palette: string[],
) {
  const a0 = palette[0] ?? '#E8C766';
  const a1 = palette[1] ?? a0;
  const a2 = palette[2] ?? a1;

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  const wash = ctx.createLinearGradient(0, 0, 0, h);
  wash.addColorStop(0, hexToRgba(a2, 0.2));
  wash.addColorStop(0.45, hexToRgba(a0, 0.06));
  wash.addColorStop(1, hexToRgba(a1, 0.16));
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, w, h);

  let glow = ctx.createRadialGradient(w * 0.18, h * 0.06, 0, w * 0.18, h * 0.06, w * 0.9);
  glow.addColorStop(0, hexToRgba(a0, 0.22));
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  glow = ctx.createRadialGradient(w * 0.85, h * 0.97, 0, w * 0.85, h * 0.97, w * 0.8);
  glow.addColorStop(0, hexToRgba(a1, 0.18));
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
}

/**
 * `#RGB` / `#RRGGBB` → `rgba(r,g,b,a)`. An unparseable value falls back to the
 * platform's warm gold rather than throwing mid-composite — the same default
 * the booth already uses when an event has no accent palette.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (m === null) return hexToRgba('#E8C766', alpha);
  let s = m[1];
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s, 16);
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${a})`;
}

/** Manual rounded-rect path — `ctx.roundRect` is still missing from some
 *  in-app browsers the booth runs in. */
function pathRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function loadOrNull(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // skip this panel; never fail the strip
    img.src = src;
  });
}
