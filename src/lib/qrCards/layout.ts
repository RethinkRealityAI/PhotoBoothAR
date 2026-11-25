/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * qrCards/layout — turns a design + template into a flat list of drawing
 * operations in card units (100 per inch). The canvas renderer just paints
 * the list; the PDF writer reads the code's rectangle from it. Keeping every
 * size decision here means the preview, the PNG and the PDF cannot disagree,
 * and the rules ("the code is never smaller than 1.3 in", "no text leaves
 * the card") are tested without a browser.
 *
 * PURE: text widths come from an injected `measure`, so tests pass a fake.
 */
import {
  cardSize,
  displayLink,
  FONT_SETS,
  type QrCardDesign,
  type QrFont,
  type QrTemplate,
  UNITS_PER_IN,
} from './model';

export interface Rect { x: number; y: number; w: number; h: number }

export type Shape =
  | { kind: 'rect'; rect: Rect; r: number }
  | { kind: 'arch'; rect: Rect }
  /** A ticket: rounded corners and two half-circle notches cut where the stub tears off. */
  | { kind: 'ticket'; rect: Rect; r: number; notchR: number; tear: { axis: 'h' | 'v'; at: number } };

export type TextRole = 'kicker' | 'headline' | 'names' | 'date' | 'message' | 'footer' | 'link' | 'credit';

export type CardOp =
  | { kind: 'fill'; color: string; color2: string }
  | { kind: 'art'; src: string; focus: number; shape: Shape; blur?: boolean; dim?: number }
  | { kind: 'glass'; shape: Shape; tint: string; rim: string }
  | { kind: 'paper'; shape: Shape; color: string; color2: string; shadow: boolean }
  | { kind: 'outline'; shape: Shape; color: string; width: number; inset: number }
  | { kind: 'stars'; rect: Rect; color: string; seed: number; count: number }
  | { kind: 'halo'; cx: number; cy: number; r: number; color: string }
  | { kind: 'rule'; x1: number; y1: number; x2: number; y2: number; color: string; width: number; dash?: number }
  | { kind: 'sparkle'; cx: number; cy: number; r: number; color: string }
  | { kind: 'text'; role: TextRole; lines: string[]; font: QrFont; size: number; color: string; x: number; y: number; w: number; align: 'center' | 'left'; lineHeight: number }
  | { kind: 'qr'; rect: Rect; radius: number; ink: string; tile: string; glow: string | null }
  | { kind: 'image'; src: string; rect: Rect };

export interface CardPlan {
  w: number;
  h: number;
  ops: CardOp[];
  /** The code's tile (the PDF draws the modules here as vectors). */
  qr: Rect;
}

/** Width of `text` in `font` at `size` card units. Caps + tracking are applied by the caller. */
export type Measure = (text: string, font: QrFont, size: number) => number;

export const BEAMY_SRC = '/mascot/beamy-greet.webp';
export const BEAMY_ASPECT = 321 / 360;
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

interface TextSpec { role: TextRole; text: string; font: QrFont; max: number; min: number; lines: number; color: string; width?: number }

type Item =
  | { kind: 'text'; spec: TextSpec; fit: Fitted; h: number; gap: number }
  | { kind: 'qr'; h: number; gap: number };

const LINE_HEIGHT = 1.14;

function textItem(spec: TextSpec, colW: number, measure: Measure, gap: number): Item | null {
  if (spec.text.trim() === '') return null;
  const w = Math.min(colW, spec.width ?? colW);
  const fit = fitText(spec.text, spec.font, spec.max, spec.min, spec.lines, w, measure);
  return { kind: 'text', spec, fit, h: fit.lines.length * fit.size * LINE_HEIGHT, gap };
}

/** Places items top to bottom from `top`, centred in [x, x+w]. Returns the ops and the code's rect. */
function placeStack(items: Item[], x: number, w: number, top: number, qrSize: number, align: 'center' | 'left'): { ops: CardOp[]; qr: Rect | null; bottom: number } {
  const ops: CardOp[] = [];
  let y = top;
  let qr: Rect | null = null;
  items.forEach((it, i) => {
    if (i > 0) y += it.gap;
    if (it.kind === 'qr') {
      qr = { x: align === 'center' ? x + (w - qrSize) / 2 : x, y, w: qrSize, h: qrSize };
      y += qrSize;
      return;
    }
    const tw = Math.min(w, it.spec.width ?? w);
    ops.push({
      kind: 'text', role: it.spec.role, lines: it.fit.lines, font: it.spec.font, size: it.fit.size, color: it.spec.color,
      x: align === 'center' ? x + (w - tw) / 2 : x, y, w: tw, align, lineHeight: LINE_HEIGHT,
    });
    y += it.h;
  });
  return { ops, qr, bottom: y };
}

const stackHeight = (items: Item[], qrSize: number) =>
  items.reduce((sum, it, i) => sum + (i > 0 ? it.gap : 0) + (it.kind === 'qr' ? qrSize : it.h), 0);

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
  url: string | null;
  measure: Measure;
  /** Shrinks every word when a long message would not fit (planCard retries). */
  ts: number;
}

function fonts(t: QrTemplate) {
  return FONT_SETS[t.fonts];
}

/** The words, in reading order, styled for this template. */
function words(c: Ctx, colW: number, onDark: boolean): { head: TextSpec[]; tail: TextSpec[]; link: TextSpec | null; credit: TextSpec | null } {
  const f = fonts(c.t);
  const p = c.t.palette;
  const k = c.k * c.ts;
  const ink = onDark ? '#FFFFFF' : p.ink;
  const muted = onDark && p.ink !== '#FFFFFF' ? 'rgba(255,255,255,0.8)' : p.muted;
  const capsK = (font: QrFont, s: number) => (font.caps !== undefined ? s * 0.5 : s);
  const head: TextSpec[] = [
    { role: 'kicker', text: c.d.copy.kicker, font: f.accent, max: capsK(f.accent, 27 * k), min: capsK(f.accent, 18 * k), lines: 1, color: c.accent },
    { role: 'headline', text: c.d.copy.headline, font: f.display, max: (f.display.caps !== undefined ? 38 : 46) * k, min: 24 * k, lines: 2, color: ink },
    { role: 'names', text: c.d.copy.names, font: f.label, max: 15 * k, min: 10 * k, lines: 2, color: ink, width: colW * 0.9 },
  ];
  const tail: TextSpec[] = [
    { role: 'message', text: c.d.copy.message, font: f.body, max: 13.5 * k, min: 10 * k, lines: 3, color: muted, width: colW * 0.9 },
    { role: 'date', text: c.d.copy.date, font: f.label, max: 11 * k, min: 8.5 * k, lines: 2, color: muted },
    { role: 'footer', text: c.d.copy.footer, font: f.label, max: 12 * k, min: 9 * k, lines: 2, color: c.accent },
  ];
  const link = c.d.showLink && c.url !== null
    ? { role: 'link' as const, text: displayLink(c.url), font: f.body, max: 9.5 * k, min: 7 * k, lines: 1, color: muted }
    : null;
  const credit = c.d.showCredit
    ? { role: 'credit' as const, text: 'Made with Beamwall · beamwall.app', font: f.body, max: 7.5 * k, min: 6.5 * k, lines: 1, color: muted }
    : null;
  return { head, tail, link, credit };
}

function build(specs: (TextSpec | null)[], colW: number, measure: Measure, gaps: number[]): Item[] {
  const out: Item[] = [];
  specs.forEach((s, i) => {
    if (s === null) return;
    const it = textItem(s, colW, measure, gaps[i] ?? gaps[gaps.length - 1]);
    if (it !== null) out.push(it);
  });
  return out;
}

/** Biggest code size in [min, max] that keeps `fixed + size` within `room`. */
function solveQr(room: number, fixed: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, room - fixed));
}

/** Ornaments in the accent colour around the kicker / names. */
function ornaments(c: Ctx, ops: CardOp[]): CardOp[] {
  const extra: CardOp[] = [];
  const k = c.k;
  for (const op of ops) {
    if (op.kind !== 'text') continue;
    const lineW = textWidth(op.lines[0] ?? '', op.font, op.size, c.measure);
    const cx = op.align === 'center' ? op.x + op.w / 2 : op.x + lineW / 2;
    const cy = op.y + op.size * LINE_HEIGHT * 0.52;
    if (c.t.ornament === 'sparkles' && op.role === 'kicker') {
      const off = lineW / 2 + 16 * k;
      extra.push({ kind: 'sparkle', cx: cx - off, cy, r: 7 * k, color: c.accent });
      extra.push({ kind: 'sparkle', cx: cx + off, cy, r: 7 * k, color: c.accent });
      extra.push({ kind: 'sparkle', cx: cx + off + 12 * k, cy: cy - 9 * k, r: 3.5 * k, color: c.accent });
    }
    if (c.t.ornament === 'rules' && op.role === 'names' && op.lines.length === 1) {
      const gap = 12 * k;
      const len = Math.min(44 * k, (op.w - lineW) / 2 - gap);
      if (len > 8 * k) {
        extra.push({ kind: 'rule', x1: cx - lineW / 2 - gap - len, y1: cy, x2: cx - lineW / 2 - gap, y2: cy, color: c.accent, width: 1.2 * k });
        extra.push({ kind: 'rule', x1: cx + lineW / 2 + gap, y1: cy, x2: cx + lineW / 2 + gap + len, y2: cy, color: c.accent, width: 1.2 * k });
      }
    }
    if (c.t.ornament === 'stars' && op.role === 'kicker') {
      const off = lineW / 2 + 14 * k;
      extra.push({ kind: 'sparkle', cx: cx - off, cy, r: 5 * k, color: c.accent });
      extra.push({ kind: 'sparkle', cx: cx + off, cy, r: 5 * k, color: c.accent });
    }
  }
  return extra;
}

function isDark(t: QrTemplate): boolean {
  return t.palette.ink === '#FFFFFF';
}

function rimFor(t: QrTemplate): string {
  return isDark(t) ? 'rgba(255,255,255,0.34)' : 'rgba(255,255,255,0.9)';
}

/* -------------------------- portrait -------------------------------- */

/** The shared portrait column: words above, the code, words below, link + credit. */
function portraitColumn(c: Ctx, colX: number, colW: number, room: { top: number; bottom: number }, onDark: boolean, opts: { qrMax: number; qrFirst?: boolean }) {
  const k = c.k;
  const w = words(c, colW, onDark);
  const head = build(w.head, colW, c.measure, [0, 6 * k, 10 * k]);
  const tail = build([...w.tail, w.link], colW, c.measure, [14 * k, 8 * k, 6 * k, 6 * k]);
  const qrItem: Item = { kind: 'qr', h: 0, gap: 16 * k };
  const items: Item[] = [...head, qrItem, ...tail];
  if (head.length === 0) qrItem.gap = 0;
  // The link sits close under the code when there is no message between them.
  const credit = w.credit !== null ? build([w.credit], colW, c.measure, [0]) : [];
  const creditH = credit.length > 0 ? credit[0].h + 8 * k : 0;
  const fixed = stackHeight(items, 0);
  const minQr = MIN_QR_IN * UNITS_PER_IN;
  const qrSize = solveQr(room.bottom - room.top - creditH, fixed, minQr, Math.min(opts.qrMax, colW * 0.78));
  const total = fixed + qrSize;
  const top = room.top + Math.max(0, (room.bottom - room.top - creditH - total) / 2);
  const placed = placeStack(items, colX, colW, top, qrSize, 'center');
  const ops = [...placed.ops];
  if (credit.length > 0 && credit[0].kind === 'text') {
    const it = credit[0];
    ops.push({ kind: 'text', role: 'credit', lines: it.fit.lines, font: it.spec.font, size: it.fit.size, color: it.spec.color, x: colX, y: room.bottom - it.h, w: colW, align: 'center', lineHeight: LINE_HEIGHT });
  }
  return { ops, qr: placed.qr ?? { x: colX, y: top, w: qrSize, h: qrSize }, height: total + creditH, qrSize };
}

/** How tall the portrait column wants to be at a given code size (for sizing panels). */
function columnHeight(c: Ctx, colW: number, onDark: boolean, qrSize: number): number {
  const k = c.k;
  const w = words(c, colW, onDark);
  const items: Item[] = [
    ...build(w.head, colW, c.measure, [0, 6 * k, 10 * k]),
    { kind: 'qr', h: 0, gap: 16 * k },
    ...build([...w.tail, w.link], colW, c.measure, [14 * k, 8 * k, 6 * k, 6 * k]),
  ];
  const credit = w.credit !== null ? build([w.credit], colW, c.measure, [0]) : [];
  return stackHeight(items, qrSize) + (credit.length > 0 ? credit[0].h + 8 * k : 0);
}

function glassPortrait(c: Ctx): CardPlan {
  const { W, H, k, t } = c;
  const m = 0.07 * W;
  const pad = 0.07 * W;
  const colW = W - 2 * m - 2 * pad;
  const dark = isDark(t);
  const qrPref = 1.65 * UNITS_PER_IN * (k > 1 ? 1.1 : k < 0.9 ? 0.9 : 1);
  // Size the panel to its content, leaving at least a third of the scene visible.
  const maxPanelH = H - 2 * m - 0.3 * H;
  let qr = qrPref;
  while (qr > MIN_QR_IN * UNITS_PER_IN && columnHeight(c, colW, dark, qr) + 2 * pad > maxPanelH) qr -= 4;
  const panelH = Math.min(maxPanelH, columnHeight(c, colW, dark, qr) + 2 * pad);
  const atTop = t.artFocus > 0.5;
  const panel: Rect = { x: m, y: atTop ? m : H - m - panelH, w: W - 2 * m, h: panelH };
  const col = portraitColumn(c, panel.x + pad, colW, { top: panel.y + pad, bottom: panel.y + panel.h - pad }, dark, { qrMax: qr });
  const shape: Shape = { kind: 'rect', rect: panel, r: 22 * k };
  const ops: CardOp[] = [
    { kind: 'fill', color: t.palette.field, color2: t.palette.fieldTo },
    { kind: 'art', src: t.art ?? '', focus: t.artFocus, shape: { kind: 'rect', rect: { x: 0, y: 0, w: W, h: H }, r: 0 } },
    { kind: 'glass', shape, tint: t.palette.glass, rim: rimFor(t) },
    ...col.ops,
    { kind: 'qr', rect: col.qr, radius: 12 * k, ink: t.palette.qrInk, tile: t.palette.qrTile, glow: null },
  ];
  return { w: W, h: H, ops: [...ops, ...ornaments(c, col.ops)], qr: col.qr };
}

function windowPortrait(c: Ctx): CardPlan {
  const { W, H, k, t } = c;
  const m = 0.085 * W;
  const colX = 0.09 * W;
  const colW = W - 2 * colX;
  const bottom = H - 0.05 * H;
  // The code sits on the window's sill: half over the scene, half on paper.
  let qr = 1.75 * UNITS_PER_IN * (k < 0.9 ? 0.88 : 1);
  const below = (q: number) => columnHeight(c, colW, false, q) - q / 2;
  const minWindow = 0.3 * H;
  while (qr > MIN_QR_IN * UNITS_PER_IN && bottom - below(qr) - m < minWindow) qr -= 4;
  const sill = Math.max(m + minWindow, bottom - below(qr) - 6 * k);
  const win: Rect = { x: m, y: m, w: W - 2 * m, h: sill - m };
  const arch: Shape = { kind: 'arch', rect: win };
  // Words below the sill: kicker, headline, names, then message etc. The code leads.
  const w = words(c, colW, false);
  const items: Item[] = [
    { kind: 'qr', h: 0, gap: 0 },
    ...build(w.head, colW, c.measure, [14 * k, 6 * k, 10 * k]),
    ...build([...w.tail, w.link], colW, c.measure, [12 * k, 8 * k, 6 * k, 6 * k]),
  ];
  const placed = placeStack(items, colX, colW, sill - qr / 2, qr, 'center');
  const ops: CardOp[] = [
    { kind: 'fill', color: t.palette.field, color2: t.palette.fieldTo },
    { kind: 'art', src: t.art ?? '', focus: t.artFocus, shape: arch },
    { kind: 'outline', shape: arch, color: c.accent, width: 1.6 * k, inset: -7 * k },
    ...placed.ops,
  ];
  const qrRect = placed.qr ?? { x: (W - qr) / 2, y: sill - qr / 2, w: qr, h: qr };
  ops.push({ kind: 'qr', rect: qrRect, radius: 12 * k, ink: t.palette.qrInk, tile: t.palette.qrTile, glow: null });
  const credit = w.credit !== null ? build([w.credit], colW, c.measure, [0]) : [];
  if (credit.length > 0 && credit[0].kind === 'text') {
    const it = credit[0];
    ops.push({ kind: 'text', role: 'credit', lines: it.fit.lines, font: it.spec.font, size: it.fit.size, color: it.spec.color, x: colX, y: H - 0.025 * H - it.h, w: colW, align: 'center', lineHeight: LINE_HEIGHT });
  }
  return { w: W, h: H, ops: [...ops, ...ornaments(c, placed.ops)], qr: qrRect };
}

function ticketPortrait(c: Ctx): CardPlan {
  const { W, H, k, t } = c;
  const m = 0.08 * W;
  const tk: Rect = { x: m, y: 0.06 * H, w: W - 2 * m, h: 0.88 * H };
  const pad = 0.07 * W;
  const colX = tk.x + pad;
  const colW = tk.w - 2 * pad;
  const w = words(c, colW, false);
  // Stub (bottom): the code, the link, the credit. Body (top): the words.
  const body = build([...w.head, w.tail[0], w.tail[1], w.tail[2]], colW, c.measure, [0, 6 * k, 10 * k, 12 * k, 8 * k, 6 * k]);
  const bodyH = stackHeight(body, 0);
  const linkItems = build([w.link], colW, c.measure, [8 * k]);
  const creditItems = w.credit !== null ? build([w.credit], colW, c.measure, [0]) : [];
  const stubFixed = stackHeight(linkItems, 0) + (linkItems.length ? 8 * k : 0) + (creditItems.length ? creditItems[0].h + 8 * k : 0);
  const room = tk.h - 2 * pad - 2 * pad; // body pad + stub pad
  const qr = solveQr(room - bodyH, stubFixed, MIN_QR_IN * UNITS_PER_IN, 1.8 * UNITS_PER_IN * (k < 0.9 ? 0.9 : 1));
  const stubH = qr + stubFixed + 2 * pad * 0.8;
  const tearY = tk.y + tk.h - stubH;
  const bodyTop = tk.y + pad + Math.max(0, (tearY - tk.y - 2 * pad - bodyH) / 2);
  const placedBody = placeStack(body, colX, colW, bodyTop, 0, 'center');
  const stubItems: Item[] = [{ kind: 'qr', h: 0, gap: 0 }, ...linkItems];
  const stubTop = tearY + pad * 0.8;
  const placedStub = placeStack(stubItems, colX, colW, stubTop, qr, 'center');
  const shape: Shape = { kind: 'ticket', rect: tk, r: 18 * k, notchR: 16 * k, tear: { axis: 'h', at: tearY } };
  const ops: CardOp[] = [
    { kind: 'fill', color: t.palette.field, color2: t.palette.fieldTo },
    { kind: 'art', src: t.art ?? '', focus: t.artFocus, shape: { kind: 'rect', rect: { x: 0, y: 0, w: W, h: H }, r: 0 }, dim: 0.12 },
    { kind: 'paper', shape, color: t.palette.field, color2: t.palette.fieldTo, shadow: true },
    { kind: 'outline', shape: { kind: 'rect', rect: { x: tk.x + 10 * k, y: tk.y + 10 * k, w: tk.w - 20 * k, h: tearY - tk.y - 20 * k }, r: 10 * k }, color: c.accent, width: 1.1 * k, inset: 0 },
    { kind: 'rule', x1: tk.x + 22 * k, y1: tearY, x2: tk.x + tk.w - 22 * k, y2: tearY, color: c.accent, width: 1.3 * k, dash: 6 * k },
    ...placedBody.ops,
    ...placedStub.ops,
  ];
  const qrRect = placedStub.qr ?? { x: (W - qr) / 2, y: stubTop, w: qr, h: qr };
  ops.push({ kind: 'qr', rect: qrRect, radius: 10 * k, ink: t.palette.qrInk, tile: t.palette.qrTile, glow: null });
  if (creditItems.length > 0 && creditItems[0].kind === 'text') {
    const it = creditItems[0];
    ops.push({ kind: 'text', role: 'credit', lines: it.fit.lines, font: it.spec.font, size: it.fit.size, color: it.spec.color, x: colX, y: tk.y + tk.h - pad * 0.6 - it.h, w: colW, align: 'center', lineHeight: LINE_HEIGHT });
  }
  return { w: W, h: H, ops: [...ops, ...ornaments(c, placedBody.ops)], qr: qrRect };
}

function glowPortrait(c: Ctx): CardPlan {
  const { W, H, k, t } = c;
  const m = 0.08 * W;
  const colW = W - 2 * m;
  const col = portraitColumn(c, m, colW, { top: 0.07 * H, bottom: H - 0.04 * H }, true, { qrMax: 1.9 * UNITS_PER_IN * (k < 0.9 ? 0.9 : 1) });
  const q = col.qr;
  const ops: CardOp[] = [
    { kind: 'fill', color: t.palette.field, color2: t.palette.fieldTo },
    { kind: 'stars', rect: { x: 0, y: 0, w: W, h: H }, color: '#FFFFFF', seed: 7, count: Math.round(70 * k) },
    { kind: 'halo', cx: q.x + q.w / 2, cy: q.y + q.h / 2, r: q.w * 1.05, color: c.accent },
    ...col.ops,
    { kind: 'qr', rect: q, radius: 16 * k, ink: t.palette.qrInk, tile: t.palette.qrTile, glow: c.accent },
  ];
  if (t.beamy === true) {
    const bw = Math.min(0.27 * W, q.x - 0.03 * W - 10 * k);
    if (bw > 0.14 * W) {
      const bh = bw * BEAMY_ASPECT;
      ops.push({ kind: 'image', src: BEAMY_SRC, rect: { x: q.x - 10 * k - bw, y: q.y + q.h - bh * 0.92, w: bw, h: bh } });
    }
  }
  return { w: W, h: H, ops: [...ops, ...ornaments(c, col.ops)], qr: q };
}

/* -------------------------- landscape ------------------------------- */

/** Words left, code right, both centred in `box`. */
function sideBySide(c: Ctx, box: Rect, onDark: boolean, qrMax: number): { ops: CardOp[]; qr: Rect } {
  const k = c.k;
  const gutter = 0.06 * box.w;
  const qrMin = MIN_QR_IN * UNITS_PER_IN;
  const w0 = words(c, box.w, onDark);
  const linkProbe = build([w0.link], box.w, c.measure, [8 * k]);
  const linkH = linkProbe.length ? stackHeight(linkProbe, 0) + 8 * k : 0;
  const creditProbe = w0.credit !== null ? build([w0.credit], box.w, c.measure, [0]) : [];
  const creditH = creditProbe.length ? creditProbe[0].h + 8 * k : 0;
  const qr = Math.max(qrMin, Math.min(qrMax, box.h - linkH - creditH, box.w * 0.45));
  const textW = box.w - qr - gutter;
  const w = words(c, textW, onDark);
  const items = build([...w.head, w.tail[0], w.tail[1], w.tail[2]], textW, c.measure, [0, 6 * k, 10 * k, 12 * k, 8 * k, 6 * k]);
  const textH = stackHeight(items, 0);
  const placedText = placeStack(items, box.x, textW, box.y + Math.max(0, (box.h - creditH - textH) / 2), 0, 'center');
  const qrCol = build([w.link], qr + gutter * 0.6, c.measure, [8 * k]);
  const qrItems: Item[] = [{ kind: 'qr', h: 0, gap: 0 }, ...qrCol];
  const qrColH = stackHeight(qrItems, qr);
  const qrX = box.x + box.w - qr - gutter / 2;
  const placedQr = placeStack(qrItems, qrX - gutter * 0.3, qr + gutter * 0.6, box.y + Math.max(0, (box.h - creditH - qrColH) / 2), qr, 'center');
  const ops = [...placedText.ops, ...placedQr.ops];
  if (creditProbe.length > 0 && creditProbe[0].kind === 'text') {
    const it = creditProbe[0];
    ops.push({ kind: 'text', role: 'credit', lines: it.fit.lines, font: it.spec.font, size: it.fit.size, color: it.spec.color, x: box.x, y: box.y + box.h - it.h, w: box.w, align: 'center', lineHeight: LINE_HEIGHT });
  }
  return { ops, qr: placedQr.qr ?? { x: qrX, y: box.y, w: qr, h: qr } };
}

function glassLandscape(c: Ctx): CardPlan {
  const { W, H, k, t } = c;
  const split = 0.34 * W;
  const full: Rect = { x: 0, y: 0, w: W, h: H };
  const panel: Rect = { x: split, y: 0, w: W - split, h: H };
  const pad = 0.05 * W;
  const body = sideBySide(c, { x: split + pad, y: 0.08 * H, w: W - split - 2 * pad, h: 0.86 * H }, isDark(t), 1.5 * UNITS_PER_IN);
  const ops: CardOp[] = [
    { kind: 'fill', color: t.palette.field, color2: t.palette.fieldTo },
    { kind: 'art', src: t.art ?? '', focus: t.artFocus, shape: { kind: 'rect', rect: full, r: 0 }, blur: true },
    { kind: 'glass', shape: { kind: 'rect', rect: panel, r: 0 }, tint: t.palette.glass, rim: 'rgba(0,0,0,0)' },
    { kind: 'art', src: t.art ?? '', focus: t.artFocus, shape: { kind: 'rect', rect: { x: 0, y: 0, w: split, h: H }, r: 0 } },
    { kind: 'rule', x1: split, y1: 0, x2: split, y2: H, color: rimFor(t), width: 2 * k },
    ...body.ops,
    { kind: 'qr', rect: body.qr, radius: 12 * k, ink: t.palette.qrInk, tile: t.palette.qrTile, glow: null },
  ];
  return { w: W, h: H, ops: [...ops, ...ornaments(c, body.ops)], qr: body.qr };
}

function windowLandscape(c: Ctx): CardPlan {
  const { W, H, k, t } = c;
  const m = 0.06 * H;
  const win: Rect = { x: m, y: m, w: 0.32 * W, h: H - 2 * m };
  const arch: Shape = { kind: 'arch', rect: win };
  const boxX = win.x + win.w + 0.05 * W;
  const body = sideBySide(c, { x: boxX, y: 0.08 * H, w: W - boxX - 0.045 * W, h: 0.86 * H }, false, 1.5 * UNITS_PER_IN);
  const ops: CardOp[] = [
    { kind: 'fill', color: t.palette.field, color2: t.palette.fieldTo },
    { kind: 'art', src: t.art ?? '', focus: t.artFocus, shape: arch },
    { kind: 'outline', shape: arch, color: c.accent, width: 1.6 * k, inset: -7 * k },
    ...body.ops,
    { kind: 'qr', rect: body.qr, radius: 12 * k, ink: t.palette.qrInk, tile: t.palette.qrTile, glow: null },
  ];
  return { w: W, h: H, ops: [...ops, ...ornaments(c, body.ops)], qr: body.qr };
}

function ticketLandscape(c: Ctx): CardPlan {
  const { W, H, k, t } = c;
  const m = 0.07 * H;
  const tk: Rect = { x: m, y: m, w: W - 2 * m, h: H - 2 * m };
  const pad = 0.05 * H;
  const w0 = words(c, tk.w, false);
  const linkItems = build([w0.link], tk.w, c.measure, [8 * k]);
  const creditItems = w0.credit !== null ? build([w0.credit], tk.w * 0.35, c.measure, [0]) : [];
  const stubExtra = stackHeight(linkItems, 0) + (linkItems.length ? 8 * k : 0) + (creditItems.length ? creditItems[0].h + 6 * k : 0);
  const qr = Math.max(MIN_QR_IN * UNITS_PER_IN, Math.min(1.55 * UNITS_PER_IN, tk.h - 2 * pad - stubExtra));
  const stubW = qr + 2 * pad;
  const tearX = tk.x + tk.w - stubW;
  const colX = tk.x + pad * 1.4;
  const colW = tearX - colX - pad * 1.4;
  const w = words(c, colW, false);
  const body = build([...w.head, w.tail[0], w.tail[1], w.tail[2]], colW, c.measure, [0, 6 * k, 10 * k, 12 * k, 8 * k, 6 * k]);
  const bodyH = stackHeight(body, 0);
  const placedBody = placeStack(body, colX, colW, tk.y + Math.max(pad, (tk.h - bodyH) / 2), 0, 'center');
  const stubItems: Item[] = [{ kind: 'qr', h: 0, gap: 0 }, ...build([w0.link], stubW - pad, c.measure, [8 * k])];
  const stubH = stackHeight(stubItems, qr);
  const placedStub = placeStack(stubItems, tearX + pad / 2, stubW - pad, tk.y + Math.max(pad, (tk.h - stubH - (creditItems.length ? creditItems[0].h : 0)) / 2), qr, 'center');
  const shape: Shape = { kind: 'ticket', rect: tk, r: 16 * k, notchR: 14 * k, tear: { axis: 'v', at: tearX } };
  const ops: CardOp[] = [
    { kind: 'fill', color: t.palette.field, color2: t.palette.fieldTo },
    { kind: 'art', src: t.art ?? '', focus: t.artFocus, shape: { kind: 'rect', rect: { x: 0, y: 0, w: W, h: H }, r: 0 }, blur: true, dim: 0.1 },
    { kind: 'paper', shape, color: t.palette.field, color2: t.palette.fieldTo, shadow: true },
    { kind: 'outline', shape: { kind: 'rect', rect: { x: tk.x + 10 * k, y: tk.y + 10 * k, w: tearX - tk.x - 20 * k, h: tk.h - 20 * k }, r: 10 * k }, color: c.accent, width: 1.1 * k, inset: 0 },
    { kind: 'rule', x1: tearX, y1: tk.y + 20 * k, x2: tearX, y2: tk.y + tk.h - 20 * k, color: c.accent, width: 1.3 * k, dash: 6 * k },
    ...placedBody.ops,
    ...placedStub.ops,
  ];
  const qrRect = placedStub.qr ?? { x: tearX + pad, y: tk.y + pad, w: qr, h: qr };
  ops.push({ kind: 'qr', rect: qrRect, radius: 10 * k, ink: t.palette.qrInk, tile: t.palette.qrTile, glow: null });
  if (creditItems.length > 0 && creditItems[0].kind === 'text') {
    const it = creditItems[0];
    ops.push({ kind: 'text', role: 'credit', lines: it.fit.lines, font: it.spec.font, size: it.fit.size, color: it.spec.color, x: tearX, y: tk.y + tk.h - pad * 0.7 - it.h, w: stubW, align: 'center', lineHeight: LINE_HEIGHT });
  }
  return { w: W, h: H, ops: [...ops, ...ornaments(c, placedBody.ops)], qr: qrRect };
}

function glowLandscape(c: Ctx): CardPlan {
  const { W, H, k, t } = c;
  const box: Rect = { x: 0.07 * W, y: 0.09 * H, w: 0.86 * W, h: 0.84 * H };
  const body = sideBySide(c, box, true, 1.8 * UNITS_PER_IN);
  const q = body.qr;
  const ops: CardOp[] = [
    { kind: 'fill', color: t.palette.field, color2: t.palette.fieldTo },
    { kind: 'stars', rect: { x: 0, y: 0, w: W, h: H }, color: '#FFFFFF', seed: 11, count: Math.round(80 * k) },
    { kind: 'halo', cx: q.x + q.w / 2, cy: q.y + q.h / 2, r: q.w * 1.05, color: c.accent },
    ...body.ops,
    { kind: 'qr', rect: q, radius: 16 * k, ink: t.palette.qrInk, tile: t.palette.qrTile, glow: c.accent },
  ];
  if (t.beamy === true) {
    const bw = 0.13 * W;
    const bh = bw * BEAMY_ASPECT;
    // Peeks up from the bottom-left corner, clear of the code and the centred small print.
    ops.push({ kind: 'image', src: BEAMY_SRC, rect: { x: 0.04 * W, y: H - bh * 0.86, w: bw, h: bh } });
  }
  return { w: W, h: H, ops: [...ops, ...ornaments(c, body.ops)], qr: q };
}

/* ------------------------------------------------------------------ */

function planOnce(c: Ctx): CardPlan {
  const portrait = c.d.orientation === 'portrait';
  switch (c.t.layout) {
    case 'glass': return portrait ? glassPortrait(c) : glassLandscape(c);
    case 'window': return portrait ? windowPortrait(c) : windowLandscape(c);
    case 'ticket': return portrait ? ticketPortrait(c) : ticketLandscape(c);
    case 'glow': return portrait ? glowPortrait(c) : glowLandscape(c);
  }
}

const opRect = (op: Extract<CardOp, { kind: 'text' }>): Rect => ({ x: op.x, y: op.y, w: op.w, h: op.lines.length * op.size * op.lineHeight });
const hits = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Every word on the card, clear of the code and of each other. */
export function planFits(plan: CardPlan): boolean {
  const texts = plan.ops.filter((o): o is Extract<CardOp, { kind: 'text' }> => o.kind === 'text').map(opRect);
  for (const r of texts) {
    if (r.x < -0.01 || r.y < -0.01 || r.x + r.w > plan.w + 0.01 || r.y + r.h > plan.h + 0.01) return false;
    if (hits(r, plan.qr)) return false;
  }
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) if (hits(texts[i], texts[j])) return false;
  return true;
}

/** Long words? The type steps down until everything fits (it never overflows silently). */
const TEXT_SCALES = [1, 0.92, 0.85, 0.78, 0.72, 0.66, 0.6];

export function planCard(d: QrCardDesign, t: QrTemplate, url: string | null, measure: Measure): CardPlan {
  const { w: W, h: H } = cardSize(d.size, d.orientation);
  const base = { d, t, W, H, k: Math.min(W, H) / 500, accent: d.accent ?? t.palette.accent, url, measure };
  let plan = planOnce({ ...base, ts: 1 });
  for (const ts of TEXT_SCALES.slice(1)) {
    if (planFits(plan)) return plan;
    plan = planOnce({ ...base, ts });
  }
  return plan;
}

/** Every image a plan paints (to preload before drawing). */
export function planImages(plan: CardPlan): string[] {
  const out = new Set<string>();
  for (const op of plan.ops) {
    if ((op.kind === 'art' && op.src !== '') || op.kind === 'image') out.add(op.src);
  }
  return [...out];
}

/** Every font a plan uses (to load before drawing). */
export function planFonts(plan: CardPlan): QrFont[] {
  const seen = new Map<string, QrFont>();
  for (const op of plan.ops) if (op.kind === 'text') seen.set(`${op.font.style} ${op.font.weight} ${op.font.family}`, op.font);
  return [...seen.values()];
}
