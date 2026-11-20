/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Event templates — the starting points a host picks when creating an event.
 * Each one seeds a complete, on-brand look (theme colours, a live background,
 * a tasteful frame, matching effects and copy) so a brand-new event is
 * beautiful the moment it's created instead of a blank grey draft.
 *
 * A template's `configPatch()` produces exactly the JSON that
 * `buildRuntimeConfig` (events.config) reads — themeVars, accentHexes,
 * arContent, background_template, defaultExperienceId, landingRoute and copy —
 * so we can seed it client-side via `updateEventConfig` right after create.
 *
 * Only frames WITHOUT baked event text are used (no "Hope Gala"/"SCAGO"), so
 * every template is neutral and ready for any customer.
 */

import { contrastRatio, deriveTheme, readableOn, relativeLuminance, type ExtractedPalette } from './themeDerive';

export type TemplateId = 'wedding' | 'gala' | 'birthday' | 'corporate' | 'party';

export interface EventTemplate {
  id: TemplateId;
  /** Maps to the events.event_type column. */
  eventType: 'wedding' | 'gala' | 'birthday' | 'corporate' | 'party';
  label: string;
  blurb: string;
  emoji: string;
  /** CSS gradient for the picker card, evoking the palette. */
  swatch: string;
  /** The 8 theme tokens that fully re-skin the app. */
  themeVars: Record<string, string>;
  /** Canvas/confetti colours, brightest first. */
  accentHexes: string[];
  /** Live background component id (see backgrounds registry). */
  background: 'aurora' | 'bokeh' | 'confetti' | 'starfield' | 'waves' | 'geometry';
  /** Built-in frame ids (no baked text) exposed in the booth/upload. */
  borderIds: string[];
  /** Built-in shader ids exposed as effects. */
  shaderIds: string[];
  /** The frame applied by default + used for the live preview. */
  frameId: string;
  /** Where the guest link lands. */
  landingRoute: '/booth' | '/wall';
  /** A short tagline for the event copy. */
  tagline: string;
}

/**
 * The brand look (events.config.look = 'beamwall'): new events start here
 * unless the host picks a colour. Concrete values of the brand v2 tokens
 * (src/styles/brand.css --bw-*), for the places that need literal theme
 * tokens rather than the stylesheet: TemplatePreview's inline style. The live
 * guest surfaces get the full look (glass, type, fields) from
 * src/styles/platform.css via <html data-event-look="beamwall">.
 */
export const BEAMWALL_LOOK_VARS: Record<string, string> = {
  '--color-brand-bg': '#33318A',
  '--color-brand-surface': '#2E2C7E',
  '--color-brand-fg': '#FFFFFF',
  '--color-brand-muted': 'rgba(255, 255, 255, 0.86)',
  '--color-accent': '#D4D6FF',
  '--color-accent-2': '#E4E5FF',
  '--color-accent-3': '#BFC2FF',
  '--accent-rgb': '212, 214, 255',
  '--on-accent': '#1A1740',
};

export const EVENT_TEMPLATES: EventTemplate[] = [
  {
    id: 'wedding',
    eventType: 'wedding',
    label: 'Wedding',
    blurb: 'Timeless gold on deep green — elegant frames and a soft champagne glow.',
    emoji: '💍',
    swatch: 'linear-gradient(135deg, #0A130D 0%, #14351F 55%, #D4AF37 140%)',
    themeVars: {
      '--color-brand-bg': '#070B08',
      '--color-brand-surface': '#10160F',
      '--color-brand-fg': '#F5F1E6',
      '--color-brand-muted': '#CBB98F',
      '--color-accent': '#D4AF37',
      '--color-accent-2': '#EACB6E',
      '--color-accent-3': '#A87C1F',
      '--accent-rgb': '212, 175, 55',
    },
    accentHexes: ['#D4AF37', '#EACB6E', '#FBF3D9', '#A87C1F'],
    background: 'waves',
    borderIds: ['dw-frame-classic', 'dw-corners', 'overlay-confetti'],
    shaderIds: ['champagne-sparkle', 'golden-hour-bloom', 'aurora-lumina', 'velvet-film'],
    frameId: 'dw-frame-classic',
    landingRoute: '/booth',
    tagline: 'Celebrate the moment.',
  },
  {
    id: 'gala',
    eventType: 'gala',
    label: 'Gala',
    blurb: 'Black-tie glamour — warm noir, bokeh light and gilded corners.',
    emoji: '🥂',
    swatch: 'linear-gradient(135deg, #0A0806 0%, #241809 55%, #E8C766 140%)',
    themeVars: {
      '--color-brand-bg': '#0A0806',
      '--color-brand-surface': '#1A130C',
      '--color-brand-fg': '#F7F1E3',
      '--color-brand-muted': '#E9D9B8',
      '--color-accent': '#D4AF37',
      '--color-accent-2': '#E8C766',
      '--color-accent-3': '#A67C1F',
      '--accent-rgb': '212, 175, 55',
    },
    accentHexes: ['#D4AF37', '#E8C766', '#FBF3D9', '#A67C1F'],
    background: 'bokeh',
    borderIds: ['dw-corners', 'dw-frame-classic', 'overlay-confetti'],
    shaderIds: ['aureate-god-rays', 'celestial-lens-flare', 'golden-hour-bloom', 'champagne-sparkle'],
    frameId: 'dw-corners',
    landingRoute: '/booth',
    tagline: 'An unforgettable evening.',
  },
  {
    id: 'birthday',
    eventType: 'birthday',
    label: 'Birthday',
    blurb: 'Playful pink & gold with confetti and a holographic shimmer.',
    emoji: '🎉',
    swatch: 'linear-gradient(135deg, #14091F 0%, #4A1450 55%, #FF6FD6 140%)',
    themeVars: {
      '--color-brand-bg': '#14091F',
      '--color-brand-surface': '#1F1030',
      '--color-brand-fg': '#FBEFF7',
      '--color-brand-muted': '#E3B8D6',
      '--color-accent': '#FF6FD6',
      '--color-accent-2': '#FFD166',
      '--color-accent-3': '#C43B9E',
      '--accent-rgb': '255, 111, 214',
    },
    accentHexes: ['#FF6FD6', '#FFD166', '#FFFFFF', '#C43B9E'],
    background: 'confetti',
    borderIds: ['overlay-confetti', 'jj-equalizer'],
    shaderIds: ['holo-bloom', 'laser-sparkle', 'prismatic-holo', 'champagne-sparkle'],
    frameId: 'overlay-confetti',
    landingRoute: '/booth',
    tagline: 'Let’s celebrate!',
  },
  {
    id: 'corporate',
    eventType: 'corporate',
    label: 'Corporate',
    blurb: 'Refined and on-brand — restrained gold on cool slate.',
    emoji: '🏢',
    swatch: 'linear-gradient(135deg, #0B0F14 0%, #1B2530 55%, #C9A24A 140%)',
    themeVars: {
      '--color-brand-bg': '#0B0F14',
      '--color-brand-surface': '#141A22',
      '--color-brand-fg': '#EAF0F5',
      '--color-brand-muted': '#A9B7C4',
      '--color-accent': '#C9A24A',
      '--color-accent-2': '#E4CE93',
      '--color-accent-3': '#8C6E2E',
      '--accent-rgb': '201, 162, 74',
    },
    accentHexes: ['#C9A24A', '#E4CE93', '#EAF0F5', '#8C6E2E'],
    background: 'geometry',
    borderIds: ['dw-frame-classic', 'dw-corners'],
    shaderIds: ['velvet-film', 'golden-hour-bloom', 'celestial-lens-flare'],
    frameId: 'dw-frame-classic',
    landingRoute: '/booth',
    tagline: 'Made memorable.',
  },
  {
    id: 'party',
    eventType: 'party',
    label: 'Party',
    blurb: 'High-energy neon — electric magenta & cyan with an equalizer frame.',
    emoji: '🕺',
    swatch: 'linear-gradient(135deg, #0B0220 0%, #2B0B54 45%, #FF2D9B 120%)',
    themeVars: {
      '--color-brand-bg': '#0B0220',
      '--color-brand-surface': '#160A33',
      '--color-brand-fg': '#F3E9FF',
      '--color-brand-muted': '#B9A8E8',
      '--color-accent': '#FF2D9B',
      '--color-accent-2': '#19E3FF',
      '--color-accent-3': '#7A2BFF',
      '--accent-rgb': '255, 45, 155',
    },
    accentHexes: ['#FF2D9B', '#19E3FF', '#C6FF1A', '#7A2BFF'],
    background: 'starfield',
    borderIds: ['jj-neon-frame', 'jj-equalizer', 'overlay-confetti'],
    shaderIds: ['neon-pulse', 'laser-sparkle', 'holo-bloom', 'crystalline-kaleidoscope'],
    frameId: 'jj-neon-frame',
    landingRoute: '/wall',
    tagline: 'Turn it up.',
  },
];

export function templateById(id: string | null | undefined): EventTemplate | undefined {
  return EVENT_TEMPLATES.find((t) => t.id === id);
}

/** Curated accent swatches the concierge offers (any template). */
export const ACCENT_SWATCHES = [
  '#D4AF37', // classic gold
  '#FF6FD6', // rose pop
  '#19E3FF', // electric cyan
  '#7A2BFF', // royal violet
  '#2FDD8B', // emerald
  '#FF5A5F', // coral
  '#E8E4DA', // champagne silver
] as const;

/** '#RRGGBB' → 'r, g, b' (the format --accent-rgb expects), or null. */
export function hexToRgbString(hex: string): string | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/**
 * Client mirror of the create-event edge function's accepted `eventType`s
 * (supabase/functions/create-event/index.ts EVENT_TYPES). A test pins every
 * template's eventType into this list — a Corporate template once 400'd
 * because the server list lacked it. Keep the two in step by hand.
 */
export const CREATE_EVENT_TYPES = ['wedding', 'gala', 'birthday', 'corporate', 'party', 'remote'] as const;

/**
 * A poster/invitation palette → the 8 theme tokens, contrast-safe. The accent
 * anchors a full derived theme (deriveTheme); the poster's own background,
 * surface, text and second accent replace the derived ones only when they are
 * valid hexes — and the text colour is trusted only if it reads on the
 * background (≥ 4.5:1). Otherwise text and muted text are derived for that
 * background instead, so a model's bad pairing can never ship an unreadable
 * booth. Returns {} when the palette has no usable accent (keep the template).
 */
export function paletteThemePatch(palette: ExtractedPalette | null | undefined): Record<string, string> {
  if (!palette) return {};
  const accent = palette.accent ?? palette.accent2;
  if (!accent) return {};
  const base = deriveTheme(accent, 'dark');
  if (!base) return {};
  const out = { ...base };
  const bg = palette.bg;
  if (bg) {
    out['--color-brand-bg'] = bg;
    out['--color-brand-surface'] = palette.surface ?? base['--color-brand-surface'];
    // Re-derive text for THIS background unless the poster's own text passes.
    const dark = relativeLuminance(bg) < 0.18;
    const fgOk = palette.fg !== null && contrastRatio(palette.fg, bg) >= 4.5;
    out['--color-brand-fg'] = fgOk && palette.fg ? palette.fg : readableOn(bg, 0, 0, dark ? 0.95 : 0.08, 7);
    out['--color-brand-muted'] = readableOn(bg, 0, 0, dark ? 0.72 : 0.34, 4.5);
  } else if (palette.fg !== null && contrastRatio(palette.fg, out['--color-brand-bg']) >= 4.5) {
    out['--color-brand-fg'] = palette.fg;
  }
  if (palette.accent2 && palette.accent) out['--color-accent-2'] = palette.accent2;
  return out;
}

/** Theme-var overrides that re-accent any template with one chosen colour.
 *  Used by the live TemplatePreview AND the events.config themeVars patch,
 *  so what the host previews is exactly what the event gets. */
export function accentThemePatch(accent: string): Record<string, string> {
  const rgb = hexToRgbString(accent);
  if (!rgb) return {};
  return {
    '--color-accent': accent,
    '--color-accent-2': accent,
    '--accent-rgb': rgb,
  };
}

/**
 * The events.config JSON a template seeds. Shallow-merged into the row's config
 * (which already holds `{ copy: { fullName } }`), so we re-include fullName +
 * eventName to survive the merge.
 */
/**
 * True when an event's stored themeVars are empty or exactly one occasion
 * template's own tokens, i.e. nobody chose its colours: create seeded them
 * (or seeding never ran). Such events show the brand look (owner decision
 * 2026-11-18, "Switch them too"); any edited theme is the host's and stays.
 */
export function isUntouchedTemplateTheme(vars: Record<string, unknown> | null | undefined): boolean {
  const entries = Object.entries(vars ?? {});
  if (entries.length === 0) return true;
  return EVENT_TEMPLATES.some((t) => {
    const tv = Object.entries(t.themeVars);
    return tv.length === entries.length && tv.every(([k, v]) => (vars as Record<string, unknown>)[k] === v);
  });
}

export function templateConfigPatch(t: EventTemplate, eventName: string): Record<string, unknown> {
  return {
    themeVars: t.themeVars,
    accentHexes: t.accentHexes,
    background_template: t.background,
    landingRoute: t.landingRoute,
    defaultExperienceId: `builtin:border:${t.frameId}`,
    arContent: { shaderIds: t.shaderIds, borderIds: t.borderIds },
    copy: {
      fullName: eventName,
      eventName,
      tagline: t.tagline,
    },
  };
}
