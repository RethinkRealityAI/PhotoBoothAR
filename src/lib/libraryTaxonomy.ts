/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The shared library's TAXONOMY rules, pure (no React, no supabase import).
 *
 * Two ways to organise an item (migration 045):
 *  - ONE category from a two-level tree (Holidays > Christmas). Stored as
 *    `experiences.library_category_id`; categories live in
 *    `library_categories` with a stable, never-renamed `slug`.
 *  - Any number of free KEYWORDS (`experiences.library_keywords`), stored
 *    lower-kebab ("santa-hat") so the same word always matches itself.
 * The fixed occasion / colour / style tags (libraryPublish.ts) are separate
 * and unchanged: the host picker's matcher reads them.
 *
 * MIRRORED — supabase/functions/admin-api/taxonomy.ts carries a hand copy of
 * the normalisers the server enforces. libraryTaxonomy.test.ts runs the SAME
 * fixtures through both copies, so a one-sided change goes red.
 */

export const KEYWORD_MAX_LEN = 32;
export const KEYWORDS_PER_ITEM_MAX = 24;
export const CATEGORY_NAME_MAX = 48;
export const CATEGORY_DESC_MAX = 280;
export const CATEGORY_SLUG_MAX = 48;

export interface LibraryCategory {
  id: string;
  slug: string;
  name: string;
  description: string;
  parentId: string | null;
  sortOrder: number;
}

/* ── Keywords ─────────────────────────────────────────────────────────── */

/**
 * One keyword, lower-kebab: "Santa Hat " -> "santa-hat", "Rock'n'Roll" ->
 * "rocknroll", "  " -> null. Letters/digits only between single hyphens;
 * accents are folded ("Noël" -> "noel"). Over KEYWORD_MAX_LEN -> null.
 */
export function normalizeKeyword(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const k = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (k === '' || k.length > KEYWORD_MAX_LEN) return null;
  return k;
}

/**
 * A keyword list: normalised, de-duplicated, first-seen order kept. Entries
 * that normalise to nothing are reported in `invalid` (the server rejects a
 * payload with any); more than KEYWORDS_PER_ITEM_MAX is `tooMany`.
 */
export function normalizeKeywords(raw: unknown): { keywords: string[]; invalid: string[]; tooMany: boolean } {
  const keywords: string[] = [];
  const invalid: string[] = [];
  const list = Array.isArray(raw) ? raw : [];
  for (const item of list) {
    const k = normalizeKeyword(item);
    if (k === null) { invalid.push(String(item)); continue; }
    if (!keywords.includes(k)) keywords.push(k);
  }
  return { keywords, invalid, tooMany: keywords.length > KEYWORDS_PER_ITEM_MAX };
}

/** "santa-hat" -> "santa hat" for display. */
export function keywordLabel(k: string): string {
  return k.replace(/-/g, ' ');
}

/** Free text an operator typed ("gold, santa hat; xmas") -> keyword list. */
export function parseKeywordInput(text: string): string[] {
  return normalizeKeywords(text.split(/[,;\n]+/)).keywords;
}

/** current + add - remove, keeping order; never above the per-item cap. */
export function editKeywords(current: readonly string[], add: readonly string[], remove: readonly string[]): string[] {
  const out = current.filter((k) => !remove.includes(k));
  for (const k of add) if (!out.includes(k) && !remove.includes(k)) out.push(k);
  return out.slice(0, KEYWORDS_PER_ITEM_MAX);
}

/* ── Categories ───────────────────────────────────────────────────────── */

/** Slug for a new category name: "New Year's" -> "new-years". "" for none. */
export function slugifyCategory(name: string): string {
  const s = normalizeKeyword(name.slice(0, CATEGORY_SLUG_MAX * 2)) ?? '';
  return s.slice(0, CATEGORY_SLUG_MAX).replace(/-+$/, '');
}

/** Trimmed, whitespace-collapsed category name, or null when empty / too long. */
export function normalizeCategoryName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name === '' || name.length > CATEGORY_NAME_MAX) return null;
  return name;
}

export interface CategoryNode {
  category: LibraryCategory;
  children: LibraryCategory[];
}

function byOrder(a: LibraryCategory, b: LibraryCategory): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

/**
 * The tree for the sidebar: top-level categories with their children, both
 * by sort order then name. A child whose parent is missing (should never
 * happen — the FK is RESTRICT) is promoted to the top level rather than lost.
 */
export function buildCategoryTree(categories: readonly LibraryCategory[]): CategoryNode[] {
  const ids = new Set(categories.map((c) => c.id));
  const tops = categories.filter((c) => c.parentId === null || !ids.has(c.parentId)).sort(byOrder);
  return tops.map((category) => ({
    category,
    children: categories.filter((c) => c.parentId === category.id).sort(byOrder),
  }));
}

/** The ids a category filter covers: itself plus its subcategories. */
export function categoryScope(id: string, categories: readonly LibraryCategory[]): Set<string> {
  const scope = new Set<string>([id]);
  for (const c of categories) if (c.parentId === id) scope.add(c.id);
  return scope;
}

/** "Holidays › Christmas", "Holidays", or null for an unknown / absent id. */
export function categoryPath(id: string | null, categories: readonly LibraryCategory[]): string | null {
  if (id === null) return null;
  const c = categories.find((x) => x.id === id);
  if (!c) return null;
  const parent = c.parentId === null ? undefined : categories.find((x) => x.id === c.parentId);
  return parent ? `${parent.name} › ${c.name}` : c.name;
}

/* ── Auto-sort: a category from an item's own words ──────────────────── */

/**
 * Words that point at a starter category (migration 045's slugs). Checked in
 * THIS order and the first hit wins, so holidays beat the generic shelves
 * ("Skull Face Paint" is Halloween before it is face paint). A slug Dapo has
 * deleted is simply skipped. Multi-word terms match as whole words in order.
 */
export const CATEGORY_HINTS: ReadonlyArray<readonly [slug: string, terms: readonly string[]]> = [
  ['christmas', ['christmas', 'xmas', 'santa', 'elf', 'elves', 'reindeer', 'rudolph', 'gingerbread', 'snowman', 'snowflake', 'snow queen', 'holly', 'deck the halls', 'noel', 'yule', 'mistletoe', 'candy cane', 'nutcracker']],
  ['halloween', ['halloween', 'skull', 'demon', 'zombie', 'witch', 'pumpkin', 'vampire', 'spooky', 'ghost', 'devil', 'bat wings']],
  ['new-year', ['new year', 'new years', 'nye', 'countdown', 'confetti']],
  ['easter', ['easter', 'bunny ears', 'easter egg', 'chick']],
  ['valentines', ['valentine', 'valentines', 'cupid', 'heart glasses', 'love heart']],
  ['thanksgiving', ['thanksgiving', 'turkey', 'pilgrim']],
  ['weddings', ['wedding', 'bride', 'bridal', 'groom', 'veil', 'bouquet']],
  ['graduations', ['graduation', 'grad', 'mortarboard', 'diploma']],
  ['baby-showers', ['baby shower', 'baby', 'stork', 'pacifier']],
  ['birthdays', ['birthday', 'bday', 'party hat', 'birthday cake', 'balloon']],
  ['face-paint', ['face paint', 'facepaint', 'face painting']],
  ['crowns-tiaras', ['crown', 'tiara', 'royal', 'royalty', 'queen', 'king', 'princess', 'prince', 'halo', 'diadem']],
  ['masks', ['mask', 'masquerade', 'gala mask']],
  ['magic', ['wizard', 'wand', 'magic', 'spell', 'sorcerer', 'potion']],
  ['superheroes', ['hero', 'superhero', 'power', 'visor', 'laser', 'cyber', 'sci fi', 'futuristic', 'gauntlet', 'cyclops', 'robot', 'optic blast']],
  ['creatures', ['unicorn', 'animal', 'cat ears', 'dog', 'dragon', 'butterfly', 'tiger', 'lion', 'creature', 'horns', 'antlers']],
  ['team-colours', ['soccer', 'football', 'basketball', 'baseball', 'sports', 'sporty', 'jersey', 'team', 'gameday', 'game day', 'cycling', 'helmet', 'fan']],
  ['eyewear', ['glasses', 'shades', 'sunglasses', 'goggles', 'spectacles', 'monocle']],
  ['hats-caps', ['hat', 'cap', 'beanie', 'cowboy', 'headband', 'beret', 'fedora', 'bandana']],
  ['conferences', ['conference', 'summit', 'keynote', 'corporate', 'lanyard']],
  ['launches', ['launch', 'product launch', 'brand activation']],
];

/** Collection ids (config.library.collection / bundled props) -> category slug. */
const COLLECTION_TO_SLUG: Record<string, string> = {
  christmas: 'christmas',
  halloween: 'halloween',
  valentines: 'valentines',
};

/** Lower-cased words with single spaces, padded so ` term ` matches whole words. */
function wordText(parts: readonly (string | null | undefined)[]): string {
  const text = parts
    .filter((p): p is string => typeof p === 'string')
    .join(' ')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return ` ${text} `;
}

export interface CategoryHintInput {
  name: string;
  keywords?: readonly string[];
  collection?: string | null;
  /** Extra free text — an AI prompt, a description. Lowest weight: read last. */
  extra?: string | null;
}

export interface CategorySuggestion {
  categoryId: string;
  slug: string;
  /** The word that decided it, shown to the operator ("matched “santa”"). */
  because: string;
}

/**
 * The category an item most plausibly belongs to, or null. A known seasonal
 * collection wins outright; otherwise the item's NAME and keywords are read
 * first and the extra text only if they say nothing.
 */
export function suggestCategory(item: CategoryHintInput, categories: readonly LibraryCategory[]): CategorySuggestion | null {
  const bySlug = new Map(categories.map((c) => [c.slug, c]));
  const coll = item.collection?.trim().toLowerCase();
  if (coll) {
    const slug = COLLECTION_TO_SLUG[coll] ?? coll;
    const c = bySlug.get(slug);
    if (c) return { categoryId: c.id, slug, because: `the ${c.name} collection` };
  }
  const passes = [
    wordText([item.name, ...(item.keywords ?? []).map(keywordLabel)]),
    wordText([item.extra]),
  ];
  for (const text of passes) {
    if (text.trim() === '') continue;
    for (const [slug, terms] of CATEGORY_HINTS) {
      const c = bySlug.get(slug);
      if (!c) continue;
      const hit = terms.find((t) => text.includes(` ${t} `));
      if (hit !== undefined) return { categoryId: c.id, slug, because: `“${hit}”` };
    }
  }
  return null;
}
