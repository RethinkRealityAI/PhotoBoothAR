/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The card FACE and the PAPER the two lane-B reveals (airplane + stardust)
 * paint onto canvases for three.js. The layout maths is pure and tested in
 * lib/cardStardust.ts; this file only draws.
 *
 *   drawCardFace     — the printed face: dusk field, an arched photo window
 *                      (or the recipient's monogram), the title in Bricolage,
 *                      one warm sparkle, and fine filigree linework.
 *   paperRelief      — a HEIGHT field for the paper (fibres, the same
 *                      filigree raised so emboss and print line up, the
 *                      folds as grooves) turned into a tangent-space normal
 *                      map, plus a crease GLOW mask (R = the crease line,
 *                      G = a wide halo) the shader lights up.
 *
 * Text is drawn at 2× the size it will be seen at, after
 * `document.fonts.load`, so the canvas never falls back to a system face.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { heightToNormal, type V2 } from '../../../lib/cardFlight';
import { cardFaceLayout, coverCrop, fitTitle, mulberry32, type Rect } from '../../../lib/cardStardust';
import { cardMonogram, type CardPalette } from '../../../lib/cardPresentation';
import type { CardViewContribution, CardViewData } from '../../../lib/cards';
import { revealPhotos } from './types';

export const DISPLAY_FONT = "'Bricolage Grotesque Variable', 'Geist Variable', system-ui, sans-serif";
export const WARM_CORE = '#FFC56B';

/** Wait (bounded) for the display face, so canvases never paint a fallback. */
export async function ensureCardFonts(timeoutMs = 2500): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  const load = Promise.all([
    document.fonts.load(`600 64px 'Bricolage Grotesque Variable'`),
    document.fonts.load(`500 64px 'Bricolage Grotesque Variable'`),
  ]).then(() => undefined);
  await Promise.race([load.catch(() => undefined), new Promise<void>((r) => window.setTimeout(r, timeoutMs))]);
}

/** CORS-clean photo for canvas use, or null (load error, timeout, tainting host). */
export function loadPhoto(url: string, timeoutMs = 8000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    let settled = false;
    const finish = (v: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      resolve(v);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    img.onload = () => finish(img.naturalWidth > 0 ? img : null);
    img.onerror = () => finish(null);
    img.src = url;
  });
}

/** The dusk sky behind a reveal, from the card palette (light is where colour may be expressive). */
export function revealSky(bg: string, accentRgb: string): CSSProperties {
  return {
    backgroundColor: bg,
    backgroundImage: [
      `radial-gradient(120% 60% at 50% 112%, rgba(255,197,107,0.24), rgba(255,197,107,0) 62%)`,
      `radial-gradient(100% 55% at 50% -12%, rgba(${accentRgb},0.32), rgba(${accentRgb},0) 70%)`,
      `linear-gradient(180deg, color-mix(in oklab, ${bg} 62%, black) 0%, ${bg} 58%, color-mix(in oklab, ${bg} 82%, rgb(${accentRgb})) 100%)`,
    ].join(', '),
  };
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('2d canvas unavailable');
  return { canvas, ctx };
}

/** Arch: semicircular top, softly rounded bottom corners. */
function archPath(ctx: CanvasRenderingContext2D, r: Rect, grow = 0): void {
  const x = r.x - grow;
  const y = r.y - grow;
  const w = r.w + 2 * grow;
  const h = r.h + 2 * grow;
  const rad = w / 2;
  const rb = Math.min(w * 0.06, h * 0.1);
  ctx.beginPath();
  ctx.moveTo(x, y + rad);
  ctx.arc(x + rad, y + rad, rad, Math.PI, 0, false);
  ctx.lineTo(x + w, y + h - rb);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rb, y + h);
  ctx.lineTo(x + rb, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rb);
  ctx.closePath();
}

function roundRectPath(ctx: CanvasRenderingContext2D, r: Rect, rad: number): void {
  ctx.beginPath();
  ctx.moveTo(r.x + rad, r.y);
  ctx.lineTo(r.x + r.w - rad, r.y);
  ctx.quadraticCurveTo(r.x + r.w, r.y, r.x + r.w, r.y + rad);
  ctx.lineTo(r.x + r.w, r.y + r.h - rad);
  ctx.quadraticCurveTo(r.x + r.w, r.y + r.h, r.x + r.w - rad, r.y + r.h);
  ctx.lineTo(r.x + rad, r.y + r.h);
  ctx.quadraticCurveTo(r.x, r.y + r.h, r.x, r.y + r.h - rad);
  ctx.lineTo(r.x, r.y + rad);
  ctx.quadraticCurveTo(r.x, r.y, r.x + rad, r.y);
  ctx.closePath();
}

/** A small flower: `petals` ellipses around a centre. */
function rosette(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, petals = 6): void {
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.5, r * 0.22, a, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x, y, r * 0.18, 0, Math.PI * 2);
  ctx.stroke();
}

/** A curling vine with alternating leaves, from (x,y) heading `dir` (±1) outward and down. */
function vine(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, dir: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(x + dir * len * 0.35, y + len * 0.1, x + dir * len * 0.15, y + len * 0.55, x + dir * len * 0.5, y + len * 0.7);
  ctx.bezierCurveTo(x + dir * len * 0.75, y + len * 0.8, x + dir * len * 0.82, y + len * 0.55, x + dir * len * 0.62, y + len * 0.5);
  ctx.stroke();
  for (let i = 1; i <= 4; i++) {
    const t = i / 5;
    const lx = x + dir * len * (0.18 + 0.28 * t);
    const ly = y + len * (0.08 + 0.6 * t);
    const side = i % 2 === 0 ? 1 : -1;
    ctx.beginPath();
    ctx.ellipse(lx + side * dir * len * 0.07, ly - len * 0.03, len * 0.075, len * 0.028, dir * side * 0.7, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/**
 * The filigree both the print and the emboss share (so relief and ink align):
 * a double frame, scalloped beading, corner rosettes, a double arch round the
 * photo window with a finial and two vines.
 */
function filigree(ctx: CanvasRenderingContext2D, W: number, H: number, weight: number, detail: boolean): void {
  const l = cardFaceLayout(W, H);
  const u = W / 1000;
  ctx.lineWidth = weight * u;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  roundRectPath(ctx, l.frame, 22 * u);
  ctx.stroke();
  const inner = { x: l.frame.x + 14 * u, y: l.frame.y + 14 * u, w: l.frame.w - 28 * u, h: l.frame.h - 28 * u };
  roundRectPath(ctx, inner, 14 * u);
  ctx.stroke();
  if (detail) {
    // Beading between the two frame lines.
    const bead = 3.2 * u;
    const step = 22 * u;
    const mid = { x: l.frame.x + 7 * u, y: l.frame.y + 7 * u, w: l.frame.w - 14 * u, h: l.frame.h - 14 * u };
    for (let x = mid.x + 40 * u; x <= mid.x + mid.w - 40 * u; x += step) {
      for (const y of [mid.y, mid.y + mid.h]) {
        ctx.beginPath();
        ctx.arc(x, y, bead, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    for (let y = mid.y + 40 * u; y <= mid.y + mid.h - 40 * u; y += step) {
      for (const x of [mid.x, mid.x + mid.w]) {
        ctx.beginPath();
        ctx.arc(x, y, bead, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
  // Corner rosettes with a quarter-arc flourish.
  const cr = 30 * u;
  for (const [cx, cy, sx, sy] of [
    [inner.x, inner.y, 1, 1],
    [inner.x + inner.w, inner.y, -1, 1],
    [inner.x, inner.y + inner.h, 1, -1],
    [inner.x + inner.w, inner.y + inner.h, -1, -1],
  ] as const) {
    rosette(ctx, cx + sx * cr * 1.2, cy + sy * cr * 1.2, cr * 0.7);
    ctx.beginPath();
    ctx.arc(cx, cy, cr * 2.6, sx > 0 ? (sy > 0 ? 0 : -Math.PI / 2) : sy > 0 ? Math.PI / 2 : Math.PI, sx > 0 ? (sy > 0 ? Math.PI / 2 : 0) : sy > 0 ? Math.PI : (3 * Math.PI) / 2);
    ctx.stroke();
  }
  // Double arch round the photo window, finial, vines from its shoulders.
  archPath(ctx, l.photo, 16 * u);
  ctx.stroke();
  archPath(ctx, l.photo, 30 * u);
  ctx.stroke();
  rosette(ctx, l.photo.x + l.photo.w / 2, l.photo.y - 52 * u, 18 * u, 8);
  if (detail) {
    const shoulder = l.photo.y + l.photo.w / 2;
    vine(ctx, l.photo.x - 34 * u, shoulder, 120 * u, -1);
    vine(ctx, l.photo.x + l.photo.w + 34 * u, shoulder, 120 * u, 1);
  }
}

function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.closePath();
  ctx.fill();
}

export interface FaceInput {
  title: string;
  monogram: string;
  photo: HTMLImageElement | null;
  palette: CardPalette;
}

/** Paint the printed card face (W×H px, drawn at 2× its on-screen size). */
export function drawCardFace(W: number, H: number, input: FaceInput): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(W, H);
  const { palette } = input;
  const l = cardFaceLayout(W, H);
  const u = W / 1000;

  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, W, H);
  // Light on the field (light is where colour may be expressive).
  let g = ctx.createRadialGradient(W / 2, H * 0.2, 0, W / 2, H * 0.2, H * 0.75);
  g.addColorStop(0, rgba(palette.accent, 0.42));
  g.addColorStop(1, rgba(palette.accent, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  g = ctx.createRadialGradient(W / 2, H * 1.02, 0, W / 2, H * 1.02, H * 0.55);
  g.addColorStop(0, rgba(WARM_CORE, 0.16));
  g.addColorStop(1, rgba(WARM_CORE, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Filigree in pale ink.
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  filigree(ctx, W, H, 2.4, true);

  // Photo window (or the monogram in light).
  ctx.save();
  archPath(ctx, l.photo);
  ctx.clip();
  if (input.photo) {
    const c = coverCrop(input.photo.naturalWidth, input.photo.naturalHeight, l.photo.w, l.photo.h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(input.photo, c.x, c.y, c.w, c.h, l.photo.x, l.photo.y, l.photo.w, l.photo.h);
    g = ctx.createLinearGradient(0, l.photo.y + l.photo.h * 0.6, 0, l.photo.y + l.photo.h);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.16)');
    ctx.fillStyle = g;
    ctx.fillRect(l.photo.x, l.photo.y, l.photo.w, l.photo.h);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(l.photo.x, l.photo.y, l.photo.w, l.photo.h);
    g = ctx.createRadialGradient(W / 2, l.photo.y + l.photo.h * 0.55, 0, W / 2, l.photo.y + l.photo.h * 0.55, l.photo.w * 0.7);
    g.addColorStop(0, rgba(palette.accent, 0.4));
    g.addColorStop(1, rgba(palette.accent, 0));
    ctx.fillStyle = g;
    ctx.fillRect(l.photo.x, l.photo.y, l.photo.w, l.photo.h);
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.font = `500 ${Math.round(l.photo.w * 0.42)}px ${DISPLAY_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(input.monogram, W / 2, l.photo.y + l.photo.h * 0.58);
  }
  ctx.restore();
  ctx.lineWidth = 3 * u;
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  archPath(ctx, l.photo);
  ctx.stroke();

  // Title.
  const font = (size: number) => `600 ${size}px ${DISPLAY_FONT}`;
  const fit = fitTitle(
    input.title,
    { maxW: l.title.maxW, maxH: l.title.maxH },
    (s, size) => {
      ctx.font = font(size);
      return ctx.measureText(s).width;
    },
    { max: Math.round(112 * u), min: Math.round(44 * u), lineHeight: 1.06, maxLines: 3 },
  );
  ctx.font = font(fit.size);
  ctx.fillStyle = palette.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,0.18)';
  ctx.shadowBlur = 12 * u;
  const blockH = fit.lines.length * fit.size * 1.06;
  const y0 = l.title.y + Math.max(0, (l.title.maxH - blockH) * 0.3);
  fit.lines.forEach((line, i) => ctx.fillText(line, l.title.cx, y0 + i * fit.size * 1.06));
  ctx.shadowBlur = 0;

  // One warm sparkle, under the title.
  const sy = Math.min(l.sparkle.y, y0 + blockH + 46 * u);
  ctx.fillStyle = rgba(WARM_CORE, 0.25);
  ctx.beginPath();
  ctx.arc(W / 2, sy, l.sparkle.r * 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = WARM_CORE;
  sparkle(ctx, W / 2, sy, l.sparkle.r * 1.6);
  return canvas;
}

/**
 * The printed face as a canvas, ready as early as possible: painted with the
 * monogram as soon as the display font is in, then REPAINTED with the lead
 * photo when (if) it arrives — a slow venue connection never holds the
 * moment back, and a failed photo simply leaves the monogram.
 * `W === null` = not measured yet.
 */
export function useCardFace(
  W: number | null,
  H: number,
  card: CardViewData,
  contributions: CardViewContribution[],
  palette: CardPalette,
): HTMLCanvasElement | null {
  const [face, setFace] = useState<HTMLCanvasElement | null>(null);
  const { bg, fg, accent, accentRgb } = palette;
  const photoUrl = revealPhotos(contributions, 1)[0] ?? null;
  const { title, recipientName } = card;
  useEffect(() => {
    if (W === null) return;
    let live = true;
    let gotPhoto = false;
    const paint = (photo: HTMLImageElement | null) => {
      try {
        setFace(
          drawCardFace(W, H, {
            title,
            monogram: cardMonogram(recipientName, title),
            photo,
            palette: { bg, fg, accent, accentRgb },
          }),
        );
      } catch {
        // No 2D canvas: the reveal runs on plain stock; the template still follows.
      }
    };
    const fonts = ensureCardFonts();
    const photo = photoUrl ? loadPhoto(photoUrl, 12000) : Promise.resolve(null);
    void fonts.then(() => {
      if (live && !gotPhoto) paint(null);
    });
    void Promise.all([fonts, photo]).then(([, img]) => {
      if (!live || img === null) return;
      gotPhoto = true;
      paint(img);
    });
    return () => {
      live = false;
    };
  }, [W, H, title, recipientName, photoUrl, bg, fg, accent, accentRgb]);
  return face;
}

/** A glowing title (white on transparent) for the stardust core. */
export function drawTitleGlow(title: string, widthPx: number): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(widthPx, widthPx * 0.5);
  const fit = fitTitle(
    title,
    { maxW: widthPx * 0.86, maxH: widthPx * 0.36 },
    (s, size) => {
      ctx.font = `600 ${size}px ${DISPLAY_FONT}`;
      return ctx.measureText(s).width;
    },
    { max: Math.round(widthPx * 0.11), min: Math.round(widthPx * 0.05), lineHeight: 1.06, maxLines: 2 },
  );
  ctx.font = `600 ${fit.size}px ${DISPLAY_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lh = fit.size * 1.06;
  const y0 = canvas.height / 2 - ((fit.lines.length - 1) * lh) / 2;
  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  for (const blur of [widthPx * 0.04, widthPx * 0.012]) {
    ctx.shadowBlur = blur;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    fit.lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, y0 + i * lh));
  }
  return canvas;
}

export interface PaperMaps {
  /** Tangent-space normal map (embossed filigree, fibres, crease grooves). */
  normal: HTMLCanvasElement;
  /** R = crease line, G = wide crease halo. */
  glow: HTMLCanvasElement;
}

/**
 * Paper relief for a W×H sheet whose flat coordinates span x∈[-w,w], y∈[-h,h]
 * (creases come from lib/cardFlight buildDart).
 */
export function paperMaps(W: number, H: number, sheet: { w: number; h: number; creases: [V2, V2][] }): PaperMaps {
  const toPx = (p: V2): [number, number] => [((p[0] + sheet.w) / (2 * sheet.w)) * W, ((sheet.h - p[1]) / (2 * sheet.h)) * H];
  const { canvas: hc, ctx: h } = makeCanvas(W, H);
  h.fillStyle = 'rgb(128,128,128)';
  h.fillRect(0, 0, W, H);
  // Fibres: short random strands, a touch raised or sunk.
  const rng = mulberry32(20261120);
  h.lineWidth = 1;
  for (let i = 0; i < (W * H) / 260; i++) {
    const x = rng() * W;
    const y = rng() * H;
    const a = rng() * Math.PI;
    const len = 3 + rng() * 9;
    h.strokeStyle = rng() < 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    h.beginPath();
    h.moveTo(x, y);
    h.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    h.stroke();
  }
  // Lace: a fine diamond lattice of tiny rosettes over the whole sheet (reads on the plain back).
  const u = W / 1000;
  h.strokeStyle = 'rgba(255,255,255,0.16)';
  h.lineWidth = 1.6 * u;
  const cell = 64 * u;
  for (let y = 0, row = 0; y < H + cell; y += cell * 0.5, row++) {
    for (let x = row % 2 === 0 ? 0 : cell / 2; x < W + cell; x += cell) {
      h.beginPath();
      h.moveTo(x, y - cell * 0.22);
      h.lineTo(x + cell * 0.22, y);
      h.lineTo(x, y + cell * 0.22);
      h.lineTo(x - cell * 0.22, y);
      h.closePath();
      h.stroke();
    }
  }
  // Raised filigree, softened so it embosses with rounded shoulders.
  h.filter = `blur(${(1.4 * u).toFixed(2)}px)`;
  h.strokeStyle = 'rgba(255,255,255,0.75)';
  filigree(h, W, H, 4.2, true);
  // Creases: grooves.
  h.strokeStyle = 'rgba(0,0,0,0.55)';
  h.lineWidth = 3.2 * u;
  for (const [p, q] of sheet.creases) {
    const a = toPx(p);
    const b = toPx(q);
    h.beginPath();
    h.moveTo(a[0], a[1]);
    h.lineTo(b[0], b[1]);
    h.stroke();
  }
  h.filter = 'none';
  const img = h.getImageData(0, 0, W, H);
  const normalData = heightToNormal(img.data, W, H, 2.6);
  const { canvas: nc, ctx: n } = makeCanvas(W, H);
  n.putImageData(new ImageData(new Uint8ClampedArray(normalData), W, H), 0, 0);

  const { canvas: gc, ctx: gx } = makeCanvas(W, H);
  gx.fillStyle = '#000';
  gx.fillRect(0, 0, W, H);
  gx.globalCompositeOperation = 'lighter';
  const strokeCreases = (style: string, width: number, blur: number) => {
    gx.filter = blur > 0 ? `blur(${blur.toFixed(1)}px)` : 'none';
    gx.strokeStyle = style;
    gx.lineWidth = width;
    gx.lineCap = 'round';
    for (const [p, q] of sheet.creases) {
      const a = toPx(p);
      const b = toPx(q);
      gx.beginPath();
      gx.moveTo(a[0], a[1]);
      gx.lineTo(b[0], b[1]);
      gx.stroke();
    }
  };
  strokeCreases('rgb(255,0,0)', 4 * u, 1.5 * u);
  strokeCreases('rgb(0,150,0)', 46 * u, 26 * u);
  strokeCreases('rgb(0,105,0)', 14 * u, 6 * u);
  gx.filter = 'none';
  gx.globalCompositeOperation = 'source-over';
  return { normal: nc, glow: gc };
}

/** A soft radial sprite (warm core → accent → clear) for halos and blooms. */
export function haloSprite(accent: string, size = 256): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, rgba('#FFFFFF', 0.95));
  g.addColorStop(0.12, rgba(WARM_CORE, 0.8));
  g.addColorStop(0.45, rgba(accent, 0.32));
  g.addColorStop(1, rgba(accent, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}
