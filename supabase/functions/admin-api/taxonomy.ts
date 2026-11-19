/**
 * admin-api/taxonomy.ts — HAND MIRROR of the normalisers in
 * src/lib/libraryTaxonomy.ts (categories + keywords, migration 045).
 * Runtime-free on purpose (no Deno globals, no jsr:/npm: imports) so
 * src/lib/libraryTaxonomy.test.ts can import THIS file under vitest and run the
 * same fixtures against both copies. Change one, change both.
 *
 * DEPLOY NOTE: admin-api deploys as FIVE files (index.ts, library.ts,
 * libraryImport.ts, taxonomy.ts, deno.json). A deploy missing a sibling is an
 * import error at boot, i.e. EVERY admin-api request 500s.
 */

export const KEYWORD_MAX_LEN = 32;
export const KEYWORDS_PER_ITEM_MAX = 24;
export const CATEGORY_NAME_MAX = 48;
export const CATEGORY_DESC_MAX = 280;
export const CATEGORY_SLUG_MAX = 48;

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

export function editKeywords(current: readonly string[], add: readonly string[], remove: readonly string[]): string[] {
  const out = current.filter((k) => !remove.includes(k));
  for (const k of add) if (!out.includes(k) && !remove.includes(k)) out.push(k);
  return out.slice(0, KEYWORDS_PER_ITEM_MAX);
}

export function slugifyCategory(name: string): string {
  const s = normalizeKeyword(name.slice(0, CATEGORY_SLUG_MAX * 2)) ?? '';
  return s.slice(0, CATEGORY_SLUG_MAX).replace(/-+$/, '');
}

export function normalizeCategoryName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name === '' || name.length > CATEGORY_NAME_MAX) return null;
  return name;
}
