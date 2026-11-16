/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Build a look from my colour" — derive the whole 8-token event theme from
 * ONE colour, instantly and for free (no AI call). HSL-based: background,
 * surface, text and muted text take the colour's hue at fixed lightness bands,
 * and every text pairing is checked against WCAG contrast and nudged until it
 * passes, so a host can never pick a colour that makes their booth unreadable.
 *
 * PURE: no React, no supabase — imported by tests, the create wizard and
 * Branding alike.
 */
import { hslToHex, rgbToHsl } from './studio/colorways';

export type ThemeMode = 'dark' | 'light';

/** The 8 tokens that fully re-skin an event (same keys every template sets). */
export const THEME_TOKEN_KEYS = [
  '--color-brand-bg',
  '--color-brand-surface',
  '--color-brand-fg',
  '--color-brand-muted',
  '--color-accent',
  '--color-accent-2',
  '--color-accent-3',
  '--accent-rgb',
] as const;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** '#RRGGBB' (any case, surrounding space tolerated) → uppercase '#RRGGBB', or null. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return HEX_RE.test(v) ? v.toUpperCase() : null;
}

function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG 2.x relative luminance of a '#RRGGBB' colour (0 black … 1 white). */
export function relativeLuminance(hex: string): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = channels(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours, 1 … 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** 'r, g, b' — the format `--accent-rgb` expects. */
export function rgbString(hex: string): string {
  const [r, g, b] = channels(hex);
  return `${r}, ${g}, ${b}`;
}

function hslOf(hex: string): [number, number, number] {
  return rgbToHsl(...channels(hex));
}

/** Text that passes on `bg` WCAG AA (4.5:1 by default): starts from `l` and
 *  walks lightness AWAY from the background until it passes (or hits the end
 *  of the scale, where pure white/black always passes a dark/light bg). */
export function readableOn(bg: string, hue: number, sat: number, l: number, min = 4.5): string {
  const darkBg = relativeLuminance(bg) < 0.18;
  let light = l;
  for (let i = 0; i < 60; i++) {
    const c = hslToHex(hue, sat, light);
    if (contrastRatio(c, bg) >= min) return c.toUpperCase();
    light += darkBg ? 0.02 : -0.02;
    if (light > 1 || light < 0) break;
  }
  return darkBg ? '#FFFFFF' : '#000000';
}

/**
 * The full theme from one colour. Returns null for anything that is not a
 * '#RRGGBB' hex — callers keep the template look then.
 *
 * Guarantees (tested): fg/bg ≥ 7:1, muted/bg ≥ 4.5:1, accent/bg ≥ 3:1 (a UI
 * colour, not body text), and the accent keeps the host's hue.
 */
export function deriveTheme(accentHex: string, mode: ThemeMode = 'dark'): Record<string, string> | null {
  const accentIn = normalizeHex(accentHex);
  if (!accentIn) return null;
  const [h, s] = hslOf(accentIn);
  // A greyscale pick (silver, champagne-white) has no hue to carry — keep the
  // backgrounds neutral instead of tinting them an arbitrary red (hue 0).
  const tint = s < 0.08 ? 0 : Math.min(s, 0.45);
  const dark = mode === 'dark';

  const bg = hslToHex(h, tint * 0.7, dark ? 0.05 : 0.97).toUpperCase();
  const surface = hslToHex(h, tint * 0.6, dark ? 0.1 : 0.92).toUpperCase();
  const fg = readableOn(bg, h, tint * 0.35, dark ? 0.94 : 0.1, 7);
  const muted = readableOn(bg, h, tint * 0.5, dark ? 0.72 : 0.34, 4.5);

  // The accent keeps the host's exact colour when it already reads on the
  // background; otherwise only its lightness moves (hue + saturation stay).
  let accent = accentIn;
  if (contrastRatio(accent, bg) < 3) {
    const [, as, al] = hslOf(accentIn);
    accent = readableOn(bg, h, as, al, 3);
  }
  const [, as, al] = hslOf(accent);
  const accent2 = hslToHex(h, as, Math.min(al + 0.16, 0.9)).toUpperCase();
  const accent3 = hslToHex(h, as, Math.max(al - 0.18, 0.12)).toUpperCase();

  return {
    '--color-brand-bg': bg,
    '--color-brand-surface': surface,
    '--color-brand-fg': fg,
    '--color-brand-muted': muted,
    '--color-accent': accent,
    '--color-accent-2': accent2,
    '--color-accent-3': accent3,
    '--accent-rgb': rgbString(accent),
  };
}

/** A palette as extracted from a poster/invitation (every field optional). */
export interface ExtractedPalette {
  bg: string | null;
  surface: string | null;
  fg: string | null;
  accent: string | null;
  accent2: string | null;
}

/** Coerce anything into an ExtractedPalette of validated uppercase hexes, or
 *  null when not one field is a valid colour. The model is probabilistic —
 *  this is the client-side half of the hex validation (the edge fn does the
 *  same server-side). */
export function normalizePalette(raw: unknown): ExtractedPalette | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: ExtractedPalette = {
    bg: normalizeHex(r.bg),
    surface: normalizeHex(r.surface),
    fg: normalizeHex(r.fg),
    accent: normalizeHex(r.accent),
    accent2: normalizeHex(r.accent2),
  };
  return Object.values(out).some((v) => v !== null) ? out : null;
}
