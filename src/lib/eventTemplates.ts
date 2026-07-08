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
