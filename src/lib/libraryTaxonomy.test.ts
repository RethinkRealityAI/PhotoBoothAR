import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as client from './libraryTaxonomy';
import * as edge from '../../supabase/functions/admin-api/taxonomy.ts';
import { BUNDLED_PROPS } from './studio/bundledProps';

const ENGINES = [['client', client], ['edge', edge]] as const;

const cat = (id: string, slug: string, name: string, parentId: string | null = null, sortOrder = 0): client.LibraryCategory =>
  ({ id, slug, name, description: '', parentId, sortOrder });

/** The starter tree, read from migration 045 so the hints and the seed cannot drift. */
function seedCategories(): client.LibraryCategory[] {
  const sql = readFileSync(resolve(__dirname, '../../supabase/migrations/045_library_taxonomy.sql'), 'utf8');
  const tops = [...sql.matchAll(/\('([a-z-]+)',\s+'([^']+(?:''[^']*)*)',\s*'[^']*\s[^']*',\s*(\d+)\)/g)];
  const subs = [...sql.matchAll(/\('([a-z-]+)',\s+'([^']+(?:''[^']*)*)',\s*'([a-z-]+)',\s*(\d+)\)/g)];
  const out: client.LibraryCategory[] = tops.map((m) => cat(`id-${m[1]}`, m[1], m[2], null, Number(m[3])));
  for (const m of subs) out.push(cat(`id-${m[1]}`, m[1], m[2].replace(/''/g, "'"), `id-${m[3]}`, Number(m[4])));
  return out;
}

describe('mirror pins', () => {
  it('both copies share the same limits', () => {
    for (const k of ['KEYWORD_MAX_LEN', 'KEYWORDS_PER_ITEM_MAX', 'CATEGORY_NAME_MAX', 'CATEGORY_DESC_MAX', 'CATEGORY_SLUG_MAX'] as const) {
      expect(edge[k], k).toBe(client[k]);
    }
  });

  it('the migration enforces the same slug, name and keyword limits', () => {
    const sql = readFileSync(resolve(__dirname, '../../supabase/migrations/045_library_taxonomy.sql'), 'utf8');
    expect(sql).toContain(`char_length(slug) <= ${client.CATEGORY_SLUG_MAX}`);
    expect(sql).toContain(`between 1 and ${client.CATEGORY_NAME_MAX}`);
    expect(sql).toContain(`char_length(description) <= ${client.CATEGORY_DESC_MAX}`);
    expect(sql).toContain(`cardinality(library_keywords) <= ${client.KEYWORDS_PER_ITEM_MAX}`);
  });
});

describe.each(ENGINES)('%s engine', (_label, T) => {
  it('normalises a keyword to lower-kebab', () => {
    expect(T.normalizeKeyword('Santa Hat ')).toBe('santa-hat');
    expect(T.normalizeKeyword("Rock'n'Roll")).toBe('rocknroll');
    expect(T.normalizeKeyword('Noël')).toBe('noel');
    expect(T.normalizeKeyword('  --gold!!  ')).toBe('gold');
    expect(T.normalizeKeyword('   ')).toBeNull();
    expect(T.normalizeKeyword(42)).toBeNull();
    expect(T.normalizeKeyword('x'.repeat(33))).toBeNull();
    expect(T.normalizeKeyword('x'.repeat(32))).toBe('x'.repeat(32));
  });

  it('de-duplicates a keyword list in first-seen order and reports bad entries', () => {
    expect(T.normalizeKeywords(['Gold', 'gold', 'Santa hat', '!!', 7])).toEqual({
      keywords: ['gold', 'santa-hat'], invalid: ['!!', '7'], tooMany: false,
    });
    expect(T.normalizeKeywords('nope')).toEqual({ keywords: [], invalid: [], tooMany: false });
    expect(T.normalizeKeywords(Array.from({ length: 25 }, (_, i) => `k${i}`)).tooMany).toBe(true);
  });

  it('adds and removes keywords without duplicates, capped', () => {
    expect(T.editKeywords(['a', 'b'], ['c', 'a'], ['b'])).toEqual(['a', 'c']);
    expect(T.editKeywords(['a'], ['b'], ['b'])).toEqual(['a']);
    expect(T.editKeywords(Array.from({ length: 24 }, (_, i) => `k${i}`), ['extra'], [])).toHaveLength(24);
  });

  it('derives a stable slug from a category name', () => {
    expect(T.slugifyCategory("New Year's")).toBe('new-years');
    expect(T.slugifyCategory('Glam & Royalty')).toBe('glam-royalty');
    expect(T.slugifyCategory('!!!')).toBe('');
    expect(T.slugifyCategory('a'.repeat(30) + ' ' + 'b'.repeat(30)).length).toBeLessThanOrEqual(48);
    expect(T.slugifyCategory('a'.repeat(30) + ' ' + 'b'.repeat(30))).not.toMatch(/-$/);
  });

  it('normalises a category name', () => {
    expect(T.normalizeCategoryName('  Hats   &  caps ')).toBe('Hats & caps');
    expect(T.normalizeCategoryName('')).toBeNull();
    expect(T.normalizeCategoryName('x'.repeat(49))).toBeNull();
  });
});

describe('category tree', () => {
  const cats = [
    cat('h', 'holidays', 'Holidays', null, 10),
    cat('x', 'christmas', 'Christmas', 'h', 10),
    cat('n', 'new-year', "New Year's", 'h', 5),
    cat('c', 'celebrations', 'Celebrations', null, 5),
    cat('o', 'orphan', 'Orphan', 'gone', 0),
  ];

  it('nests children under parents, in sort order, and keeps orphans', () => {
    const tree = client.buildCategoryTree(cats);
    expect(tree.map((n) => n.category.slug)).toEqual(['orphan', 'celebrations', 'holidays']);
    expect(tree.find((n) => n.category.id === 'h')?.children.map((c) => c.slug)).toEqual(['new-year', 'christmas']);
  });

  it('scopes a top-level filter to its subcategories', () => {
    expect([...client.categoryScope('h', cats)].sort()).toEqual(['h', 'n', 'x']);
    expect([...client.categoryScope('x', cats)]).toEqual(['x']);
  });

  it('names a category by its path', () => {
    expect(client.categoryPath('x', cats)).toBe('Holidays › Christmas');
    expect(client.categoryPath('h', cats)).toBe('Holidays');
    expect(client.categoryPath(null, cats)).toBeNull();
    expect(client.categoryPath('missing', cats)).toBeNull();
  });

  it('parses typed keyword input', () => {
    expect(client.parseKeywordInput('gold, Santa hat; xmas\nGOLD')).toEqual(['gold', 'santa-hat', 'xmas']);
  });
});

describe('suggestCategory (auto-sort)', () => {
  const seed = seedCategories();
  const slugOf = (name: string, more: Partial<client.CategoryHintInput> = {}) =>
    client.suggestCategory({ name, ...more }, seed)?.slug ?? null;

  it('reads the migration seed: 7 shelves, 21 subcategories', () => {
    expect(seed.filter((c) => c.parentId === null)).toHaveLength(7);
    expect(seed.filter((c) => c.parentId !== null)).toHaveLength(21);
  });

  it('every hint points at a seeded slug', () => {
    const slugs = new Set(seed.map((c) => c.slug));
    for (const [slug] of client.CATEGORY_HINTS) expect(slugs.has(slug), slug).toBe(true);
  });

  it('files the real library and event pieces sensibly', () => {
    expect(slugOf('Santa Claus')).toBe('christmas');
    expect(slugOf('Snow Queen')).toBe('christmas');
    expect(slugOf('Deck the Halls')).toBe('christmas');
    expect(slugOf('Crimson Demon Mask')).toBe('halloween');
    expect(slugOf('Skull Face Paint')).toBe('halloween');
    expect(slugOf('Butterfly Face Paint')).toBe('face-paint');
    expect(slugOf('Gold Gala Mask')).toBe('masks');
    expect(slugOf('Royal Crown')).toBe('crowns-tiaras');
    expect(slugOf('Ten Year Royalty')).toBe('crowns-tiaras');
    expect(slugOf('Hero Visor')).toBe('superheroes');
    expect(slugOf('Wizard Duel')).toBe('magic');
    expect(slugOf('embroidered cowboy hat')).toBe('hats-caps');
    expect(slugOf('A baseball hat in Philadelphia 76ers colours')).toBe('team-colours');
    expect(slugOf('Neon Shades')).toBe('eyewear');
    expect(slugOf('Mohs Bday')).toBe('birthdays');
  });

  it('leaves vague names alone rather than guessing', () => {
    expect(slugOf('Golden Hour')).toBeNull();
    expect(slugOf('Front Row')).toBeNull();
    expect(slugOf('Untitled Experience')).toBeNull();
    // whole words only: "cap" is not inside "captain"
    expect(slugOf('Captain')).toBeNull();
  });

  it('a seasonal collection wins outright, and extra text is read last', () => {
    expect(slugOf('Golden Hour', { collection: 'christmas' })).toBe('christmas');
    expect(slugOf('Royal Crown', { extra: 'a spooky skull' })).toBe('crowns-tiaras');
    expect(slugOf('Untitled', { extra: 'A sleek blue cycling helmet' })).toBe('team-colours');
    expect(client.suggestCategory({ name: 'Santa Hat' }, seed)?.because).toBe('“santa”');
  });

  it('skips a category the admin deleted', () => {
    const withoutXmas = seed.filter((c) => c.slug !== 'christmas');
    expect(client.suggestCategory({ name: 'Santa Hat' }, withoutXmas)?.slug).toBe('hats-caps');
  });

  it('files every bundled prop', () => {
    for (const p of BUNDLED_PROPS) {
      expect(client.suggestCategory({ name: p.name, collection: p.collection ?? null }, seed), p.name).not.toBeNull();
    }
  });
});
