/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure helpers for applying admin-editable per-event branding overrides on top
 * of the event's coded EventConfig. Kept free of React/DOM so they're trivially
 * unit-testable; the store + DOM glue live in store.ts.
 */
import type { EventCopy } from '../events/types';
import type { BrandingColors, BrandingOverrides } from '../types';

/** Copy string fields an admin can override (filePrefix/steps stay coded). */
const COPY_STRING_FIELDS = [
  'eventName',
  'eyebrow',
  'tagline',
  'fullName',
  'thankYou',
  'shareTitle',
  'momentTitle',
  'shareText',
] as const;

/**
 * Overlay branding overrides onto the coded copy. Only non-blank string fields
 * win; onboardingSteps replaces the coded steps only when it's a non-empty array.
 * Returns a fresh object — never mutates `defaults`.
 */
export function mergeCopy(defaults: EventCopy, o?: BrandingOverrides | null): EventCopy {
  const out: EventCopy = { ...defaults };
  if (!o) return out;
  for (const k of COPY_STRING_FIELDS) {
    const v = o[k];
    if (typeof v === 'string' && v.trim() !== '') out[k] = v;
  }
  if (Array.isArray(o.onboardingSteps) && o.onboardingSteps.length > 0) {
    out.onboardingSteps = o.onboardingSteps;
  }
  return out;
}

/**
 * Each semantic color override also drives the underlying scale tokens the
 * reused UI references (gold-*, noir-*, ivory, champagne) — same strategy the
 * per-event theme.css files use — so a single picker recolors the whole UI.
 */
const COLOR_VAR_MAP: Record<keyof BrandingColors, string[]> = {
  accent: ['--color-accent', '--color-gold-400', '--color-brand-gold'],
  accent2: ['--color-accent-2', '--color-gold-300', '--color-gold-200'],
  accent3: ['--color-accent-3', '--color-gold-600', '--color-gold-700'],
  brandBg: ['--color-brand-bg', '--color-noir-900'],
  brandSurface: ['--color-brand-surface', '--color-noir-800', '--color-noir-700'],
  brandFg: ['--color-brand-fg', '--color-ivory'],
  brandMuted: ['--color-brand-muted', '--color-champagne'],
};

/** Every CSS variable brandingCssVars can emit — used to clear stale inline
 *  overrides before re-applying, so resets/reverts fully restore the theme. */
export const MANAGED_CSS_VARS: string[] = [
  ...new Set(Object.values(COLOR_VAR_MAP).flat()),
  '--accent-rgb',
  '--on-accent',
];

/** "#D4AF37" → "212, 175, 55" (for rgba() usage). null if not a 6-digit hex. */
export function hexToRgbTriplet(hex: string): string | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/**
 * Readable foreground for text/icons sitting ON the accent colour.
 *
 * `.bg-foil` is built from the host's accent, but every CTA using it hard-codes
 * its foreground (`text-noir-900` or `text-white`) — and a host may set any hex
 * here with no contrast check, so a dark accent produced an unreadable button
 * on exactly the controls a guest needs most (the booth shutter, "Try again").
 *
 * Uses the WCAG relative-luminance threshold: light accents take the near-black
 * ink, dark accents take the ivory. Returns null for a non-hex input so callers
 * can leave the default in place.
 */
export function onAccentForeground(hex: string): string | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255);
  // 0.179 is the luminance at which black and white contrast equally (1.055/√21 - 0.055).
  return luminance > 0.179 ? '#0A0806' : '#F7F1E3';
}

/**
 * Map color overrides to a CSS-variable record to set on :root. Returns {} when
 * there are no colors. The accent color also derives `--accent-rgb` and
 * `--on-accent`.
 */
export function brandingCssVars(o?: BrandingOverrides | null): Record<string, string> {
  const vars: Record<string, string> = {};
  const c = o?.colors;
  if (!c) return vars;
  for (const key of Object.keys(COLOR_VAR_MAP) as (keyof BrandingColors)[]) {
    const val = c[key];
    if (typeof val === 'string' && val.trim() !== '') {
      for (const cssVar of COLOR_VAR_MAP[key]) vars[cssVar] = val.trim();
    }
  }
  if (typeof c.accent === 'string') {
    const triplet = hexToRgbTriplet(c.accent);
    if (triplet) vars['--accent-rgb'] = triplet;
    const ink = onAccentForeground(c.accent);
    if (ink) vars['--on-accent'] = ink;
  }
  return vars;
}
