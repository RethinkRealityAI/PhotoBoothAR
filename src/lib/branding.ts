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
];

/** "#D4AF37" → "212, 175, 55" (for rgba() usage). null if not a 6-digit hex. */
export function hexToRgbTriplet(hex: string): string | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/**
 * Map color overrides to a CSS-variable record to set on :root. Returns {} when
 * there are no colors. The accent color also derives `--accent-rgb`.
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
  }
  return vars;
}
