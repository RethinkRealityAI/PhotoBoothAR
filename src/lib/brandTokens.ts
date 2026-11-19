/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Brand v2 colour tokens as data, for the /brand style guide's swatches and
 * contrast readouts. src/styles/brand.css is the source the pages render
 * from; brandTokens.test.ts reads that file and fails if the two disagree.
 *
 * Liquid glass makes contrast a COMPOSITE question: white text never sits on
 * a token, it sits on the frost over the indigo veil over whichever field
 * stop is behind the panel. `panelOver` / `cardOver` rebuild that stack so
 * the test (and /brand) measure the pixels the reader actually sees.
 */

export interface ColorToken { name: string; cssVar: string; value: string; role: string; }

export const COLOR_TOKENS: ColorToken[] = [
  { name: 'Field', cssVar: '--bw-bg', value: '#4840C6', role: 'Scene base, behind all copy' },
  { name: 'Field 2', cssVar: '--bw-bg-2', value: '#4F48CE', role: 'Glow behind Beamy and the wall' },
  { name: 'Field 3', cssVar: '--bw-bg-3', value: '#6F66E8', role: 'Outer glow, orbs behind the glass' },
  { name: 'Field 4', cssVar: '--bw-bg-4', value: '#867DF0', role: 'Corner light, outside the panel' },
  { name: 'Midnight', cssVar: '--bw-night', value: '#0F0D33', role: 'Mid-page field: the journey’s deepest stop' },
  { name: 'Midnight 2', cssVar: '--bw-night-2', value: '#1F1A63', role: 'Midnight floor light, rising from below' },
  { name: 'Midnight glow', cssVar: '--bw-night-glow', value: '#5B4BE0', role: 'Big soft violet glows on the midnight field' },
  { name: 'Teal glow', cssVar: '--bw-night-teal', value: 'rgba(34, 211, 238, 0.12)', role: 'One faint glow, low right, midnight only' },
  { name: 'Glass veil', cssVar: '--bw-veil', value: 'rgba(43, 42, 140, 0.18)', role: 'Panel underlayer, under the frost' },
  { name: 'Frost', cssVar: '--bw-frost', value: 'rgba(255, 255, 255, 0.16)', role: 'Panel frost (milky, lifts the field)' },
  { name: 'Card veil', cssVar: '--bw-card-veil', value: 'rgba(43, 42, 140, 0.22)', role: 'Glass card tint' },
  { name: 'Card frost', cssVar: '--bw-card-frost', value: 'rgba(255, 255, 255, 0.08)', role: 'Glass card frost' },
  { name: 'Deep indigo', cssVar: '--bw-deep', value: '#2B2A8C', role: 'Shadows, wall tiles' },
  { name: 'Deep ink', cssVar: '--bw-deep-2', value: '#1A1740', role: 'Floor shade, wall frame' },
  { name: 'Ink', cssVar: '--bw-ink', value: '#FFFFFF', role: 'Headlines, primary text' },
  { name: 'Ink 2', cssVar: '--bw-muted', value: 'rgba(255, 255, 255, 0.92)', role: 'Supporting text, labels' },
  { name: 'Faint', cssVar: '--bw-faint', value: 'rgba(255, 255, 255, 0.50)', role: 'Idle dots only, never text' },
  { name: 'On light', cssVar: '--bw-on-light', value: '#1A1740', role: 'Text on white: bubble, selected cards' },
  { name: 'Primary', cssVar: '--bw-accent', value: '#FFFFFF', role: 'Primary button fill' },
  { name: 'Primary hover', cssVar: '--bw-accent-hover', value: '#ECEBFF', role: 'Primary hover' },
  { name: 'Primary pressed', cssVar: '--bw-accent-pressed', value: '#DCDAFB', role: 'Primary pressed' },
  { name: 'On primary', cssVar: '--bw-on-accent', value: '#1A1740', role: 'Label on the primary button' },
  { name: 'Core', cssVar: '--bw-core', value: '#FFC56B', role: 'Beam core, active step, one highlight' },
  { name: 'Success', cssVar: '--bw-success', value: '#9BEBC6', role: 'Confirmation dots and icons' },
  { name: 'Danger', cssVar: '--bw-danger', value: '#FFC4CA', role: 'Live dot, error icons' },
];

/** Field stops white copy may sit over (the lighter glows are kept off the copy). */
export const TEXT_FIELDS = ['--bw-bg'] as const;
/** Field stops glass cards may sit over (cards also live in the glow by Beamy). */
export const CARD_FIELDS = ['--bw-bg', '--bw-bg-2'] as const;
/** Every field stop that can be behind the panel. */
export const ALL_FIELDS = ['--bw-bg', '--bw-bg-2', '--bw-bg-3', '--bw-bg-4'] as const;

/** The midnight stops of the /beamy colour journey (the page crossfades the field into these mid-page). */
export const NIGHT_FIELDS = ['--bw-night', '--bw-night-2'] as const;
/** The still film grain's opacity over the field (brand.css --bw-grain-opacity; blend: overlay). */
export const GRAIN_OPACITY = 0.07;

/**
 * Worst case for text over the grain: the grain is under the panes, so it
 * can only shift the field the pane frosts over. The brightest grain pixel
 * (white) in `overlay` at GRAIN_OPACITY: per channel, a dark channel b goes
 * toward 2b, a light one toward white, mixed in at the layer's opacity.
 */
export function grainLift(field: string): string {
  const f = parseColor(field);
  const ch = (v: number) => {
    const b = v / 255;
    const blend = b < 0.5 ? 2 * b : 1;
    return (b + (blend - b) * GRAIN_OPACITY) * 255;
  };
  return toHex({ r: ch(f.r), g: ch(f.g), b: ch(f.b), a: 1 });
}

export function tokenValue(cssVar: string): string {
  const t = COLOR_TOKENS.find((c) => c.cssVar === cssVar);
  if (t === undefined) throw new Error(`unknown token ${cssVar}`);
  return t.value;
}

/** An opaque token's #RRGGBB (throws for a translucent one). */
export function tokenHex(cssVar: string): string {
  const v = tokenValue(cssVar);
  if (!/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`${cssVar} is not opaque: ${v}`);
  return v;
}

interface Rgba { r: number; g: number; b: number; a: number; }

/** `#RRGGBB` or `rgba(r, g, b, a)`. */
export function parseColor(v: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(v.trim());
  if (hex !== null) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(v.trim());
  if (m === null) throw new Error(`unsupported colour: ${v}`);
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) };
}

const toHex = (c: Rgba) => `#${[c.r, c.g, c.b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

/** `fg` (possibly translucent) painted over an opaque `bg`, as #RRGGBB. */
export function composite(fg: string, bg: string): string {
  const f = parseColor(fg);
  const b = parseColor(bg);
  if (b.a !== 1) throw new Error(`composite needs an opaque backdrop: ${bg}`);
  return toHex({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
}

/** The glass panel's pixel over a field stop: frost over veil over field. */
export function panelOver(field: string): string {
  return composite(tokenValue('--bw-frost'), composite(tokenValue('--bw-veil'), field));
}

/** A glass card's pixel: card frost over card veil over the panel. */
export function cardOver(field: string): string {
  return composite(tokenValue('--bw-card-frost'), composite(tokenValue('--bw-card-veil'), panelOver(field)));
}

/** WCAG 2.x relative luminance of a #RRGGBB colour. */
export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (m === null) throw new Error(`not a #RRGGBB colour: ${hex}`);
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** WCAG contrast ratio, 1..21. A translucent `fg` is composited over `bg` first. */
export function contrastRatio(fg: string, bg: string): number {
  const back = parseColor(bg);
  if (back.a !== 1) throw new Error(`contrast needs an opaque backdrop: ${bg}`);
  const b = toHex(back);
  const f = composite(fg, b);
  const la = luminance(f);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
