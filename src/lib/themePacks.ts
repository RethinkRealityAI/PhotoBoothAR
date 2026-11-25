/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Theme packs — a FULL event theme, not a tint. A pack re-skins every guest
 * surface of a platform event in the client's own branding: the welcome
 * page, the booth splash, the booth chrome (glass, tabs, shutter), the
 * send-off screen and the live wall, including the CTAs. Beamwall's
 * periwinkle never shows on an event wearing a pack.
 *
 * Stored in jsonb that already exists (no migration):
 *   events.config.theme = { pack: 'island-golden-hour', colors?: {...} }
 * Absent/unknown = today's behaviour, byte-for-byte. Coded legacy events
 * never read it (runtime.ts only builds DB rows; EventContext gates on
 * source === 'db').
 *
 * A pack is DATA: tokens + chrome vars + fonts + a backdrop id. The CSS that
 * consumes the `--tp-*` vars is generic (src/styles/themePacks.css) and the
 * backdrop is looked up by id (components/theme/ThemePackBackdrop.tsx), so a
 * new pack = one entry here + one backdrop component. Every pack's text,
 * glass and CTA pairs are contrast-tested in themePacks.test.ts.
 *
 * PURE: no React, no DOM, no supabase import.
 */
import type { BrandingColors } from '../types';
import { brandingCssVars } from './branding';
import { normalizeHex } from './themeDerive';

export type ThemePackTone = 'dark' | 'light';

/** The pack's own chrome, as `--tp-*` CSS custom properties. */
export interface ThemePackChrome {
  /** Glass panel fill (cards, chips, the booth bars). */
  glass: string;
  /** Denser glass for sheets and the phone bezel. */
  glassStrong: string;
  /** Hairline edge on glass. */
  hair: string;
  /** The lit top rim of glass. */
  rim: string;
  /** Drop shadow colour under floating things. */
  shadow: string;
  /** Legibility scrim over busy backgrounds. */
  scrim: string;
  /** The primary CTA's fill (may be a gradient — the molten metal). */
  ctaBg: string;
  /** The DARKEST colour inside ctaBg: what the CTA ink is tested against. */
  ctaSolid: string;
  /** Text/icons on the CTA. */
  ctaInk: string;
  /** Halo round the CTA. */
  ctaGlow: string;
  /** The booth shutter's core. */
  shutterCore: string;
  /** The booth preview's empty screen (before anyone has snapped). */
  screen: string;
}

export interface ThemePackFonts {
  /** Names and headlines (e.g. the couple's names). */
  display: string;
  /** Weight the display face exists in (script faces have one; never fake bold). */
  displayWeight: number;
  /** Letter-spacing for the display face. */
  displayTracking: string;
  /** Taglines, eyebrows and small flourishes. */
  accent: string;
  /** Self-hosted @font-face sheet (root-relative). Never a remote URL:
   *  guest pages must not block on fonts.gstatic.com at a venue. */
  href: string;
}

export interface ThemePack {
  id: string;
  name: string;
  /** One line for the host's picker. */
  blurb: string;
  tone: ThemePackTone;
  /** The 7 colour tokens, in the BrandingColors shape so the SAME mapper
   *  (branding.brandingCssVars) fans them out to the legacy scale tokens
   *  (gold-*, noir-*, ivory, champagne) the booth's older screens name. */
  colors: Required<BrandingColors>;
  chrome: ThemePackChrome;
  fonts: ThemePackFonts;
  /** Backdrop component id (components/theme/ThemePackBackdrop.tsx). */
  backdrop: string;
  /** Picker swatches, left → right. */
  swatches: string[];
  /** The colours page text may sit directly over (the scene's darkest-lit
   *  text zones after its own shade), for the contrast test. */
  textFields: string[];
}

/* ── The packs ─────────────────────────────────────────────────────────── */

export const THEME_PACKS: readonly ThemePack[] = [
  {
    id: 'island-golden-hour',
    name: 'Island Golden Hour',
    blurb: 'A paper-cut island at sunset in molten gold, copper and verdigris.',
    tone: 'dark',
    colors: {
      accent: '#E2B04A', // molten gold
      accent2: '#F3D58A', // light gold
      accent3: '#B8742F', // copper
      brandBg: '#1A0F0B', // umber dusk
      brandSurface: '#2A1A12', // bronze shadow
      brandFg: '#FBF3E4', // ivory
      brandMuted: '#E6D2B4', // sand
    },
    chrome: {
      glass: 'rgba(40, 22, 14, 0.52)',
      glassStrong: 'rgba(30, 16, 10, 0.78)',
      hair: 'rgba(243, 213, 138, 0.24)',
      rim: 'rgba(255, 236, 196, 0.48)',
      shadow: 'rgba(24, 10, 4, 0.55)',
      scrim: 'rgba(22, 11, 6, 0.6)',
      ctaBg: 'linear-gradient(135deg, #F7DE98 0%, #E8B954 30%, #D29A3C 62%, #F1CB76 100%)',
      ctaSolid: '#D29A3C',
      ctaInk: '#241309',
      ctaGlow: 'rgba(232, 185, 84, 0.62)',
      shutterCore: 'radial-gradient(circle at 34% 28%, #FBE6A8 0%, #E2B04A 36%, #B8742F 68%, #5E3418 100%)',
      screen: 'radial-gradient(circle at 50% 34%, rgba(242, 176, 78, 0.42), transparent 62%), linear-gradient(180deg, #3B2216 0%, #150B07 100%)',
    },
    fonts: {
      display: '"Pinyon Script", "Instrument Serif", Georgia, serif',
      displayWeight: 400,
      displayTracking: '0',
      accent: '"Instrument Serif", Georgia, serif',
      href: '/fonts/theme-packs.css',
    },
    backdrop: 'island-golden-hour',
    swatches: ['#3D1A1F', '#C8662E', '#F2B04E', '#E2B04A', '#3F8577'],
    // The upper dusk sky (title zone on phones) and the left dusk shade the
    // scene lays under the desktop title column.
    textFields: ['#2E1419', '#4A1F1C', '#5A2A20'],
  },
];

export function themePackById(id: unknown): ThemePack | undefined {
  return typeof id === 'string' ? THEME_PACKS.find((p) => p.id === id) : undefined;
}

/* ── Stored shape ─────────────────────────────────────────────────────── */

/** `events.config.theme`: the pack plus optional host colour overrides. */
export interface EventTheme {
  pack: string;
  /** Per-event tweaks on top of the pack (validated hex only). */
  colors?: BrandingColors;
}

const COLOR_KEYS: readonly (keyof BrandingColors)[] = [
  'accent', 'accent2', 'accent3', 'brandBg', 'brandSurface', 'brandFg', 'brandMuted',
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Total coercion of a stored `events.config.theme`. Unknown pack, wrong
 * shape or `null` → undefined (the caller keeps today's look). Invalid colour
 * overrides are dropped one by one; an empty override set is not stored.
 */
export function normalizeEventTheme(raw: unknown): EventTheme | undefined {
  if (!isRecord(raw)) return undefined;
  const pack = themePackById(raw.pack);
  if (!pack) return undefined;
  const colors: BrandingColors = {};
  if (isRecord(raw.colors)) {
    for (const k of COLOR_KEYS) {
      const hex = normalizeHex(raw.colors[k]);
      if (hex !== null) colors[k] = hex;
    }
  }
  return Object.keys(colors).length > 0 ? { pack: pack.id, colors } : { pack: pack.id };
}

/**
 * Every CSS custom property a theme sets on `:root[data-event=…]`: the 8
 * semantic tokens (+ the legacy scale tokens and `--on-accent`, through the
 * same mapper Branding uses), the pack chrome as `--tp-*`, and the fonts.
 * null for an unknown pack.
 */
export function themePackVars(theme: EventTheme | undefined): Record<string, string> | null {
  const pack = theme ? themePackById(theme.pack) : undefined;
  if (!pack || !theme) return null;
  const colors: BrandingColors = { ...pack.colors, ...(theme.colors ?? {}) };
  const c = pack.chrome;
  return {
    ...brandingCssVars({ colors }),
    '--tp-glass': c.glass,
    '--tp-glass-strong': c.glassStrong,
    '--tp-hair': c.hair,
    '--tp-rim': c.rim,
    '--tp-shadow': c.shadow,
    '--tp-scrim': c.scrim,
    '--tp-cta-bg': c.ctaBg,
    '--tp-cta-ink': c.ctaInk,
    '--tp-cta-glow': c.ctaGlow,
    '--tp-shutter-core': c.shutterCore,
    '--tp-screen': c.screen,
    '--tp-font-display': pack.fonts.display,
    '--tp-font-display-weight': String(pack.fonts.displayWeight),
    '--tp-font-display-tracking': pack.fonts.displayTracking,
    '--tp-font-accent': pack.fonts.accent,
    // The classic serif utility (font-serif) takes the pack's accent face,
    // so every older headline in the booth wears it too.
    '--font-serif': pack.fonts.accent,
    '--font-script': pack.fonts.display,
  };
}

/** The tone a theme's guest pages take (welcome, splash, wall chrome). */
export function themeTone(theme: EventTheme | undefined): ThemePackTone | undefined {
  return theme ? themePackById(theme.pack)?.tone : undefined;
}
