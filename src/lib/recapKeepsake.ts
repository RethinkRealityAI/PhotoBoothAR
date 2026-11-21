/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The album page's reading of a host's keepsake settings — theme colours,
 * which take-home options to offer, and Beamy's filled greeting.
 *
 * The settings contract itself lives in keepsakeSettings.ts (shared with the
 * host editor and send-keepsakes); this module is only the PAGE's derivations,
 * kept pure so the contrast and fallback rules are tested in node rather than
 * eyeballed.
 *
 * WHY THE PAGE SETS ITS OWN TOKENS. /r/:slug mounts outside EventProvider, so
 * the platform tokens (--color-accent, --color-brand-fg…) are the Beamwall
 * defaults. The keepsake theme is applied as CSS variables on the page ROOT —
 * both a `--k-*` set for the album's own surfaces and an override of the
 * platform tokens, so any shared component inside (spinners, FetchFailed) wears
 * the theme too instead of a stray Beamwall blue on an ivory page.
 */
import { hexToRgbTriplet, onAccentForeground } from './branding';
import {
  fillKeepsakeCopy,
  type KeepsakeCopyContext,
  type KeepsakeDownloadId,
  type KeepsakeSettings,
  type KeepsakeThemeOption,
} from './keepsakeSettings';

/* ------------------------------------------------------------------ */
/* Colour                                                              */
/* ------------------------------------------------------------------ */

function channels(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (m === null) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  const h = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** WCAG relative luminance; 0 for an unparseable value. */
export function luminance(hex: string): number {
  const c = channels(hex);
  if (c === null) return 0;
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Linear mix of two hexes, t=0 → a, t=1 → b. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = channels(a);
  const cb = channels(b);
  if (ca === null || cb === null) return a;
  return toHex([ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t]);
}

/**
 * The accent, nudged toward the ink until it reads as TEXT on the background
 * (WCAG AA, 4.5:1). Ivory's antique gold is 2.9:1 on its cream — lovely as a
 * rule or a glow, unreadable as a label — so labels use this instead.
 */
export function readableAccent(accent: string, background: string, ink: string, min = 4.5): string {
  if (contrast(accent, background) >= min) return accent.toLowerCase();
  for (let t = 0.1; t <= 1.0001; t += 0.1) {
    const c = mixHex(accent, ink, t);
    if (contrast(c, background) >= min) return c;
  }
  return ink;
}

/** True for a light page (ivory) — flips shadows, glass and the colour-scheme. */
export function isLightTheme(theme: KeepsakeThemeOption): boolean {
  return luminance(theme.palette.background) > 0.5;
}

/** Every CSS variable the album root sets for a theme. */
export function recapThemeVars(theme: KeepsakeThemeOption): Record<string, string> {
  const p = theme.palette;
  const light = isLightTheme(theme);
  const accentText = readableAccent(p.accent, p.background, p.ink);
  const rgb = (h: string, fallback: string) => hexToRgbTriplet(h) ?? fallback;
  return {
    '--k-bg': p.background,
    '--k-surface': p.surface,
    '--k-ink': p.ink,
    '--k-muted': p.muted,
    '--k-accent': p.accent,
    '--k-accent-text': accentText,
    '--k-glow': p.glow,
    '--k-on-accent': onAccentForeground(p.accent) ?? '#0A0806',
    '--k-bg-rgb': rgb(p.background, '7, 6, 15'),
    '--k-surface-rgb': rgb(p.surface, '20, 17, 39'),
    '--k-ink-rgb': rgb(p.ink, '245, 243, 255'),
    '--k-accent-rgb': rgb(p.accent, '139, 125, 255'),
    '--k-glow-rgb': rgb(p.glow, '255, 181, 77'),
    // A hairline that reads on either polarity.
    '--k-line': light ? 'rgba(29, 26, 21, 0.12)' : 'rgba(255, 255, 255, 0.10)',
    '--k-shadow': light ? 'rgba(80, 60, 30, 0.18)' : 'rgba(0, 0, 0, 0.55)',
    // Platform tokens, re-pointed for anything shared rendered inside.
    '--color-accent': p.accent,
    '--color-accent-2': mixHex(p.accent, p.ink, 0.45),
    '--color-accent-3': mixHex(p.accent, p.background, 0.35),
    '--accent-rgb': rgb(p.accent, '139, 125, 255'),
    '--on-accent': onAccentForeground(p.accent) ?? '#0A0806',
    '--color-brand-fg': p.ink,
    '--color-brand-muted': p.muted,
    '--color-brand-bg': p.background,
    // camelCase: applied through a React style object.
    colorScheme: light ? 'light' : 'dark',
  };
}

/* ------------------------------------------------------------------ */
/* Take-home options                                                   */
/* ------------------------------------------------------------------ */

export interface TakeHomeAvailability {
  /** A rendered keepsake film exists. */
  film: boolean;
  /** Stills on the wall (the collage can only paint stills). */
  stills: number;
  /** Stills + clips. */
  moments: number;
}

const ORDER: readonly KeepsakeDownloadId[] = ['film', 'collage', 'photos'];

/**
 * Which take-home options the album offers, in display order.
 *
 * An option shows only when the host left it on AND there is something behind
 * it. If that leaves NOTHING — say a host kept only the film and the film has
 * not rendered — the album falls back to whatever it can actually give rather
 * than a section with no button: a guest arriving from the email must always be
 * able to take something home.
 */
export function takeHomeChoices(
  downloads: Readonly<Record<KeepsakeDownloadId, boolean>>,
  avail: TakeHomeAvailability,
): KeepsakeDownloadId[] {
  const has = (id: KeepsakeDownloadId) =>
    id === 'film' ? avail.film : id === 'collage' ? avail.stills > 0 : avail.moments > 0;
  const chosen = ORDER.filter((id) => downloads[id] === true && has(id));
  if (chosen.length > 0) return chosen;
  return ORDER.filter((id) => id !== 'film' && has(id)).slice(0, 1);
}

export const TAKE_HOME_LABELS: Record<KeepsakeDownloadId, string> = {
  film: 'The film',
  collage: 'A collage',
  photos: 'Every photo',
};

/* ------------------------------------------------------------------ */
/* Beamy's greeting                                                     */
/* ------------------------------------------------------------------ */

export interface RecapGreeting {
  headline: string;
  message: string;
  signOff: string;
  /** Who signs it; never empty. */
  signer: string;
}

export function recapGreeting(settings: KeepsakeSettings, ctx: KeepsakeCopyContext): RecapGreeting {
  const host = settings.copy.hostName.trim() || ctx.orgName.trim();
  return {
    headline: fillKeepsakeCopy(settings.copy.headline, ctx, settings.copy.hostName),
    message: fillKeepsakeCopy(settings.copy.message, ctx, settings.copy.hostName),
    signOff: settings.copy.signOff,
    signer: host !== '' ? host : 'Your host',
  };
}

/* ------------------------------------------------------------------ */
/* The line above the event name                                        */
/* ------------------------------------------------------------------ */

/**
 * A DB event's `copy.eyebrow` defaults to its own name, which printed the name
 * twice at the top of the album. When it adds nothing, show the night's date
 * instead ("Friday, November 20, 2026" — `starts_at` is stored as the event
 * day's UTC midnight, so it is formatted in UTC), or a plain label.
 */
export function recapEyebrow(eyebrow: string, title: string, startsAt: string | null | undefined): string {
  const e = eyebrow.trim();
  if (e !== '' && e.toLowerCase() !== title.trim().toLowerCase()) return e;
  const t = typeof startsAt === 'string' ? Date.parse(startsAt) : NaN;
  if (Number.isFinite(t)) {
    return new Date(t).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  return 'The event album';
}

/* ------------------------------------------------------------------ */
/* Intro bookkeeping                                                    */
/* ------------------------------------------------------------------ */

/** sessionStorage key: the intro plays once per visit per album. */
export function introSeenKey(slug: string): string {
  return `bw.recap.intro.${slug}`;
}
