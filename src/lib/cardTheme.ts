/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Keepsake theme snapshots — how a card carries its event's look.
 *
 * A published keepsake is read by guests at `/c/:publicId`, which lives OUTSIDE
 * `EventProvider` (it is anonymous, and the card's event is not in the URL). So
 * the card cannot ask the runtime for a theme: it must carry one. The host app
 * snapshots the event's resolved look into `cards.theme` (an existing jsonb
 * column, already returned verbatim by the card-view edge function), and the
 * guest pages replay it as inline CSS variables.
 *
 * Snapshotting — rather than resolving live — is deliberate:
 *   • the keepsake is a memento of the event AS IT WAS; re-theming every old
 *     card when a host later recolours their next event would be wrong, and
 *   • it keeps the public viewer to a single fetch with no event lookup.
 *
 * Everything here is pure (no React, no DOM, no supabase) so it unit-tests
 * directly; the DOM glue is a tiny hook in the guest pages.
 */
import { brandingCssVars, MANAGED_CSS_VARS } from './branding';
import type { BrandingOverrides } from '../types';

/** Version stamp so a future shape change can migrate old snapshots. */
export const CARD_THEME_VERSION = 1;

export interface CardTheme {
  v: number;
  /** CSS custom properties to set on the card page's root. */
  vars: Record<string, string>;
  /** Webfont stylesheet the event loads (same-origin or a font CDN). */
  fontHref?: string;
  /** Event display name, for the card's "from <event>" line. */
  eventName?: string;
}

/**
 * Only variables the event theme legitimately owns may ride along. A snapshot
 * is data the host's browser wrote and the guest's browser replays, so it is
 * treated as untrusted on the way back out: an unknown property name never
 * reaches the DOM.
 */
const ALLOWED_VARS: ReadonlySet<string> = new Set([
  ...MANAGED_CSS_VARS,
  '--color-accent',
  '--color-accent-2',
  '--color-accent-3',
  '--color-brand-bg',
  '--color-brand-surface',
  '--color-brand-fg',
  '--color-brand-muted',
  '--color-gold-200',
  '--color-gold-300',
  '--color-gold-400',
  '--color-gold-600',
  '--color-gold-700',
  '--color-brand-gold',
  '--color-noir-700',
  '--color-noir-800',
  '--color-noir-900',
  '--color-ivory',
  '--color-champagne',
  '--font-display',
  '--font-body',
  '--font-label',
  '--accent-rgb',
  '--on-accent',
]);

/**
 * A CSS value is safe to inline only if it cannot break out of the declaration
 * or pull in a resource. `url(` covers the only fetch-capable value form that
 * matters here; the rest of the characters end a declaration or open a block.
 */
function isSafeCssValue(value: string): boolean {
  if (value.length === 0 || value.length > 200) return false;
  if (/[;{}<>\\]/.test(value)) return false;
  if (/url\s*\(/i.test(value)) return false;
  if (/expression\s*\(/i.test(value)) return false;
  return true;
}

/** Keep only allow-listed properties carrying safe values. */
function sanitizeVars(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!ALLOWED_VARS.has(key)) continue;
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (isSafeCssValue(value)) out[key] = value;
  }
  return out;
}

/**
 * Only http(s) stylesheet URLs may be injected as a <link>. A relative path is
 * allowed too (the event's own bundled font), but nothing that could execute.
 */
export function safeFontHref(href: unknown): string | undefined {
  if (typeof href !== 'string') return undefined;
  const value = href.trim();
  if (value === '' || value.length > 500) return undefined;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  if (/^https:\/\/[^\s"'<>]+$/i.test(value)) return value;
  return undefined;
}

export interface BuildCardThemeInput {
  /** `EventConfig.themeVars` — the event's coded look. */
  themeVars?: Record<string, string> | null;
  /** Admin branding overrides, which win over the coded theme (same as live). */
  branding?: BrandingOverrides | null;
  fontHref?: string | null;
  eventName?: string | null;
}

/**
 * Snapshot an event's resolved look. Branding overrides are layered over the
 * coded themeVars in the same order the live app applies them (store's inline
 * vars beat the event stylesheet), so the card matches what guests saw.
 */
export function buildCardTheme(input: BuildCardThemeInput): CardTheme {
  const coded = sanitizeVars(input.themeVars ?? {});
  const overrides = sanitizeVars(brandingCssVars(input.branding ?? undefined));
  const theme: CardTheme = { v: CARD_THEME_VERSION, vars: { ...coded, ...overrides } };
  const font = safeFontHref(input.fontHref);
  if (font) theme.fontHref = font;
  const name = typeof input.eventName === 'string' ? input.eventName.trim() : '';
  if (name) theme.eventName = name.slice(0, 120);
  return theme;
}

/**
 * TOTAL parser for whatever is sitting in `cards.theme` — an old snapshot, a
 * hand-edited row, `{}`, or junk. Never throws; an unusable snapshot yields
 * null so callers fall back to platform styling rather than a broken page.
 */
export function normalizeCardTheme(raw: unknown): CardTheme | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const vars = sanitizeVars(obj.vars);
  const font = safeFontHref(obj.fontHref);
  const nameRaw = typeof obj.eventName === 'string' ? obj.eventName.trim() : '';
  const eventName = nameRaw ? nameRaw.slice(0, 120) : undefined;
  // A snapshot with nothing usable is indistinguishable from no snapshot.
  if (Object.keys(vars).length === 0 && !font && !eventName) return null;
  const version = typeof obj.v === 'number' && Number.isFinite(obj.v) ? obj.v : CARD_THEME_VERSION;
  const theme: CardTheme = { v: version, vars };
  if (font) theme.fontHref = font;
  if (eventName) theme.eventName = eventName;
  return theme;
}

/** True when the snapshot carries at least one colour to paint with. */
export function hasThemeVars(theme: CardTheme | null): boolean {
  return !!theme && Object.keys(theme.vars).length > 0;
}
