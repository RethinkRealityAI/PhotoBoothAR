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

/** The publish vocabulary (libraryPublish LIBRARY_COLORS) names three colours
 *  this module calls by another family name — without the alias a 'black'
 *  tag silently matched nothing, even on a black-themed event. */
const PUBLISH_COLOR_ALIAS: Record<string, ColorFamily> = { black: 'dark', white: 'light', silver: 'neutral' };

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
    const fam = (COLOR_FAMILIES as readonly string[]).includes(c)
      ? (c as ColorFamily)
      : PUBLISH_COLOR_ALIAS[c] ?? colorFamily(c);
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
/* Collections (seasonal shelves)                                      */
/* ------------------------------------------------------------------ */

/**
 * Seasonal collections a library item can belong to
 * (`config.library.collection`). An item's collection is surfaced FIRST, on
 * its own shelf, when the event looks like that season: its name / brief /
 * occasion text names one of the keywords, or its date falls in one of the
 * months. A collection that is not in this table still works — it just never
 * gets a seasonal boost and ranks with everything else. Add a season here.
 */
export const SEASONAL_COLLECTIONS: Record<string, { label: string; keywords: readonly string[]; months: readonly number[] }> = {
  christmas: {
    label: 'Christmas',
    keywords: ['christmas', 'xmas', 'x-mas', 'holiday', 'holidays', 'festive', 'santa', 'noel', 'yule', 'yuletide'],
    months: [12],
  },
  halloween: { label: 'Halloween', keywords: ['halloween', 'spooky', 'trick or treat'], months: [10] },
  valentines: { label: 'Valentine’s', keywords: ['valentine', 'valentines', 'valentine’s', 'galentine', 'galentines'], months: [2] },
};

/** An item's collection id (lower-cased), or null. */
export function libraryCollection(config: unknown): string | null {
  const lib = libraryBlock(config);
  const c = lib?.collection;
  if (typeof c !== 'string') return null;
  const id = c.trim().toLowerCase();
  return id === '' ? null : id;
}

/** The heading for a collection: the table's label, else the id in title case. */
export function collectionLabel(id: string): string {
  const known = SEASONAL_COLLECTIONS[id];
  if (known) return known.label;
  return id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/**
 * Calendar month (1-12) of an event date, or null.
 * A bare `YYYY-MM-DD` is read straight from the string (new Date() would
 * treat it as UTC midnight and shift it a day west of Greenwich). A full
 * timestamp is read in the viewer's LOCAL zone — the create flow stores the
 * host's local midnight, so 2026-12-01 00:00 local (= 2026-11-30T23:00Z in
 * Paris) must still be December for them.
 * Traces: '2026-12-31' -> 12 · '2026-01-31' -> 1 · '2026-12-15T12:00:00Z' -> 12
 * (any zone within ±11h) · 'nope' -> null.
 */
export function eventMonth(date: string | null | undefined): number | null {
  if (typeof date !== 'string') return null;
  const s = date.trim();
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (bare !== null) {
    const m = Number(bare[2]);
    return m >= 1 && m <= 12 ? m : null;
  }
  if (s === '') return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.getMonth() + 1; // getMonth is 0-indexed
}

export interface ShelfContext extends MatchContext {
  /** Free text that describes the event: name, brief occasion/tone/notes. */
  text?: string | null;
  /** events.starts_at (ISO) or a bare YYYY-MM-DD. */
  date?: string | null;
}

/** Seasonal collections this event fits, in table order. */
export function activeCollections(ctx: ShelfContext): string[] {
  const text = typeof ctx.text === 'string' ? ctx.text.toLowerCase() : '';
  const month = eventMonth(ctx.date);
  const out: string[] = [];
  for (const [id, season] of Object.entries(SEASONAL_COLLECTIONS)) {
    const byWord = text !== '' && season.keywords.some((k) => {
      const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(text);
    });
    const byMonth = month !== null && season.months.includes(month);
    if (byWord || byMonth) out.push(id);
  }
  return out;
}

export interface LibraryShelf<T> {
  /** Collection id for a seasonal shelf; null for everything else. */
  id: string | null;
  /** Heading for a seasonal shelf; null for everything else. */
  label: string | null;
  items: T[];
}

/**
 * The shared library laid out for one event: a shelf per seasonal collection
 * this event fits (first, headed "Christmas" …), then one unheaded shelf with
 * everything else. Within each shelf the order is rankLibrary's (occasion,
 * colour, then incoming). Unlisted items are dropped — except ids in
 * `keepIds` (the event already uses them: a retired look an event linked
 * stays in its booth, so the host must still see it to switch it off). Empty
 * shelves are omitted, so no items -> []. Never mutates its input.
 */
export function libraryShelves<T extends { id?: string; config?: unknown }>(
  items: readonly T[],
  ctx: ShelfContext,
  keepIds?: ReadonlySet<string>,
): LibraryShelf<T>[] {
  const ranked = rankLibrary(
    items.filter((i) => isListed(i.config) || (typeof i.id === 'string' && keepIds?.has(i.id) === true)),
    ctx,
  );
  const active = activeCollections(ctx);
  const shelves: LibraryShelf<T>[] = [];
  for (const id of active) {
    const inShelf = ranked.filter((i) => libraryCollection(i.config) === id);
    if (inShelf.length > 0) shelves.push({ id, label: collectionLabel(id), items: inShelf });
  }
  const rest = ranked.filter((i) => {
    const c = libraryCollection(i.config);
    return c === null || !active.includes(c);
  });
  if (rest.length > 0) shelves.push({ id: null, label: null, items: rest });
  return shelves;
}

/**
 * The first `limit` items across shelves, in order, keeping shelf headings;
 * `hidden` is how many were cut. Traces (limit 6): 0 items -> [] hidden 0 ·
 * shelves [4,3] -> [4,2] hidden 1 · [7] -> [6] hidden 1 · [2,1] -> [2,1] hidden 0.
 */
export function capShelves<T>(shelves: readonly LibraryShelf<T>[], limit: number): { shelves: LibraryShelf<T>[]; hidden: number } {
  let left = Math.max(0, Math.floor(limit));
  let hidden = 0;
  const out: LibraryShelf<T>[] = [];
  for (const s of shelves) {
    const take = s.items.slice(0, left);
    hidden += s.items.length - take.length;
    left -= take.length;
    if (take.length > 0) out.push({ ...s, items: take });
  }
  return { shelves: out, hidden };
}

/* ------------------------------------------------------------------ */
/* Thumbnails + plain-words kinds                                      */
/* ------------------------------------------------------------------ */

/**
 * Can this string be put in an <img src> as a library thumbnail? http(s) and
 * data: URLs (published rows carry storage URLs or inline SVG), and
 * SAME-ORIGIN absolute paths like `/starters/santa.webp` (shipped library
 * rows point at files under public/). Rejected: protocol-relative `//host`
 * and `/\host` (both leave the origin), relative paths, and every other
 * scheme (`javascript:` …).
 */
export function isThumbnailSrc(u: unknown): u is string {
  if (typeof u !== 'string') return false;
  if (u.startsWith('http') || u.startsWith('data:')) return true;
  return /^\/(?![/\\])\S/.test(u);
}

/**
 * Plain words for what a library row is (the owner's vocabulary: Frame,
 * Filter, 3D prop — never "shader" / "GLB" / "composite"). A combined row
 * says what is inside it.
 */
export function libraryKindLabel(row: { kind: string; asset_url?: string | null; config?: unknown }): string {
  switch (row.kind) {
    case 'border': return 'Frame';
    case '2d_filter': return 'Sticker';
    case 'shader': return 'Filter';
    case '3d_attachment': return '3D prop';
    case 'composite': {
      const cfg = row.config !== null && typeof row.config === 'object' ? (row.config as Record<string, unknown>) : {};
      const layers = Array.isArray(cfg.layers) ? (cfg.layers as unknown[]) : [];
      const kinds = new Set(layers.map((l) => (l !== null && typeof l === 'object' ? (l as Record<string, unknown>).kind : null)));
      const frame = (typeof row.asset_url === 'string' && row.asset_url !== '') || kinds.has('border') || kinds.has('2d_filter');
      const props = kinds.has('3d_attachment');
      if (frame && props) return 'Frame + 3D props';
      if (props) return '3D props';
      return 'Full look';
    }
    default: return 'Look';
  }
}

/** Which booth tab a linked row joins, for the picker's "N on" counts —
 *  the same split PickerDrawer/boothDeck use (a combined look is a Frame). */
export function boothTabOf(kind: string): 'frames' | 'filters' | 'props' | null {
  if (kind === 'border' || kind === '2d_filter' || kind === 'composite') return 'frames';
  if (kind === 'shader') return 'filters';
  if (kind === '3d_attachment') return 'props';
  return null;
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
