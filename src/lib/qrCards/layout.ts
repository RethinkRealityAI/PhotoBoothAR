/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * qrCards/layout — turns a design + template into a flat list of drawing
 * operations in card units (100 per inch). The canvas renderer just paints
 * the list; the PDF writer reads the code's rectangle from it. Keeping every
 * size decision here means the preview, the PNG and the PDF cannot disagree,
 * and the rules ("the code is never smaller than 1.3 in", "no text leaves
 * the card or covers the code") are tested without a browser.
 *
 * One layout for every template: the scene fills the page, the code is
 * printed on the painting's own plain spot (a sign, a tag, a marquee, the
 * moon...), and the words are printed on the art around it, light or dark
 * ink chosen per scene so they read without a panel behind them.
 *
 * PURE: text widths come from an injected `measure`, so tests pass a fake.
 */
import {
  cardSize,
  FONT_SETS,
  type QrCardDesign,
  type QrFont,
  type QrTemplate,
  type SceneArt,
  UNITS_PER_IN,
} from './model';

export interface Rect { x: number; y: number; w: number; h: number }

export type TextRole = 'headline' | 'names' | 'date' | 'message';

export type CardOp =
  /** The scene's mean colour, painted first in case the picture is slow. */
  | { kind: 'fill'; color: string }
  /** The painting, drawn exactly at `rect` (it may hang past the card's edges). */
  | { kind: 'scene'; src: string; rect: Rect }
  | { kind: 'rule'; x1: number; y1: number; x2: number; y2: number; color: string; width: number; shadow: string }
  | { kind: 'text'; role: TextRole; lines: string[]; font: QrFont; size: number; color: string; shadow: string; x: number; y: number; w: number; align: 'center' | 'left'; lineHeight: number }
  /**
   * The code. `bg` is the spot's own face colour, laid under the code with a
   * soft edge so paper grain in the painting never reaches the modules.
   */
  | { kind: 'qr'; rect: Rect; ink: string; bg: string };

export interface CardPlan {
  w: number;
  h: number;
  ops: CardOp[];
  /** The code (the PDF draws the modules here as vectors). */
  qr: Rect;
  /** The painted spot the code sits on, in card units (words keep off it). */
  spot: Rect;
}

/** Width of `text` in `font` at `size` card units. Caps + tracking are applied by the caller. */
export type Measure = (text: string, font: QrFont, size: number) => number;

/** The smallest code we will print: phones read 1.3 in from arm's length. */
export const MIN_QR_IN = 1.3;

/* ------------------------------------------------------------------ */
/* Text fitting                                                        */
/* ------------------------------------------------------------------ */

export function caseFor(text: string, font: QrFont): string {
  return font.caps !== undefined ? text.toUpperCase() : text;
}

export function textWidth(text: string, font: QrFont, size: number, measure: Measure): number {
  const t = caseFor(text, font);
  const tracking = font.caps !== undefined ? font.caps * size * Math.max(0, t.length - 1) : 0;
  return measure(t, font, size) + tracking;
}

/** Greedy wrap; a word longer than the line is kept whole (it is shrunk or cut later). */
export function wrap(text: string, font: QrFont, size: number, width: number, measure: Measure): string[] {
  const words = text.trim().split(/\s+/).filter((w) => w !== '');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur === '' ? w : `${cur} ${w}`;
    if (cur !== '' && textWidth(next, font, size, measure) > width) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur !== '') lines.push(cur);
  return lines;
}

/** Two lines of near-equal width read better than a long line and a widow. */
function balanceTwo(lines: string[], font: QrFont, size: number, width: number, measure: Measure): string[] {
  if (lines.length !== 2) return lines;
  const words = `${lines[0]} ${lines[1]}`.split(' ');
  let best = lines;
  let bestW = Math.max(...lines.map((l) => textWidth(l, font, size, measure)));
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const w = Math.max(textWidth(a, font, size, measure), textWidth(b, font, size, measure));
    if (w <= width && w < bestW - 0.01) {
      best = [a, b];
      bestW = w;
    }
  }
  return best;
}

export interface Fitted { lines: string[]; size: number }

/**
 * The largest size from `max` down to `min` at which `text` wraps into at
 * most `maxLines` lines that all fit `width`. At `min` it still overflows?
 * The last line is cut with an ellipsis, so text can never leave its box.
 */
export function fitText(text: string, font: QrFont, max: number, min: number, maxLines: number, width: number, measure: Measure): Fitted {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean === '') return { lines: [], size: max };
  const fits = (lines: string[], s: number) => lines.length <= maxLines && lines.every((l) => textWidth(l, font, s, measure) <= width + 0.01);
  for (let s = max; s >= min - 0.001; s *= 0.95) {
    const lines = wrap(clean, font, s, width, measure);
    if (fits(lines, s)) return { lines: balanceTwo(lines, font, s, width, measure), size: s };
  }
  // Still too long at the floor: keep what fits and cut the rest.
  const lines = wrap(clean, font, min, width, measure).slice(0, maxLines);
  const last = lines.length - 1;
  for (let i = 0; i <= last; i++) {
    let l = lines[i];
    const cut = i === last && lines.join(' ').length < clean.length;
    if (!cut && textWidth(l, font, min, measure) <= width) continue;
    while (l.length > 1 && textWidth(`${l}…`, font, min, measure) > width) l = l.slice(0, -1).trimEnd();
    lines[i] = `${l}…`;
  }
  return { lines, size: min };
}

/* ------------------------------------------------------------------ */
/* Stacks                                                              */
/* ------------------------------------------------------------------ */

const LINE_HEIGHT = 1.14;

interface TextSpec { role: TextRole; text: string; font: QrFont; max: number; min: number; lines: number }

type Item =
  | { kind: 'text'; spec: TextSpec; fit: Fitted; h: number; gap: number }
  | { kind: 'rule'; h: number; gap: number };

function textItem(spec: TextSpec, w: number, measure: Measure, gap: number): Item | null {
  if (spec.text.trim() === '') return null;
  const fit = fitText(spec.text, spec.font, spec.max, spec.min, spec.lines, w, measure);
  return { kind: 'text', spec, fit, h: fit.lines.length * fit.size * LINE_HEIGHT, gap };
}

const stackHeight = (items: Item[]) => items.reduce((sum, it, i) => sum + (i > 0 ? it.gap : 0) + it.h, 0);

/** Ink and its halo: light words get a soft dark shadow, dark words a soft light one. */
interface Ink { color: string; shadow: string }

function inkFor(c: Ctx, tone: 'light' | 'dark'): Ink {
  return tone === 'light'
    ? { color: c.t.palette.light, shadow: 'rgba(0,0,0,0.55)' }
    : { color: c.t.palette.dark, shadow: 'rgba(255,255,255,0.7)' };
}

/** Places items top to bottom from `top`, centred in [x, x+w]. */
function placeStack(c: Ctx, items: Item[], x: number, w: number, top: number, ink: Ink): CardOp[] {
  const ops: CardOp[] = [];
  let y = top;
  items.forEach((it, i) => {
    if (i > 0) y += it.gap;
    if (it.kind === 'rule') {
      const len = 34 * c.k;
      const cy = y + it.h / 2;
      ops.push({ kind: 'rule', x1: x + w / 2 - len / 2, y1: cy, x2: x + w / 2 + len / 2, y2: cy, color: c.accent, width: 1.6 * c.k, shadow: ink.shadow });
    } else {
      ops.push({
        kind: 'text', role: it.spec.role, lines: it.fit.lines, font: it.spec.font, size: it.fit.size, color: ink.color, shadow: ink.shadow,
        x, y, w, align: 'center', lineHeight: LINE_HEIGHT,
      });
    }
    y += it.h;
  });
  return ops;
}

/* ------------------------------------------------------------------ */
/* The plan                                                            */
/* ------------------------------------------------------------------ */

interface Ctx {
  d: QrCardDesign;
  t: QrTemplate;
  W: number;
  H: number;
  /** Scale: 1 on a 5 in short side. */
  k: number;
  accent: string;
  measure: Measure;
  /** Shrinks every word when long words would not fit (planCard retries). */
  ts: number;
  thumb: boolean;
}

/** The title block: headline, a short accent rule, names, date. */
function titleItems(c: Ctx, w: number): Item[] {
  const f = FONT_SETS[c.t.fonts];
  const k = c.k * c.ts;
  const out: Item[] = [];
  const head = textItem({ role: 'headline', text: c.d.copy.headline, font: f.display, max: (f.display.caps !== undefined ? 40 : 46) * k, min: 22 * k, lines: 2 }, w, c.measure, 0);
  if (head !== null) out.push(head);
  const names = textItem({ role: 'names', text: c.d.copy.names, font: f.label, max: 15 * k, min: 10 * k, lines: 2 }, w * 0.92, c.measure, 8 * k);
  const date = textItem({ role: 'date', text: c.d.copy.date, font: f.label, max: 11 * k, min: 8.5 * k, lines: 2 }, w * 0.92, c.measure, 6 * k);
  if (head !== null && (names !== null || date !== null)) out.push({ kind: 'rule', h: 2 * k, gap: 10 * k });
  for (const it of [names, date]) {
    if (it === null) continue;
    if (out.length === 0) it.gap = 0;
    out.push(it);
  }
  return out;
}

function messageItem(c: Ctx, w: number, gap: number): Item | null {
  const f = FONT_SETS[c.t.fonts];
  const k = c.k * c.ts;
  return textItem({ role: 'message', text: c.d.copy.message, font: f.label, max: 15 * k, min: 9.5 * k, lines: 2 }, w, c.measure, gap);
}

/** The painting placed to cover the card, and its spot and holder mapped into card units. */
function placeScene(a: SceneArt, W: number, H: number): { rect: Rect; spot: Rect; hold: Rect } {
  const dh = Math.max(W / a.aspect, H);
  const dw = a.aspect * dh;
  const rect: Rect = { x: (W - dw) / 2, y: (H - dh) / 2, w: dw, h: dh };
  const side = a.spot.s * dw;
  const cx = rect.x + a.spot.x * dw;
  const cy = rect.y + a.spot.y * dh;
  const hold: Rect = { x: rect.x + a.hold.x0 * dw, y: rect.y + a.hold.y0 * dh, w: (a.hold.x1 - a.hold.x0) * dw, h: (a.hold.y1 - a.hold.y0) * dh };
  return { rect, spot: { x: cx - side / 2, y: cy - side / 2, w: side, h: side }, hold };
}

function planOnce(c: Ctx): CardPlan {
  const { W, H, k, t } = c;
  const portrait = c.d.orientation === 'portrait';
  const a = portrait ? t.art.portrait : t.art.landscape;
  const { rect, spot, hold } = placeScene(a, W, H);
  // The code fills most of the spot, within a comfortable print size; never under the floor.
  const minQr = MIN_QR_IN * UNITS_PER_IN;
  const maxQr = Math.max(minQr, Math.min(190, 175 * k));
  const side = Math.max(minQr, Math.min(spot.w * 0.94, maxQr));
  const qr: Rect = {
    x: Math.max(0.03 * W, Math.min(W - 0.03 * W - side, spot.x + spot.w / 2 - side / 2)),
    y: Math.max(0.03 * H, Math.min(H - 0.03 * H - side, spot.y + spot.h / 2 - side / 2)),
    w: side,
    h: side,
  };
  // Words keep clear of the painted holder, its spot and the code (which may be bigger than a small spot).
  const keepOut = union(union(spot, qr), hold);
  const frame = 0.04 * spot.w;
  const gap = 14 * k + frame;
  const ops: CardOp[] = [
    { kind: 'fill', color: a.base },
    { kind: 'scene', src: c.thumb ? a.thumb : a.src, rect },
  ];
  if (portrait) {
    const colW = 0.84 * W;
    const colX = (W - colW) / 2;
    const top = 0.05 * H;
    const room = keepOut.y - gap - top;
    const title = titleItems(c, colW);
    const th = stackHeight(title);
    ops.push(...placeStack(c, title, colX, colW, top + Math.max(0, (room - th) / 2), inkFor(c, a.text.top)));
    const msg = messageItem(c, 0.8 * W, 0);
    if (msg !== null) {
      // Right under the holder: process-art.py judges this strip's ink.
      const y = keepOut.y + keepOut.h + gap;
      ops.push(...placeStack(c, [msg], 0.1 * W, 0.8 * W, y, inkFor(c, a.text.below)));
    }
  } else {
    const margin = 0.06 * W;
    const right = keepOut.x + keepOut.w / 2 > W / 2;
    const colX = right ? margin : keepOut.x + keepOut.w + frame + margin * 0.7;
    const colW = Math.max(40, (right ? keepOut.x - frame - margin * 0.7 : W - margin) - colX);
    const title = titleItems(c, colW);
    const msg = messageItem(c, colW * 0.92, 18 * k);
    const items = msg !== null ? [...title, msg] : title;
    const top = 0.07 * H;
    const room = 0.93 * H - top;
    const ink = inkFor(c, a.text.top);
    ops.push(...placeStack(c, items, colX, colW, top + Math.max(0, (room - stackHeight(items)) / 2), ink));
  }
  ops.push({ kind: 'qr', rect: qr, ink: t.palette.qrInk, bg: a.face });
  return { w: W, h: H, ops, qr, spot };
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

const opRect = (op: Extract<CardOp, { kind: 'text' }>): Rect => ({ x: op.x, y: op.y, w: op.w, h: op.lines.length * op.size * op.lineHeight });
const hits = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * The real ink of a text op: its widest line, centred (or left-aligned) in
 * its box. The box itself is the full column, which may overhang the spot's
 * side in landscape without any letter doing so.
 */
function inkRect(op: Extract<CardOp, { kind: 'text' }>, measure: Measure | null): Rect {
  const r = opRect(op);
  if (measure === null) return r;
  const w = Math.min(r.w, Math.max(0, ...op.lines.map((l) => textWidth(l, op.font, op.size, measure))));
  return { x: op.align === 'center' ? r.x + (r.w - w) / 2 : r.x, y: r.y, w, h: r.h };
}

/** Every word on the card, inside it, clear of the code, the painted spot and each other. */
export function planFits(plan: CardPlan, measure: Measure | null = null): boolean {
  const texts = plan.ops.filter((o): o is Extract<CardOp, { kind: 'text' }> => o.kind === 'text').map((o) => inkRect(o, measure));
  for (const r of texts) {
    if (r.x < -0.01 || r.y < -0.01 || r.x + r.w > plan.w + 0.01 || r.y + r.h > plan.h + 0.01) return false;
    if (hits(r, plan.qr) || hits(r, plan.spot)) return false;
  }
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) if (hits(texts[i], texts[j])) return false;
  return true;
}

/** Long words? The type steps down until everything fits (it never overflows silently). */
const TEXT_SCALES = [1, 0.92, 0.85, 0.78, 0.72, 0.66, 0.6];

export interface PlanOptions {
  /** Paint the small gallery picture instead of the print one. */
  thumb?: boolean;
}

export function planCard(d: QrCardDesign, t: QrTemplate, measure: Measure, opts: PlanOptions = {}): CardPlan {
  const { w: W, h: H } = cardSize(d.size, d.orientation);
  const base = { d, t, W, H, k: Math.min(W, H) / 500, accent: d.accent ?? t.palette.accent, measure, thumb: opts.thumb === true };
  let plan = planOnce({ ...base, ts: 1 });
  for (const ts of TEXT_SCALES.slice(1)) {
    if (planFits(plan, measure)) return plan;
    plan = planOnce({ ...base, ts });
  }
  return plan;
}

/** Every image a plan paints (to preload before drawing). */
export function planImages(plan: CardPlan): string[] {
  const out = new Set<string>();
  for (const op of plan.ops) if (op.kind === 'scene' && op.src !== '') out.add(op.src);
  return [...out];
}

/** Every font a plan uses (to load before drawing). */
export function planFonts(plan: CardPlan): QrFont[] {
  const seen = new Map<string, QrFont>();
  for (const op of plan.ops) if (op.kind === 'text') seen.set(`${op.font.style} ${op.font.weight} ${op.font.family}`, op.font);
  return [...seen.values()];
}
