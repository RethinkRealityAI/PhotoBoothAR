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
import { type CardOp, type CardPlan, caseFor, type Measure, planFonts, planImages } from './layout';
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

function drawText(ctx: CanvasRenderingContext2D, op: Extract<CardOp, { kind: 'text' }>, scale: number) {
  ctx.fillStyle = op.color;
  ctx.font = fontCss(op.font, op.size);
  ctx.textBaseline = 'alphabetic';
  // Printed straight on the painting: a soft halo keeps every word readable.
  ctx.shadowColor = op.shadow;
  ctx.shadowBlur = Math.max(3, op.size * 0.45) * scale;
  const tracking = op.font.caps !== undefined ? op.font.caps * op.size : 0;
  op.lines.forEach((raw, i) => {
    const line = caseFor(raw, op.font);
    const base = op.y + i * op.size * op.lineHeight + op.size * ((op.lineHeight - 1) / 2 + 0.82);
    // Two passes: the halo builds up enough to lift small words off a busy floor.
    for (let pass = 0; pass < 2; pass++) {
      if (tracking === 0) {
        ctx.textAlign = op.align;
        ctx.fillText(line, op.align === 'center' ? op.x + op.w / 2 : op.x, base);
        continue;
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
    }
  });
}

export interface PaintOptions {
  /** false = leave the modules out (the PDF draws them as vectors). */
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
      case 'fill':
        ctx.fillStyle = op.color;
        ctx.fillRect(0, 0, W, H);
        break;
      case 'scene': {
        const img = imgs.get(op.src);
        if (img === undefined) break;
        ctx.beginPath();
        ctx.rect(0, 0, W, H);
        ctx.clip();
        ctx.drawImage(img, op.rect.x, op.rect.y, op.rect.w, op.rect.h);
        break;
      }
      case 'rule':
        ctx.beginPath();
        ctx.moveTo(op.x1, op.y1);
        ctx.lineTo(op.x2, op.y2);
        ctx.strokeStyle = op.color;
        ctx.lineWidth = op.width;
        ctx.lineCap = 'round';
        ctx.shadowColor = op.shadow;
        ctx.shadowBlur = 4 * scale;
        ctx.stroke();
        break;
      case 'text':
        drawText(ctx, op, scale);
        break;
      case 'qr': {
        // The spot's own colour under the code, feathered at the edge, so the
        // painting's paper grain never reaches the modules.
        const pad = op.rect.w * 0.02;
        ctx.shadowColor = op.bg;
        ctx.shadowBlur = op.rect.w * 0.05 * scale;
        ctx.fillStyle = op.bg;
        ctx.fillRect(op.rect.x + pad, op.rect.y + pad, op.rect.w - 2 * pad, op.rect.h - 2 * pad);
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
