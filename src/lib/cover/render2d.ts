/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Magazine cover Frames: draws a resolved cover (spec.ts) onto a canvas.
 *
 *  - `renderCover2D` makes the 1080×1920 selfie Frame: masthead across the
 *    top, cover lines down the sides, the guests' names as the cover star,
 *    a banner across the bottom, garnish sprites in the corners, and a CLEAR
 *    middle so nobody standing in it is covered.
 *  - The block painters (`paintLineBlock`, `paintStarBlock`, …) are shared
 *    with the AR cover, which floats the very same blocks in front of its
 *    frame (components/booth/CoverStage3D.tsx), so the two never drift.
 *
 * Fonts are the self-hosted OFL faces in public/fonts/cover, loaded on
 * demand with FontFace (an SVG frame could not use them: an <img>-loaded
 * SVG never sees web fonts, which is why this is a canvas).
 */
import {
  COVER_FONT_FACES, COVER_SCRIPT_FACE, coverFontCss,
  type CoverFontFace, type CoverFontId, type CoverTemplate, type GarnishId,
} from './templates';
import type { ResolvedCover, ResolvedLine } from './spec';

export const COVER_CANVAS_W = 1080;
export const COVER_CANVAS_H = 1920;
const FONT_BASE = '/fonts/cover/';
const SCRIPT = `"${COVER_SCRIPT_FACE.family}", "Brush Script MT", cursive`;

/* ── Fonts and sprites ─────────────────────────────────────────────────── */

const faceLoads = new Map<string, Promise<void>>();

function loadFace(f: CoverFontFace): Promise<void> {
  const key = `${f.family}|${f.weight}|${f.style}`;
  let p = faceLoads.get(key);
  if (!p) {
    p = (async () => {
      if (typeof FontFace === 'undefined' || typeof document === 'undefined') return;
      const face = new FontFace(f.family, `url(${FONT_BASE}${f.file}) format("woff2")`, { weight: f.weight, style: f.style, display: 'block' });
      await face.load();
      document.fonts.add(face);
    })();
    // A failed font must not poison the cache: a later cover retries it.
    p.catch(() => { if (faceLoads.get(key) === p) faceLoads.delete(key); });
    faceLoads.set(key, p);
  }
  return p;
}

/** Load the faces a cover needs. A face that fails falls back to Georgia: the cover still renders. */
export async function loadCoverFonts(ids: readonly CoverFontId[]): Promise<void> {
  const faces = [...new Set(ids)].flatMap((id) => COVER_FONT_FACES[id]);
  await Promise.allSettled([...faces, COVER_SCRIPT_FACE].map(loadFace));
}

const spriteLoads = new Map<GarnishId, Promise<HTMLImageElement | null>>();

/** A garnish's 2D sprite (public/models/garnish/<id>.webp); null if it will not load. */
export function loadGarnishSprite(id: GarnishId): Promise<HTMLImageElement | null> {
  let p = spriteLoads.get(id);
  if (!p) {
    p = new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => { spriteLoads.delete(id); resolve(null); };
      img.src = `/models/garnish/${id}.webp`;
    });
    spriteLoads.set(id, p);
  }
  return p;
}

/* ── Type helpers ──────────────────────────────────────────────────────── */

type Ctx = CanvasRenderingContext2D;
type Align = 'left' | 'right' | 'center';

/** Greedy word wrap. A single word wider than the line stays whole (the caller shrinks the size). */
export function wrapWords(measure: (s: string) => number, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && measure(next) > maxWidth) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Widest line at this size, with tracking. */
function trackedWidth(ctx: Ctx, text: string, tracking: number, px: number): number {
  return ctx.measureText(text).width + Math.max(0, [...text].length - 1) * tracking * px;
}

/** fillText with letter spacing done by hand (canvas letterSpacing is not on every iPhone). */
function fillTracked(ctx: Ctx, text: string, x: number, y: number, tracking: number, px: number, align: Align): void {
  if (tracking === 0) {
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
    return;
  }
  const w = trackedWidth(ctx, text, tracking, px);
  let cx = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  ctx.textAlign = 'left';
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + tracking * px;
  }
}

/** Soft halo behind type: what keeps it readable over any photo. */
function glow(ctx: Ctx, t: CoverTemplate, strength = 1): void {
  ctx.shadowColor = t.glow;
  ctx.shadowBlur = 16 * strength;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2 * strength;
}

function noGlow(ctx: Ctx): void {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

/**
 * Wrapped text at the largest size ≤ `px` that fits `maxLines` lines in
 * `width`. Returns the bottom y.
 */
function paintWrapped(
  ctx: Ctx, text: string, x: number, y: number, width: number, align: Align,
  font: (px: number) => string, px: number, maxLines: number, lineGap = 1.06, minPx = px * 0.55,
): number {
  let size = px;
  let lines: string[] = [];
  for (; size >= minPx; size -= 2) {
    ctx.font = font(size);
    lines = wrapWords((s) => ctx.measureText(s).width, text, width);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= width)) break;
  }
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  let cy = y;
  for (const l of lines.slice(0, maxLines)) {
    cy += size * 0.92;
    ctx.fillText(l, x, cy);
    cy += size * (lineGap - 0.92);
  }
  return cy;
}

/* ── Blocks (shared with the AR cover) ─────────────────────────────────── */

/** Kicker / head / deck. Returns the bottom y. `s` scales every size. */
export function paintLineBlock(ctx: Ctx, t: CoverTemplate, line: ResolvedLine, x: number, y: number, width: number, align: Align, s = 1): number {
  let cy = y;
  glow(ctx, t, s);
  if (line.kicker) {
    ctx.fillStyle = t.accent;
    ctx.font = coverFontCss('anton', 30 * s);
    ctx.textBaseline = 'alphabetic';
    fillTracked(ctx, line.kicker.toUpperCase(), x, cy + 30 * s, 0.08, 30 * s, align);
    cy += 42 * s;
  }
  ctx.fillStyle = t.ink;
  cy = paintWrapped(ctx, line.head, x, cy, width, align, (px) => coverFontCss(t.lineFont, px), 62 * s, 3);
  if (line.deck) {
    ctx.fillStyle = t.ink;
    cy = paintWrapped(ctx, line.deck, x, cy + 8 * s, width, align, (px) => coverFontCss('playfair', px, { italic: true, light: true }), 30 * s, 3, 1.2);
  }
  noGlow(ctx);
  return cy;
}

/** The cover star: the guests' names, big. Returns the bottom y. */
export function paintStarBlock(ctx: Ctx, t: CoverTemplate, star: ResolvedCover['star'], x: number, y: number, width: number, align: Align, s = 1): number {
  let cy = y;
  glow(ctx, t, s);
  ctx.fillStyle = t.accent;
  ctx.font = coverFontCss('anton', 30 * s);
  fillTracked(ctx, star.kicker.toUpperCase(), x, cy + 30 * s, 0.1, 30 * s, align);
  cy += 40 * s;
  ctx.fillStyle = t.ink;
  // One line when it fits at a good size, else two.
  const script = (px: number) => `400 ${Math.round(px)}px ${SCRIPT}`;
  ctx.font = script(84 * s);
  const oneLine = ctx.measureText(star.names).width <= width;
  cy = paintWrapped(ctx, star.names, x, cy, width, align, script, 120 * s, oneLine ? 1 : 2, 0.98, oneLine ? 84 * s : 54 * s);
  if (star.deck) {
    ctx.fillStyle = t.ink;
    cy = paintWrapped(ctx, star.deck, x, cy + 10 * s, width, align, (px) => coverFontCss('playfair', px, { italic: true, light: true }), 34 * s, 2, 1.2);
  }
  noGlow(ctx);
  return cy;
}

/** "WEDDING of the YEAR", centred on `cx`, fitted to `width`. Returns the bottom y. */
export function paintBanner(ctx: Ctx, t: CoverTemplate, banner: readonly [string, string, string], cx: number, y: number, width: number, s = 1): number {
  const [a, mid, b] = banner;
  let big = 116 * s;
  let small = 86 * s;
  const bigFont = (px: number) => coverFontCss(t.masthead.font === 'creepster' ? 'creepster' : 'anton', px);
  const smallFont = (px: number) => `400 ${Math.round(px)}px ${SCRIPT}`;
  const measure = () => {
    ctx.font = bigFont(big);
    const wa = ctx.measureText(a.toUpperCase()).width;
    const wb = ctx.measureText(b.toUpperCase()).width;
    ctx.font = smallFont(small);
    const wm = ctx.measureText(mid).width;
    return { wa, wb, wm, gap: 18 * s, total: wa + wb + wm + 36 * s };
  };
  let m = measure();
  while (m.total > width && big > 40) { big *= 0.95; small *= 0.95; m = measure(); }
  let x = cx - m.total / 2;
  const base = y + big * 0.9;
  glow(ctx, t, s * 1.2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = t.ink;
  ctx.font = bigFont(big);
  ctx.fillText(a.toUpperCase(), x, base);
  x += m.wa + m.gap;
  ctx.fillStyle = t.accent;
  ctx.font = smallFont(small);
  ctx.fillText(mid, x, base - big * 0.12);
  x += m.wm + m.gap;
  ctx.fillStyle = t.ink;
  ctx.font = bigFont(big);
  ctx.fillText(b.toUpperCase(), x, base);
  noGlow(ctx);
  return base + big * 0.15;
}

/** Issue strap: "THE WEDDING ISSUE ·  June 14, 2027", between two hairlines. Returns the bottom y. */
export function paintIssueStrap(ctx: Ctx, t: CoverTemplate, issue: string, dateLine: string, x0: number, x1: number, y: number, s = 1): number {
  const h = 52 * s;
  glow(ctx, t, s * 0.7);
  ctx.strokeStyle = t.accent;
  ctx.lineWidth = 3 * s;
  ctx.beginPath();
  ctx.moveTo(x0, y); ctx.lineTo(x1, y);
  ctx.moveTo(x0, y + h); ctx.lineTo(x1, y + h);
  ctx.stroke();
  ctx.textBaseline = 'middle';
  ctx.fillStyle = t.accent;
  ctx.font = coverFontCss('anton', 28 * s);
  fillTracked(ctx, issue.toUpperCase(), x0, y + h / 2 + 1, 0.12, 28 * s, 'left');
  ctx.fillStyle = t.ink;
  ctx.font = coverFontCss('playfair', 30 * s, { italic: true });
  ctx.textAlign = 'right';
  const max = (x1 - x0) * 0.48;
  let label = dateLine;
  while (label.length > 4 && ctx.measureText(label).width > max) label = `${label.slice(0, -2).trimEnd()}…`;
  ctx.fillText(label, x1, y + h / 2 + 2);
  ctx.textBaseline = 'alphabetic';
  noGlow(ctx);
  return y + h;
}

/** The masthead, fitted to `width` and at most `maxH` tall, centred on `cx`. Returns the bottom y. */
export function paintMasthead(ctx: Ctx, t: CoverTemplate, text: string, cx: number, y: number, width: number, maxH: number): number {
  const tr = t.masthead.tracking;
  let px = maxH / 0.78;
  ctx.font = coverFontCss(t.masthead.font, px);
  const w = trackedWidth(ctx, text, tr, px);
  if (w > width) px *= width / w;
  ctx.font = coverFontCss(t.masthead.font, px);
  ctx.textBaseline = 'alphabetic';
  const cap = px * 0.74;
  glow(ctx, t, 1.6);
  ctx.fillStyle = t.ink;
  fillTracked(ctx, text, cx, y + cap, tr, px, 'center');
  noGlow(ctx);
  return y + cap;
}

/* ── The selfie Frame ──────────────────────────────────────────────────── */

const FINISH_2D: Record<CoverTemplate['frame'], [string, string]> = {
  white: ['#fbfaf7', '#d9d4ca'],
  gold: ['#e9c96b', '#9c7424'],
  black: ['#18181c', '#3a3a42'],
  blush: ['#f4d3d3', '#c99595'],
  navy: ['#1b2a4a', '#0e1830'],
  red: ['#c4162f', '#7a0b1b'],
  pastel: ['#cfe3f7', '#f6cfe0'],
};

function paintBorder(ctx: Ctx, t: CoverTemplate, W: number, H: number): void {
  const band = 30;
  const [c0, c1] = FINISH_2D[t.frame];
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, c0);
  g.addColorStop(0.5, c1);
  g.addColorStop(1, c0);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.rect(band, band, W - band * 2, H - band * 2);
  ctx.fill('evenodd');
  ctx.strokeStyle = t.accent;
  ctx.lineWidth = 3;
  ctx.strokeRect(band + 14, band + 14, W - (band + 14) * 2, H - (band + 14) * 2);
}

function paintBarcode(ctx: Ctx, t: CoverTemplate, x: number, y: number): void {
  const w = 150;
  const h = 96;
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#111';
  // A fixed, made-up bar pattern (decoration, not a real code).
  const bars = [2, 1, 3, 1, 1, 2, 4, 1, 2, 1, 1, 3, 2, 2, 1, 1, 3, 1, 2, 4, 1, 1, 2, 1, 3, 2, 1, 2];
  let bx = x + 10;
  bars.forEach((b, i) => {
    if (i % 2 === 0) ctx.fillRect(bx, y + 10, b * 1.6, h - 38);
    bx += b * 1.6 + 1.4;
  });
  ctx.font = '600 16px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'left';
  ctx.fillText('0 12345 67890 5', x + 12, y + h - 10);
  void t;
}

async function paintSprites(ctx: Ctx, t: CoverTemplate, W: number, H: number): Promise<void> {
  const imgs = await Promise.all(t.garnish2d.map((g) => loadGarnishSprite(g.id)));
  t.garnish2d.forEach((g, i) => {
    const img = imgs[i];
    if (!img) return;
    const w = g.w * W;
    const h = w * (img.naturalHeight / Math.max(1, img.naturalWidth));
    ctx.save();
    ctx.translate(g.x * W, g.y * H);
    ctx.rotate(((g.rot ?? 0) * Math.PI) / 180);
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 10;
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  });
}

/** Where the barcode can go without landing under a garnish; null = nowhere. */
export function barcodeCorner(t: CoverTemplate): 'right' | 'left' | null {
  if (!t.barcode) return null;
  const busy = (side: 'left' | 'right') => t.garnish2d.some((g) => g.y > 0.7 && (side === 'left' ? g.x < 0.4 : g.x > 0.6));
  return !busy('right') ? 'right' : !busy('left') ? 'left' : null;
}

/** Draw the whole selfie Frame. Transparent everywhere nothing is printed. */
export async function renderCover2D(cover: ResolvedCover, canvas?: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  const t = cover.template;
  await loadCoverFonts([t.masthead.font, t.lineFont, 'anton', 'playfair']);
  const W = COVER_CANVAS_W;
  const H = COVER_CANVAS_H;
  const cv = canvas ?? document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.clearRect(0, 0, W, H);
  paintBorder(ctx, t, W, H);

  const pad = 78;
  const top = paintMasthead(ctx, t, cover.masthead, W / 2, 84, W - pad * 2, 250);
  const strapBottom = paintIssueStrap(ctx, t, cover.issue, cover.dateLine, pad, W - pad, top + 28);

  // Left column: the lead story and one more. Right: one line, then the star.
  const colW = 330;
  let ly = strapBottom + 54;
  for (const line of cover.left.slice(0, 2)) ly = paintLineBlock(ctx, t, line, pad, ly, colW, 'left') + 46;
  let ry = strapBottom + 54;
  for (const line of cover.right.slice(0, 1)) ry = paintLineBlock(ctx, t, line, W - pad, ry, 300, 'right') + 46;
  paintStarBlock(ctx, t, cover.star, W - pad, Math.max(ry, H * 0.6), 420, 'right');

  // Between the corner garnishes when there are any.
  const cornered = t.garnish2d.some((g) => g.y > 0.8);
  paintBanner(ctx, t, cover.banner, W / 2, H - 300, cornered ? W * 0.6 : W - pad * 2 - 40);
  const corner = barcodeCorner(t);
  if (corner) paintBarcode(ctx, t, corner === 'right' ? W - pad - 150 : pad, H - 196);
  await paintSprites(ctx, t, W, H);
  return cv;
}

/** A canvas as an object URL (the booth treats it like any Frame's art). */
export function canvasToObjectUrl(cv: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    cv.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('cover toBlob failed'))), 'image/png');
  });
}
