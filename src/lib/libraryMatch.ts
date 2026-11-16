/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Recommended for your event" — ranking the shared frames & filters library
 * against an event's occasion and colour.
 *
 * PURE: no React, no Supabase. Library items carry optional tags at
 * `config.library = { listed?: boolean, tags?: { occasions[], colors[],
 * styles[] } }`, written by whoever publishes them to the shared library. Every
 * field is optional and every malformed value is ignored — a badly tagged item
 * must never break the picker, it simply ranks last.
 *
 * Scoring: occasion match 2, colour-family match 1, otherwise the incoming
 * order is kept (Array.prototype.sort is stable). Items with no tags at all
 * sort after every tagged item.
 */

/** Fixed colour families a hex resolves to. dark/light/neutral are checked
 *  before hue, because the hue of a near-black or a grey is noise. */
export type ColorFamily =
  | 'red' | 'orange' | 'gold' | 'yellow' | 'green' | 'teal'
  | 'blue' | 'purple' | 'pink' | 'neutral' | 'dark' | 'light';

export const COLOR_FAMILIES: readonly ColorFamily[] = [
  'red', 'orange', 'gold', 'yellow', 'green', 'teal',
  'blue', 'purple', 'pink', 'neutral', 'dark', 'light',
];

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Parse #rgb / #rrggbb (the # is optional). null for anything else. */
function parseHex(hex: string): [number, number, number] | null {
  const m = HEX_RE.exec(hex.trim());
  if (m === null) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The colour family of a hex string, or null when it is not a colour. */
export function colorFamily(hex: string | null | undefined): ColorFamily | null {
  if (typeof hex !== 'string') return null;
  const rgb = parseHex(hex);
  if (rgb === null) return null;
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  // Saturation (HSL). d === 0 means a pure grey, whose saturation is 0.
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

  if (l < 0.13) return 'dark';
  if (l > 0.9) return 'light';
  if (s < 0.15) return l < 0.3 ? 'dark' : l > 0.8 ? 'light' : 'neutral';

  let hue: number;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  hue *= 60;
  if (hue < 0) hue += 360;

  // A pale red is what everyone calls pink (#FFC0CB sits at hue 350).
  if (hue < 15 || hue >= 345) return l >= 0.7 ? 'pink' : 'red';
  if (hue < 40) return 'orange';
  if (hue < 52) return 'gold';
  if (hue < 70) return 'yellow';
  if (hue < 160) return 'green';
  if (hue < 195) return 'teal';
  if (hue < 255) return 'blue';
  if (hue < 310) return 'purple';
  return 'pink';
}

export interface LibraryTags {
  occasions: string[];
  colors: ColorFamily[];
  styles: string[];
}

function lowerStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim().toLowerCase())
    .filter((x) => x !== '');
}

function libraryBlock(config: unknown): Record<string, unknown> | null {
  if (config === null || typeof config !== 'object') return null;
  const lib = (config as Record<string, unknown>).library;
  return lib !== null && typeof lib === 'object' && !Array.isArray(lib)
    ? (lib as Record<string, unknown>)
    : null;
}

/** An item's tags, or null when it carries none at all. Colour tags may be
 *  family names ('gold') or hexes ('#D4AF37'); both resolve to a family. */
export function libraryTags(config: unknown): LibraryTags | null {
  const lib = libraryBlock(config);
  if (lib === null) return null;
  const tags = lib.tags;
  if (tags === null || typeof tags !== 'object' || Array.isArray(tags)) return null;
  const t = tags as Record<string, unknown>;
  const colors: ColorFamily[] = [];
  for (const c of lowerStrings(t.colors)) {
    const fam = (COLOR_FAMILIES as readonly string[]).includes(c) ? (c as ColorFamily) : colorFamily(c);
    if (fam !== null && !colors.includes(fam)) colors.push(fam);
  }
  const out: LibraryTags = { occasions: lowerStrings(t.occasions), colors, styles: lowerStrings(t.styles) };
  return out.occasions.length + out.colors.length + out.styles.length === 0 ? null : out;
}

/** Shared-library items are listed unless they say otherwise — only an
 *  explicit `listed: false` hides one from hosts. */
export function isListed(config: unknown): boolean {
  const lib = libraryBlock(config);
  return lib === null || lib.listed !== false;
}

export interface MatchContext {
  eventType?: string | null;
  accentHex?: string | null;
}

/** The score one item earns: occasion 2 + colour 1. */
export function matchScore(config: unknown, ctx: MatchContext): number {
  const tags = libraryTags(config);
  if (tags === null) return 0;
  let score = 0;
  const type = typeof ctx.eventType === 'string' ? ctx.eventType.trim().toLowerCase() : '';
  if (type !== '' && tags.occasions.includes(type)) score += 2;
  const fam = colorFamily(ctx.accentHex);
  if (fam !== null && tags.colors.includes(fam)) score += 1;
  return score;
}

/**
 * Rank items for an event: highest score first, tagged before untagged,
 * otherwise the order they arrived in. Returns a NEW array.
 */
export function rankLibrary<T extends { config?: unknown }>(items: readonly T[], ctx: MatchContext): T[] {
  return items
    .map((item, index) => ({
      item,
      index,
      score: matchScore(item.config, ctx),
      tagged: libraryTags(item.config) !== null,
    }))
    .sort((a, b) =>
      b.score - a.score
      || Number(b.tagged) - Number(a.tagged)
      || a.index - b.index)
    .map((r) => r.item);
}

/** Only the items that actually match something — what the "Recommended"
 *  shelf shows. Empty when nothing is tagged for this event. */
export function recommendedFor<T extends { config?: unknown }>(
  items: readonly T[],
  ctx: MatchContext,
  limit = 6,
): T[] {
  return rankLibrary(items, ctx).filter((i) => matchScore(i.config, ctx) > 0).slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* The quick-AI-frame starting prompt                                  */
/* ------------------------------------------------------------------ */

const FAMILY_WORD: Record<ColorFamily, string> = {
  red: 'red', orange: 'orange', gold: 'gold', yellow: 'yellow', green: 'emerald',
  teal: 'teal', blue: 'navy and blue', purple: 'purple', pink: 'pink',
  neutral: 'silver and grey', dark: 'black', light: 'ivory and cream',
};

const TYPE_STYLE: Record<string, { occasion: string; style: string }> = {
  wedding: { occasion: 'wedding', style: 'elegant floral' },
  gala: { occasion: 'gala', style: 'glam art-deco' },
  birthday: { occasion: 'birthday party', style: 'playful confetti' },
  corporate: { occasion: 'company event', style: 'clean modern geometric' },
  party: { occasion: 'party', style: 'festive sparkle' },
  remote: { occasion: 'celebration', style: 'warm whimsical hearts' },
};

/**
 * A sensible first brief for the quick AI frame, from what the event already
 * knows: its name, type, accent colour and (when the host wrote one) the
 * brief's palette and tone. Always names a colour and a style, so the frame
 * studio's "what is missing" hint starts satisfied. Capped at 400 chars.
 */
export function frameSuggestion(input: {
  eventName: string;
  eventType?: string | null;
  accentHex?: string | null;
  palette?: string | null;
  tone?: string | null;
}): string {
  const type = typeof input.eventType === 'string' ? input.eventType.trim().toLowerCase() : '';
  const meta = TYPE_STYLE[type] ?? { occasion: 'event', style: 'elegant' };
  const palette = typeof input.palette === 'string' ? input.palette.trim() : '';
  const tone = typeof input.tone === 'string' ? input.tone.trim() : '';
  const fam = colorFamily(input.accentHex);
  const colour = palette !== '' ? palette : fam !== null ? FAMILY_WORD[fam] : 'gold';
  const style = tone !== '' ? `${tone}, ${meta.style}` : meta.style;
  const name = input.eventName.trim();
  const named = name !== '' ? ` for “${name}”` : '';
  return `A ${style} ${meta.occasion} frame${named} in ${colour} tones, with the event name lettered along the bottom and the centre left clear for faces.`.slice(0, 400);
}
