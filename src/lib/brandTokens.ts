/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Brand v2 colour tokens as data, for the /brand style guide's swatches and
 * contrast readouts. src/styles/brand.css is the source the pages render
 * from; brandTokens.test.ts reads that file and fails if the two disagree.
 */

export interface ColorToken { name: string; cssVar: string; hex: string; role: string; }

export const COLOR_TOKENS: ColorToken[] = [
  { name: 'Midnight', cssVar: '--bw-bg', hex: '#080A14', role: 'Page background' },
  { name: 'Surface', cssVar: '--bw-surface', hex: '#10131F', role: 'Cards, bubbles' },
  { name: 'Surface 2', cssVar: '--bw-surface-2', hex: '#171B2B', role: 'Secondary buttons, icon tiles, fields' },
  { name: 'Ink', cssVar: '--bw-ink', hex: '#F4F5FA', role: 'Headlines, body on dark' },
  { name: 'Muted', cssVar: '--bw-muted', hex: '#A3A9BD', role: 'Supporting text, labels' },
  { name: 'Faint', cssVar: '--bw-faint', hex: '#6D7389', role: 'Placeholders, idle dots (not for body)' },
  { name: 'Beam', cssVar: '--bw-accent', hex: '#8E96FF', role: 'Primary actions, focus, selection' },
  { name: 'Beam hover', cssVar: '--bw-accent-hover', hex: '#A5ABFF', role: 'Primary hover' },
  { name: 'Beam pressed', cssVar: '--bw-accent-pressed', hex: '#7780F0', role: 'Primary pressed' },
  { name: 'On beam', cssVar: '--bw-on-accent', hex: '#0B0D1A', role: 'Label on Beam' },
  { name: 'Core', cssVar: '--bw-core', hex: '#FFC56B', role: 'One warm highlight per screen' },
  { name: 'Success', cssVar: '--bw-success', hex: '#5FD4A0', role: 'Confirmations' },
  { name: 'Danger', cssVar: '--bw-danger', hex: '#FF7A85', role: 'Errors' },
];

export function tokenHex(cssVar: string): string {
  const t = COLOR_TOKENS.find((c) => c.cssVar === cssVar);
  if (t === undefined) throw new Error(`unknown token ${cssVar}`);
  return t.hex;
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

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
