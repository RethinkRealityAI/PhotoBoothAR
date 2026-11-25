/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * qrCards/render — paints a CardPlan onto a canvas (the live preview, the
 * gallery thumbnails and both exports share this one painter), and builds
 * the PNG and PDF downloads.
 *
 * Browser-only (canvas, fonts, images). Everything it decides comes from the
 * plan, so what is tested in layout.ts is what prints.
 */
import { type CardOp, type CardPlan, caseFor, type Measure, planFonts, planImages, type Rect, type Shape } from './layout';
import { type QrFont } from './model';
import { moduleGeometry, qrMatrix, qrRuns, type QrMatrix } from './qrMatrix';
import { buildPdf } from './pdf';
import { withPngDpi } from './png';

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */

const images = new Map<string, Promise<HTMLImageElement | null>>();

/** Cached; resolves null (never rejects) so one missing picture cannot blank a card. */
export function loadImage(src: string): Promise<HTMLImageElement | null> {
  let p = images.get(src);
  if (p === undefined) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => {
        images.delete(src);
        resolve(null);
      };
      img.src = src;
    });
    images.set(src, p);
  }
  return p;
}

export function fontCss(font: QrFont, size: number): string {
  return `${font.style === 'italic' ? 'italic ' : ''}${font.weight} ${size}px "${font.family}", ui-serif, Georgia, serif`;
}

/** Waits for the plan's fonts (bounded: a slow font never blocks a download). */
export async function loadPlanAssets(plan: CardPlan): Promise<Map<string, HTMLImageElement>> {
  const fonts = typeof document !== 'undefined' && 'fonts' in document
    ? planFonts(plan).map((f) => document.fonts.load(fontCss(f, 40), 'Aa').catch(() => []))
    : [];
  const timeout = new Promise((r) => setTimeout(r, 4000));
  const [, imgs] = await Promise.all([
    Promise.race([Promise.all(fonts), timeout]),
    Promise.all(planImages(plan).map(async (src) => [src, await loadImage(src)] as const)),
  ]);
  const out = new Map<string, HTMLImageElement>();
  for (const [src, img] of imgs) if (img !== null) out.set(src, img);
  return out;
}

/** The planner's measure, backed by a canvas (sizes are in card units). */
let measureCtx: CanvasRenderingContext2D | null = null;
export const canvasMeasure: Measure = (text, font, size) => {
  if (measureCtx === null) measureCtx = document.createElement('canvas').getContext('2d');
  if (measureCtx === null) return text.length * size * 0.55;
  measureCtx.font = fontCss(font, size);
  return measureCtx.measureText(text).width;
};

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

function roundRect(ctx: CanvasRenderingContext2D, r: Rect, rad: number) {
  const k = Math.max(0, Math.min(rad, r.w / 2, r.h / 2));
  ctx.moveTo(r.x + k, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, k);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, k);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, k);
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, k);
  ctx.closePath();
}

function grow(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by };
}

function tracePath(ctx: CanvasRenderingContext2D, s: Shape, inset = 0) {
  ctx.beginPath();
  if (s.kind === 'rect') {
    roundRect(ctx, grow(s.rect, -inset), s.r);
    return;
  }
  if (s.kind === 'arch') {
    const r = grow(s.rect, -inset);
    const rad = r.w / 2;
    ctx.moveTo(r.x, r.y + r.h);
    ctx.lineTo(r.x, r.y + rad);
    ctx.arc(r.x + rad, r.y + rad, rad, Math.PI, 0, false);
    ctx.lineTo(r.x + r.w, r.y + r.h);
    ctx.closePath();
    return;
  }
  const { rect: r, r: rad, notchR: nr, tear } = s;
  const k = Math.min(rad, r.w / 2, r.h / 2);
  ctx.moveTo(r.x + k, r.y);
  if (tear.axis === 'v') {
    ctx.lineTo(tear.at - nr, r.y);
    ctx.arc(tear.at, r.y, nr, Math.PI, 0, true);
  }
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, k);
  if (tear.axis === 'h') {
    ctx.lineTo(r.x + r.w, tear.at - nr);
    ctx.arc(r.x + r.w, tear.at, nr, -Math.PI / 2, Math.PI / 2, true);
  }
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, k);
  if (tear.axis === 'v') {
    ctx.lineTo(tear.at + nr, r.y + r.h);
    ctx.arc(tear.at, r.y + r.h, nr, 0, Math.PI, true);
  }
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, k);
  if (tear.axis === 'h') {
    ctx.lineTo(r.x, tear.at + nr);
    ctx.arc(r.x, tear.at, nr, Math.PI / 2, -Math.PI / 2, true);
  }
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, k);
  ctx.closePath();
}

function shapeBounds(s: Shape): Rect {
  return s.rect;
}

/* ------------------------------------------------------------------ */
/* Painting                                                            */
/* ------------------------------------------------------------------ */

/** Cover-crop the image into `r`, honouring the vertical focus. */
function drawCover(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, r: Rect, focus: number) {
  const iw = img.width;
  const ih = img.height;
  const scale = Math.max(r.w / iw, r.h / ih);
  const sw = r.w / scale;
  const sh = r.h / scale;
  const sx = (iw - sw) / 2;
  const sy = Math.max(0, Math.min(ih - sh, ih * focus - sh / 2));
  ctx.drawImage(img, sx, sy, sw, sh, r.x, r.y, r.w, r.h);
}

/** A cheap, portable blur (Safari has no ctx.filter): down-sample, then up. */
function blurred(src: CanvasImageSource, sw: number, sh: number, factor: number): HTMLCanvasElement {
  let cur: CanvasImageSource = src;
  let w = sw;
  let h = sh;
  const steps: HTMLCanvasElement[] = [];
  while (w / 2 >= sw / factor && h / 2 >= 2) {
    const c = document.createElement('canvas');
    c.width = Math.max(2, Math.round(w / 2));
    c.height = Math.max(2, Math.round(h / 2));
    const x = c.getContext('2d');
    if (x === null) break;
    x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, c.width, c.height);
    steps.push(c);
    cur = c;
    w = c.width;
    h = c.height;
  }
  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;
  const o = out.getContext('2d');
  if (o !== null) {
    o.imageSmoothingQuality = 'high';
    // Up in two stages so the result is smooth, not blocky.
    const mid = document.createElement('canvas');
    mid.width = Math.max(2, Math.round(sw / 4));
    mid.height = Math.max(2, Math.round(sh / 4));
    mid.getContext('2d')?.drawImage(cur, 0, 0, mid.width, mid.height);
    o.drawImage(mid, 0, 0, sw, sh);
  }
  return out;
}

function sparklePath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.quadraticCurveTo(cx + r * 0.16, cy - r * 0.16, cx + r, cy);
  ctx.quadraticCurveTo(cx + r * 0.16, cy + r * 0.16, cx, cy + r);
  ctx.quadraticCurveTo(cx - r * 0.16, cy + r * 0.16, cx - r, cy);
  ctx.quadraticCurveTo(cx - r * 0.16, cy - r * 0.16, cx, cy - r);
  ctx.closePath();
}

function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function drawText(ctx: CanvasRenderingContext2D, op: Extract<CardOp, { kind: 'text' }>) {
  ctx.fillStyle = op.color;
  ctx.font = fontCss(op.font, op.size);
  ctx.textBaseline = 'alphabetic';
  const tracking = op.font.caps !== undefined ? op.font.caps * op.size : 0;
  op.lines.forEach((raw, i) => {
    const line = caseFor(raw, op.font);
    const base = op.y + i * op.size * op.lineHeight + op.size * ((op.lineHeight - 1) / 2 + 0.82);
    if (tracking === 0) {
      ctx.textAlign = op.align;
      ctx.fillText(line, op.align === 'center' ? op.x + op.w / 2 : op.x, base);
      return;
    }
    // Spaced capitals: set letter by letter (canvas letterSpacing is not everywhere yet).
    ctx.textAlign = 'left';
    const widths = [...line].map((ch) => ctx.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + tracking * Math.max(0, widths.length - 1);
    let x = op.align === 'center' ? op.x + (op.w - total) / 2 : op.x;
    [...line].forEach((ch, j) => {
      ctx.fillText(ch, x, base);
      x += widths[j] + tracking;
    });
  });
}

export interface PaintOptions {
  /** false = leave the code's tile blank (the PDF draws it as vectors). */
  qrModules: boolean;
  matrix: QrMatrix | null;
}

/**
 * Paints the plan at `scale` device pixels per card unit. The canvas must be
 * plan.w*scale × plan.h*scale.
 */
export function paintCard(ctx: CanvasRenderingContext2D, plan: CardPlan, scale: number, imgs: Map<string, HTMLImageElement>, opts: PaintOptions) {
  const W = plan.w;
  const H = plan.h;
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (const op of plan.ops) {
    ctx.save();
    switch (op.kind) {
      case 'fill': {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, op.color);
        g.addColorStop(1, op.color2);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        break;
      }
      case 'art': {
        const img = imgs.get(op.src);
        if (img === undefined) break;
        tracePath(ctx, op.shape);
        ctx.clip();
        const r = shapeBounds(op.shape);
        if (op.blur === true) {
          const pw = Math.max(2, Math.round(r.w * scale));
          const ph = Math.max(2, Math.round(r.h * scale));
          const sharp = document.createElement('canvas');
          sharp.width = pw;
          sharp.height = ph;
          const sx = sharp.getContext('2d');
          if (sx !== null) drawCover(sx, img, { x: 0, y: 0, w: pw, h: ph }, op.focus);
          ctx.drawImage(blurred(sharp, pw, ph, 24), r.x, r.y, r.w, r.h);
        } else {
          drawCover(ctx, img, r, op.focus);
        }
        if (op.dim !== undefined && op.dim > 0) {
          ctx.fillStyle = `rgba(0,0,0,${op.dim})`;
          ctx.fillRect(r.x, r.y, r.w, r.h);
        }
        break;
      }
      case 'glass': {
        const r = shapeBounds(op.shape);
        // A soft lift under the panel.
        ctx.save();
        tracePath(ctx, op.shape);
        ctx.shadowColor = 'rgba(0,0,0,0.28)';
        ctx.shadowBlur = 30 * scale;
        ctx.shadowOffsetY = 8 * scale;
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fill();
        ctx.restore();
        // Frost: what is already painted behind the panel, blurred.
        const px = Math.max(0, Math.floor(r.x * scale));
        const py = Math.max(0, Math.floor(r.y * scale));
        const pw = Math.max(2, Math.min(ctx.canvas.width - px, Math.ceil(r.w * scale)));
        const ph = Math.max(2, Math.min(ctx.canvas.height - py, Math.ceil(r.h * scale)));
        const grab = document.createElement('canvas');
        grab.width = pw;
        grab.height = ph;
        grab.getContext('2d')?.drawImage(ctx.canvas, px, py, pw, ph, 0, 0, pw, ph);
        tracePath(ctx, op.shape);
        ctx.clip();
        ctx.drawImage(blurred(grab, pw, ph, 28), px / scale, py / scale, pw / scale, ph / scale);
        ctx.fillStyle = op.tint;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        // A light sheen falling from the top edge.
        const sheen = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
        sheen.addColorStop(0, 'rgba(255,255,255,0.16)');
        sheen.addColorStop(0.4, 'rgba(255,255,255,0.02)');
        sheen.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = sheen;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.restore();
        ctx.save();
        // The glimmering rim.
        const rim = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
        rim.addColorStop(0, op.rim);
        rim.addColorStop(0.5, 'rgba(255,255,255,0.08)');
        rim.addColorStop(1, op.rim);
        tracePath(ctx, op.shape, 0.6);
        ctx.strokeStyle = rim;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        break;
      }
      case 'paper': {
        const r = shapeBounds(op.shape);
        tracePath(ctx, op.shape);
        if (op.shadow) {
          ctx.shadowColor = 'rgba(0,0,0,0.35)';
          ctx.shadowBlur = 28 * scale;
          ctx.shadowOffsetY = 10 * scale;
        }
        const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
        g.addColorStop(0, op.color);
        g.addColorStop(1, op.color2);
        ctx.fillStyle = g;
        ctx.fill();
        break;
      }
      case 'outline': {
        tracePath(ctx, op.shape, op.inset);
        ctx.strokeStyle = op.color;
        ctx.lineWidth = op.width;
        ctx.stroke();
        break;
      }
      case 'stars': {
        const rand = seeded(op.seed);
        for (let i = 0; i < op.count; i++) {
          const x = op.rect.x + rand() * op.rect.w;
          const y = op.rect.y + rand() * op.rect.h;
          const r = 0.5 + rand() * 1.3;
          ctx.globalAlpha = 0.18 + rand() * 0.5;
          ctx.fillStyle = op.color;
          if (rand() > 0.88) {
            sparklePath(ctx, x, y, r * 3.2);
            ctx.fill();
          } else {
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        break;
      }
      case 'halo': {
        const g = ctx.createRadialGradient(op.cx, op.cy, 0, op.cx, op.cy, op.r);
        g.addColorStop(0, hexAlpha(op.color, 0.55));
        g.addColorStop(0.45, hexAlpha(op.color, 0.22));
        g.addColorStop(1, hexAlpha(op.color, 0));
        ctx.fillStyle = g;
        ctx.fillRect(op.cx - op.r, op.cy - op.r, op.r * 2, op.r * 2);
        break;
      }
      case 'rule': {
        ctx.beginPath();
        ctx.moveTo(op.x1, op.y1);
        ctx.lineTo(op.x2, op.y2);
        ctx.strokeStyle = op.color;
        ctx.lineWidth = op.width;
        ctx.lineCap = 'round';
        if (op.dash !== undefined) ctx.setLineDash([op.dash, op.dash * 0.9]);
        ctx.stroke();
        break;
      }
      case 'sparkle': {
        sparklePath(ctx, op.cx, op.cy, op.r);
        ctx.fillStyle = op.color;
        ctx.fill();
        break;
      }
      case 'text':
        drawText(ctx, op);
        break;
      case 'image': {
        const img = imgs.get(op.src);
        if (img !== undefined) {
          ctx.shadowColor = 'rgba(0,0,0,0.3)';
          ctx.shadowBlur = 16 * scale;
          ctx.shadowOffsetY = 6 * scale;
          ctx.drawImage(img, op.rect.x, op.rect.y, op.rect.w, op.rect.h);
        }
        break;
      }
      case 'qr': {
        tracePath(ctx, { kind: 'rect', rect: op.rect, r: op.radius });
        if (op.glow !== null) {
          ctx.shadowColor = op.glow;
          ctx.shadowBlur = 34 * scale;
        } else {
          ctx.shadowColor = 'rgba(0,0,0,0.22)';
          ctx.shadowBlur = 14 * scale;
          ctx.shadowOffsetY = 4 * scale;
        }
        ctx.fillStyle = op.tile;
        ctx.fill();
        ctx.shadowColor = 'transparent';
        if (opts.qrModules && opts.matrix !== null) paintModules(ctx, op, opts.matrix, scale);
        break;
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

/** Modules snapped to whole device pixels: no seams, no blur at the code. */
function paintModules(ctx: CanvasRenderingContext2D, op: Extract<CardOp, { kind: 'qr' }>, m: QrMatrix, scale: number) {
  const { mod, x0, y0 } = moduleGeometry(op.rect, m.size);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = op.ink;
  const px = (u: number) => Math.round(u * scale);
  for (const run of qrRuns(m)) {
    const x1 = px(x0 + run.col * mod);
    const x2 = px(x0 + (run.col + run.len) * mod);
    const y1 = px(y0 + run.row * mod);
    const y2 = px(y0 + (run.row + 1) * mod);
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
  }
  ctx.restore();
}

function hexAlpha(hex: string, a: number): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex;
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `rgba(${n(1)},${n(3)},${n(5)},${a})`;
}

/* ------------------------------------------------------------------ */
/* Exports                                                             */
/* ------------------------------------------------------------------ */

export async function renderCanvas(plan: CardPlan, scale: number, url: string | null, qrModules = true): Promise<HTMLCanvasElement> {
  const imgs = await loadPlanAssets(plan);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(plan.w * scale);
  canvas.height = Math.round(plan.h * scale);
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('canvas_unavailable');
  paintCard(ctx, plan, scale, imgs, { qrModules, matrix: url !== null ? qrMatrix(url) : null });
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b !== null ? resolve(b) : reject(new Error('encode_failed'))), type, quality);
  });
}

/** Print PNG at `dpi`, tagged with its resolution so print apps size it right. */
export async function exportPng(plan: CardPlan, url: string | null, dpi: number, unitsPerIn: number): Promise<Blob> {
  const canvas = await renderCanvas(plan, dpi / unitsPerIn, url, true);
  const blob = await toBlob(canvas, 'image/png');
  const tagged = withPngDpi(new Uint8Array(await blob.arrayBuffer()), dpi);
  return new Blob([tagged], { type: 'image/png' });
}

/** Print PDF: 300 dpi artwork + the code as vectors on top. */
export async function exportPdf(plan: CardPlan, url: string | null, dpi: number, unitsPerIn: number, size: { wIn: number; hIn: number }, title: string): Promise<Blob> {
  const canvas = await renderCanvas(plan, dpi / unitsPerIn, url, false);
  const jpeg = new Uint8Array(await (await toBlob(canvas, 'image/jpeg', 0.95)).arrayBuffer());
  let qr = null;
  const op = plan.ops.find((o): o is Extract<CardOp, { kind: 'qr' }> => o.kind === 'qr');
  if (url !== null && op !== undefined) {
    const m = qrMatrix(url);
    const { mod, x0, y0 } = moduleGeometry(op.rect, m.size);
    qr = {
      ink: op.ink,
      rects: qrRuns(m).map((r) => ({ x: x0 + r.col * mod, y: y0 + r.row * mod, w: r.len * mod, h: mod })),
    };
  }
  const bytes = buildPdf({ wIn: size.wIn, hIn: size.hIn, unitsPerIn, jpeg, jpegW: canvas.width, jpegH: canvas.height, qr, title });
  return new Blob([bytes], { type: 'application/pdf' });
}

export function downloadBlob(blob: Blob, fileName: string) {
  const a = document.createElement('a');
  const href = URL.createObjectURL(blob);
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
