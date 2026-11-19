import { describe, expect, it } from 'vitest';
import {
  applySaved, canPlace, checkNewName, checkRename, moveOptions, nextSortOrder, placementFor, planMove,
  siblingsUnder, topLevelEnd,
} from './categoryTree';
import { buildCategoryTree, type LibraryCategory } from './libraryTaxonomy';

const cat = (id: string, name: string, parentId: string | null, sortOrder: number): LibraryCategory => ({
  id, slug: id, name, description: '', parentId, sortOrder,
});

// Holidays { Christmas, Easter } · Glam { Crowns } · Fashion (no children)
const BASE: LibraryCategory[] = [
  cat('holidays', 'Holidays', null, 10),
  cat('glam', 'Glam', null, 20),
  cat('fashion', 'Fashion', null, 30),
  cat('christmas', 'Christmas', 'holidays', 10),
  cat('easter', 'Easter', 'holidays', 20),
  cat('crowns', 'Crowns', 'glam', 10),
];

const shape = (cs: LibraryCategory[]) =>
  buildCategoryTree(cs).map((n) => [n.category.id, n.children.map((c) => c.id)] as const);

describe('canPlace', () => {
  it('always allows top level', () => {
    expect(canPlace(BASE, 'holidays', null)).toEqual({ ok: true });
    expect(canPlace(BASE, 'christmas', null)).toEqual({ ok: true });
  });
  it('allows a childless category under a top-level one', () => {
    expect(canPlace(BASE, 'fashion', 'glam')).toEqual({ ok: true });
    expect(canPlace(BASE, 'christmas', 'glam')).toEqual({ ok: true });
  });
  it('refuses a parent that is itself a subcategory (three levels)', () => {
    const r = canPlace(BASE, 'fashion', 'christmas');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/already a subcategory/);
  });
  it('refuses moving a category that has children inside another', () => {
    const r = canPlace(BASE, 'holidays', 'glam');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/has 2 subcategories/);
  });
  it('refuses itself and unknown ids', () => {
    expect(canPlace(BASE, 'fashion', 'fashion').ok).toBe(false);
    expect(canPlace(BASE, 'nope', null).ok).toBe(false);
    expect(canPlace(BASE, 'fashion', 'nope').ok).toBe(false);
  });
});

describe('planMove', () => {
  it('reorders siblings and renumbers them x10, moved row first', () => {
    const p = planMove(BASE, 'fashion', { parentId: null, index: 0 });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(shape(p.next).map(([id]) => id)).toEqual(['fashion', 'holidays', 'glam']);
    expect(p.saves[0]).toEqual({ id: 'fashion', name: 'Fashion', sortOrder: 10 });
    expect(p.saves.map((s) => [s.id, s.sortOrder])).toEqual([['fashion', 10], ['holidays', 20], ['glam', 30]]);
    expect(p.saves.every((s) => !('parentId' in s))).toBe(true);
  });

  it('moves a subcategory under another parent, sending parentId only for it', () => {
    const p = planMove(BASE, 'easter', { parentId: 'glam', index: 0 });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(shape(p.next)).toEqual([['holidays', ['christmas']], ['glam', ['easter', 'crowns']], ['fashion', []]]);
    expect(p.saves).toEqual([
      { id: 'easter', name: 'Easter', sortOrder: 10, parentId: 'glam' },
      { id: 'crowns', name: 'Crowns', sortOrder: 20 },
    ]);
  });

  it('promotes a subcategory to top level', () => {
    const p = planMove(BASE, 'christmas', topLevelEnd(BASE, 'christmas'));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(shape(p.next)).toEqual([['holidays', ['easter']], ['glam', ['crowns']], ['fashion', []], ['christmas', []]]);
    expect(p.saves).toEqual([{ id: 'christmas', name: 'Christmas', sortOrder: 40, parentId: null }]);
  });

  it('demotes a childless top-level category into another', () => {
    const p = planMove(BASE, 'fashion', placementFor(BASE, 'fashion', 'glam', 'into')!);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(shape(p.next)).toEqual([['holidays', ['christmas', 'easter']], ['glam', ['crowns', 'fashion']]]);
    expect(p.saves).toEqual([{ id: 'fashion', name: 'Fashion', sortOrder: 20, parentId: 'glam' }]);
  });

  it('refuses a three-level drop and says why, with no saves', () => {
    const p = planMove(BASE, 'holidays', { parentId: 'glam', index: 0 });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toMatch(/Move them out first/);
    const q = planMove(BASE, 'fashion', { parentId: 'christmas', index: 0 });
    expect(q.ok).toBe(false);
  });

  it('is a no-op when dropped where it already is, even with odd numbering', () => {
    const odd = BASE.map((c, i) => ({ ...c, sortOrder: i }));
    const p = planMove(odd, 'glam', { parentId: null, index: 1 });
    expect(p.ok && p.saves).toEqual([]);
  });

  it('renumbers equal sort orders so they can never stick', () => {
    const tied = [cat('a', 'A', null, 0), cat('b', 'B', null, 0), cat('c', 'C', null, 0)];
    const p = planMove(tied, 'c', { parentId: null, index: 0 });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(siblingsUnder(p.next, null).map((x) => [x.id, x.sortOrder])).toEqual([['c', 10], ['a', 20], ['b', 30]]);
  });

  it('clamps an out-of-range index to the end', () => {
    const p = planMove(BASE, 'holidays', { parentId: null, index: 99 });
    expect(p.ok && shape(p.next).map(([id]) => id)).toEqual(['glam', 'fashion', 'holidays']);
  });

  it('does not mutate its input', () => {
    const copy = JSON.parse(JSON.stringify(BASE));
    planMove(BASE, 'easter', { parentId: 'glam', index: 0 });
    expect(BASE).toEqual(copy);
  });
});

describe('placementFor', () => {
  it('maps before/after/into on a top-level row', () => {
    expect(placementFor(BASE, 'christmas', 'glam', 'before')).toEqual({ parentId: null, index: 1 });
    expect(placementFor(BASE, 'christmas', 'glam', 'after')).toEqual({ parentId: null, index: 2 });
    expect(placementFor(BASE, 'christmas', 'glam', 'into')).toEqual({ parentId: 'glam', index: 1 });
  });
  it('maps a subcategory row to its own parent, excluding the dragged row', () => {
    expect(placementFor(BASE, 'christmas', 'easter', 'after')).toEqual({ parentId: 'holidays', index: 1 });
    expect(placementFor(BASE, 'fashion', 'christmas', 'before')).toEqual({ parentId: 'holidays', index: 0 });
    expect(placementFor(BASE, 'fashion', 'crowns', 'into')).toEqual({ parentId: 'glam', index: 1 });
  });
  it('returns null over itself', () => {
    expect(placementFor(BASE, 'glam', 'glam', 'into')).toBeNull();
  });
});

describe('moveOptions', () => {
  it('offers up/down/top-level/into for a subcategory', () => {
    const o = moveOptions(BASE, 'easter');
    expect(o.map((x) => x.key)).toEqual(['up', 'top', 'into:glam', 'into:fashion']);
    expect(o.every((x) => x.disabledReason === undefined)).toBe(true);
  });
  it('lists refused moves with the reason instead of hiding them', () => {
    const o = moveOptions(BASE, 'holidays');
    expect(o.map((x) => x.key)).toEqual(['down', 'into:glam', 'into:fashion']);
    expect(o.find((x) => x.key === 'into:glam')?.disabledReason).toMatch(/has 2 subcategories/);
  });
  it('every enabled option yields a valid plan', () => {
    for (const c of BASE) {
      for (const opt of moveOptions(BASE, c.id)) {
        if (opt.disabledReason !== undefined) continue;
        expect(planMove(BASE, c.id, opt.place).ok).toBe(true);
      }
    }
  });
});

describe('names and numbering', () => {
  it('checkNewName rejects empty, symbol-only, too long and duplicate slugs', () => {
    expect(checkNewName(BASE, '  ').ok).toBe(false);
    expect(checkNewName(BASE, '!!!').ok).toBe(false);
    expect(checkNewName(BASE, 'x'.repeat(49)).ok).toBe(false);
    const dup = checkNewName(BASE, ' Christmas! ');
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.reason).toMatch(/“Christmas” already has the web name “christmas”/);
    expect(checkNewName(BASE, '  Diwali   Lights ')).toEqual({ ok: true, name: 'Diwali Lights', slug: 'diwali-lights' });
  });
  it('checkRename only checks the name', () => {
    expect(checkRename('Christmas')).toEqual({ ok: true, name: 'Christmas' });
    expect(checkRename('').ok).toBe(false);
  });
  it('nextSortOrder goes after the last sibling', () => {
    expect(nextSortOrder(BASE, 'holidays')).toBe(30);
    expect(nextSortOrder(BASE, 'fashion')).toBe(10);
    expect(nextSortOrder(BASE, null)).toBe(40);
  });
  it('applySaved keeps the snapshot and lays accepted saves on top', () => {
    const saved = [{ ...BASE[2], sortOrder: 5 }];
    const out = applySaved(BASE, saved);
    expect(out[2].sortOrder).toBe(5);
    expect(out[0]).toBe(BASE[0]);
  });
});
