/**
 * frameText — real text on an AI frame, instead of model lettering.
 *
 * Image models misspell names ("Maya & Sam" → "Maya & Sarn") and invent
 * glyphs past ~40 characters. So the model is told to draw NO text and leave a
 * calm plaque (frameGeometryDirection(layout, plaque=true)); the event name and
 * date are composited here with real fonts. The plaque box is FRAME_GEOMETRY's,
 * the same rectangle the prompt reserved, and it sits on the frame art between
 * the measured booth chrome bands (asserted in assetPrompt.test.ts). Frames
 * saved before FRAME_GEOMETRY_VERSION 2 keep their v1 box (PLAQUE_V1).
 *
 * Everything that decides WHAT is drawn is pure and tested — the font-size
 * fit (with an injected measure function), contrast-aware colours, line
 * layout. `drawFrameText` is the thin canvas step and takes a minimal ctx
 * interface so a fake can stand in for it.
 */
import { FRAME_GEOMETRY, FRAME_GEOMETRY_VERSION, type FrameBox, type FrameLayout, relativeLuminance } from '../assetPrompt';
import type { RgbaImage } from './chromaKey';

export type FrameTextFont = 'classic' | 'script' | 'modern';

export interface FrameTextSpec {
  enabled: boolean;
  /** Main line — the event name. */
  title: string;
  /** Optional second line — a date or a short tagline. */
  subtitle?: string;
  font?: FrameTextFont;
}

/** Longest line we draw; past this a frame reads as a paragraph. */
export const FRAME_TEXT_MAX = 48;

export const FONT_STACK: Record<FrameTextFont, { family: string; weight: number; italic: boolean; upper: boolean; tracking: number }> = {
  classic: { family: "'Cormorant Garamond', Georgia, serif", weight: 600, italic: false, upper: false, tracking: 0 },
  script: { family: "'Cormorant Garamond', Georgia, serif", weight: 500, italic: true, upper: false, tracking: 0 },
  modern: { family: "'Jost', 'Inter', system-ui, sans-serif", weight: 500, italic: false, upper: true, tracking: 0.12 },
};

export interface PxBox { x: number; y: number; w: number; h: number }

/**
 * The plaques FRAME_GEOMETRY v1 reserved. A frame generated then has its calm
 * band THERE, so re-drawing its text (restyleFrameText) must keep using it —
 * moving the words onto the new box would put them over that frame's busy
 * ornament. Never edit: it is a record of shipped prompts.
 */
export const PLAQUE_V1: Record<FrameLayout, FrameBox> = {
  'classic-border': { x0: 0.2, y0: 0.1, x1: 0.8, y1: 0.165 },
  'full-scene': { x0: 0.2, y0: 0.1, x1: 0.8, y1: 0.165 },
  'duo-scene': { x0: 0.2, y0: 0.1, x1: 0.8, y1: 0.165 },
  'corner-overlay': { x0: 0.2, y0: 0.585, x1: 0.8, y1: 0.65 },
  'bottom-third': { x0: 0.12, y0: 0.595, x1: 0.88, y1: 0.665 },
};

/** The geometry version a saved frame was generated under: the server stamps
 *  `config.frameGeometry` on new frames; a row without it predates v2. */
export function frameGeometryVersion(config: unknown): number {
  const v = config !== null && typeof config === 'object' ? (config as Record<string, unknown>).frameGeometry : undefined;
  return v === FRAME_GEOMETRY_VERSION ? FRAME_GEOMETRY_VERSION : 1;
}

/** The plaque rectangle in canvas pixels, for the frame's geometry version
 *  (absent/unknown → v1, where every frame made before v2 has its band). */
export function plaqueBox(layout: FrameLayout, canvasW: number, canvasH: number, geometry = 1): PxBox {
  const p = geometry === FRAME_GEOMETRY_VERSION ? FRAME_GEOMETRY[layout].plaque : PLAQUE_V1[layout];
  return {
    x: Math.round(p.x0 * canvasW),
    y: Math.round(p.y0 * canvasH),
    w: Math.round((p.x1 - p.x0) * canvasW),
    h: Math.round((p.y1 - p.y0) * canvasH),
  };
}

/** Normalise host text: trim, collapse whitespace, cap. Empty → ''. */
export function cleanFrameText(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().slice(0, FRAME_TEXT_MAX);
}

/**
 * Largest font size (px, integer) at which `measure(size)` fits `maxW`, capped
 * at `maxH`, floored at `min`. `measure` returns the rendered width at a size
 * — ctx.measureText in the browser, a fake in tests. Binary search: text
 * width is monotonic in size.
 */
export function fitFontSize(measure: (size: number) => number, maxW: number, maxH: number, min = 12): number {
  let lo = min, hi = Math.max(min, Math.floor(maxH));
  if (measure(lo) > maxW) return lo;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(mid) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** WCAG contrast ratio between two relative luminances. */
export function contrastRatio(l1: number, l2: number): number {
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
}

/** Linear-light relative luminance of an sRGB triple (0-255). */
export function rgbLuminance(r: number, g: number, b: number): number {
  const hex = '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
  return relativeLuminance(hex);
}

export interface PlaqueBackdrop {
  /** Mean luminance of the ART under the plaque (0..1), or null when the
   *  plaque is mostly open (the guest's photo is behind the text). */
  luminance: number | null;
  /** Share of the plaque that is art (alpha ≥ 128). */
  coverage: number;
}

/** Measure what the text will sit on. */
export function sampleBackdrop(img: RgbaImage, box: PxBox): PlaqueBackdrop {
  let n = 0, art = 0, sum = 0;
  for (let y = box.y; y < box.y + box.h && y < img.height; y += 2) {
    for (let x = box.x; x < box.x + box.w && x < img.width; x += 2) {
      const i = (y * img.width + x) * 4;
      n++;
      if (img.data[i + 3] >= 128) {
        art++;
        sum += rgbLuminance(img.data[i], img.data[i + 1], img.data[i + 2]);
      }
    }
  }
  const coverage = n === 0 ? 0 : art / n;
  return { luminance: coverage >= 0.5 ? sum / art : null, coverage };
}

export interface TextColours { fill: string; stroke: string; strokeWidth: number; shadow: boolean }

/**
 * Text colours for a backdrop. On art: an accent colour if it clears 4.5:1
 * against the art, else near-black or ivory, whichever contrasts more. On the
 * open photo (unknown, changing per guest): ivory with a dark stroke + soft
 * shadow, which stays legible on any photograph.
 */
export function pickTextColours(backdrop: PlaqueBackdrop, accentHexes: string[] = []): TextColours {
  const DARK = '#1E1A22', LIGHT = '#FBF7EF';
  if (backdrop.luminance === null) {
    return { fill: LIGHT, stroke: 'rgba(20,16,24,0.7)', strokeWidth: 0.08, shadow: true };
  }
  const bg = backdrop.luminance;
  for (const hex of accentHexes) {
    if (/^#[0-9a-fA-F]{6}$/.test(hex) && contrastRatio(relativeLuminance(hex), bg) >= 4.5) {
      return { fill: hex, stroke: 'rgba(0,0,0,0)', strokeWidth: 0, shadow: false };
    }
  }
  const dark = contrastRatio(relativeLuminance(DARK), bg);
  const light = contrastRatio(relativeLuminance(LIGHT), bg);
  return dark >= light
    ? { fill: DARK, stroke: 'rgba(255,255,255,0.35)', strokeWidth: 0.03, shadow: false }
    : { fill: LIGHT, stroke: 'rgba(0,0,0,0.35)', strokeWidth: 0.03, shadow: false };
}

export interface TextLineOp {
  text: string;
  size: number;
  /** Baseline-centre position. */
  x: number;
  y: number;
}

/**
 * Lay out title (+ optional subtitle) inside the plaque. The title gets ~64%
 * of the plaque height when there is a subtitle (the subtitle ~30% of the
 * remaining, never over 60% of the title), the full ~78% when alone; both
 * shrink to fit 88% of the plaque width.
 */
export function layoutFrameText(
  spec: FrameTextSpec,
  box: PxBox,
  measure: (text: string, size: number) => number,
): TextLineOp[] {
  const title = cleanFrameText(spec.title);
  const subtitle = cleanFrameText(spec.subtitle);
  if (!spec.enabled || !title) return [];
  const font = FONT_STACK[spec.font ?? 'classic'];
  const t = font.upper ? title.toUpperCase() : title;
  const s = font.upper ? subtitle.toUpperCase() : subtitle;
  const maxW = box.w * 0.88;
  const cx = box.x + box.w / 2;
  if (!s) {
    const size = fitFontSize((z) => measure(t, z), maxW, box.h * 0.78);
    return [{ text: t, size, x: cx, y: box.y + box.h / 2 + size * 0.34 }];
  }
  const titleSize = fitFontSize((z) => measure(t, z), maxW, box.h * 0.6);
  const subSize = fitFontSize((z) => measure(s, z), maxW, Math.min(box.h * 0.3, titleSize * 0.6), 10);
  const gap = box.h * 0.06;
  const block = titleSize + gap + subSize;
  const top = box.y + (box.h - block) / 2;
  return [
    { text: t, size: titleSize, x: cx, y: top + titleSize * 0.82 },
    { text: s, size: subSize, x: cx, y: top + titleSize + gap + subSize * 0.82 },
  ];
}

/** The subset of CanvasRenderingContext2D drawFrameText touches. */
export interface TextCtx {
  font: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  lineJoin: CanvasLineJoin;
  shadowColor: string;
  shadowBlur: number;
  letterSpacing?: string;
  measureText(text: string): { width: number };
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  save(): void;
  restore(): void;
}

export function fontString(font: FrameTextFont, size: number): string {
  const f = FONT_STACK[font];
  return `${f.italic ? 'italic ' : ''}${f.weight} ${size}px ${f.family}`;
}

/** Measure function bound to a ctx + font (tracking approximated in width). */
export function ctxMeasure(ctx: TextCtx, font: FrameTextFont) {
  const f = FONT_STACK[font];
  return (text: string, size: number) => {
    ctx.font = fontString(font, size);
    return ctx.measureText(text).width + f.tracking * size * Math.max(0, text.length - 1);
  };
}

/** Draw the laid-out lines. Thin by design — every decision is made above. */
export function drawFrameText(ctx: TextCtx, ops: TextLineOp[], font: FrameTextFont, colours: TextColours): void {
  const f = FONT_STACK[font];
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  for (const op of ops) {
    ctx.font = fontString(font, op.size);
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${(f.tracking * op.size).toFixed(1)}px`;
    if (colours.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = op.size * 0.18; }
    if (colours.strokeWidth > 0) {
      ctx.strokeStyle = colours.stroke;
      ctx.lineWidth = Math.max(1, op.size * colours.strokeWidth);
      ctx.strokeText(op.text, op.x, op.y);
    }
    ctx.fillStyle = colours.fill;
    ctx.fillText(op.text, op.x, op.y);
  }
  ctx.restore();
}

/** Longest AI frame name; the booth orb shows only its first word. */
export const AI_FRAME_NAME_MAX = 40;

/**
 * A short human name for a NEW AI frame — "<Look> frame", "· 2" for a second
 * take. The server names rows after the raw prompt ("holly leaves and
 * snowflakes in the corn…"), which is what hosts then saw in their picker.
 * A blank look falls back to "Custom frame". Existing rows are never renamed.
 */
export function aiFrameName(look: string | null | undefined, takeIndex = 0, takes = 1): string {
  const base = cleanFrameText(look).slice(0, AI_FRAME_NAME_MAX - 10).trim();
  const name = base ? `${base} frame` : 'Custom frame';
  return takes > 1 ? `${name} · ${takeIndex + 1}` : name;
}

/** Default text for an event: its name, and its date when known. */
export function defaultFrameText(eventName: string | null | undefined, dateIso: string | null | undefined): FrameTextSpec {
  return { enabled: Boolean(cleanFrameText(eventName)), title: cleanFrameText(eventName), subtitle: formatFrameDate(dateIso), font: 'classic' };
}

/** "2026-06-12" → "12 June 2026" (locale-free, so the output is deterministic). */
export function formatFrameDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return '';
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${d} ${months[mo - 1]} ${m[1]}`;
}
