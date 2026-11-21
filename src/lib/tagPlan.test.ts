import { describe, expect, it } from 'vitest';
import {
  BULK_IDS_MAX, applyTagCalls, checkTagName, filterTags, planApply, planDelete, planMerge, tagUsage,
  type TagRow,
} from './tagPlan';
import { KEYWORDS_PER_ITEM_MAX, editKeywords } from './libraryTaxonomy';

const ROWS: TagRow[] = [
  { id: 'a', keywords: ['santa', 'red', 'xmas'] },
  { id: 'b', keywords: ['christmas', 'gold'] },
  { id: 'c', keywords: ['xmas'] },
  { id: 'd', keywords: [] },
  { id: 'e' },
];

/** The server's per-row edit, applied call by call. */
function serverApply(rows: TagRow[], calls: { ids: string[]; addKeywords?: string[]; removeKeywords?: string[] }[]) {
  const out = new Map(rows.map((r) => [r.id, [...(r.keywords ?? [])]]));
  for (const c of calls) for (const id of c.ids) {
    out.set(id, editKeywords(out.get(id)!, c.addKeywords ?? [], c.removeKeywords ?? []));
  }
  return Object.fromEntries(out);
}

describe('tagUsage / filterTags', () => {
  it('counts each tag once per item, most-used first then A-Z', () => {
    const u = tagUsage([...ROWS, { id: 'f', keywords: ['xmas', 'xmas'] }]);
    expect(u[0]).toEqual({ tag: 'xmas', count: 3, ids: ['a', 'c', 'f'] });
    expect(u.slice(1).map((x) => x.tag)).toEqual(['christmas', 'gold', 'red', 'santa']);
  });
  it('matches spoken and stored forms', () => {
    const u = tagUsage([{ id: 'x', keywords: ['santa-hat', 'gold'] }]);
    expect(filterTags(u, 'santa h').map((x) => x.tag)).toEqual(['santa-hat']);
    expect(filterTags(u, 'Santa-Hat').map((x) => x.tag)).toEqual(['santa-hat']);
    expect(filterTags(u, '  ').length).toBe(2);
  });
});

describe('planMerge (rename = merge of one)', () => {
  it('renames onto a new tag', () => {
    const p = planMerge(ROWS, ['xmas'], 'Holiday Season');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.calls).toEqual([{ ids: ['a', 'c'], addKeywords: ['holiday-season'], removeKeywords: ['xmas'] }]);
    expect(p.items).toBe(2);
  });
  it('renaming onto an existing tag merges, never duplicating it', () => {
    const rows: TagRow[] = [{ id: 'a', keywords: ['xmas', 'christmas'] }, { id: 'b', keywords: ['xmas'] }];
    const p = planMerge(rows, ['xmas'], 'christmas');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(serverApply(rows, p.calls)).toEqual({ a: ['christmas'], b: ['christmas'] });
  });
  it('merges several sources, keeping a target that is also a source', () => {
    const p = planMerge(ROWS, ['xmas', 'christmas', 'santa'], 'christmas');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(serverApply(ROWS, p.calls)).toEqual({
      a: ['red', 'christmas'], b: ['christmas', 'gold'], c: ['christmas'], d: [], e: [],
    });
    expect(p.items).toBe(2);
  });
  it('refuses a no-op and an invalid target', () => {
    expect(planMerge(ROWS, ['xmas'], 'XMAS').ok).toBe(false);
    expect(planMerge(ROWS, ['xmas'], '!!!').ok).toBe(false);
    expect(planMerge(ROWS, ['xmas'], '').ok).toBe(false);
  });
  it('never pushes an item past the per-item cap', () => {
    const full = Array.from({ length: KEYWORDS_PER_ITEM_MAX }, (_, i) => `k${i}`);
    const rows: TagRow[] = [{ id: 'a', keywords: full }];
    const p = planMerge(rows, ['k3', 'k7'], 'merged');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const after = serverApply(rows, p.calls).a;
    expect(after).toContain('merged');
    expect(after.length).toBe(KEYWORDS_PER_ITEM_MAX - 1);
  });
  it(`splits calls at ${BULK_IDS_MAX} ids`, () => {
    const rows: TagRow[] = Array.from({ length: 450 }, (_, i) => ({ id: `r${i}`, keywords: ['old'] }));
    const p = planMerge(rows, ['old'], 'new');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.calls.map((c) => c.ids.length)).toEqual([200, 200, 50]);
    expect(new Set(p.calls.flatMap((c) => c.ids)).size).toBe(450);
  });
});

describe('planDelete', () => {
  it('removes only from items that have the tag', () => {
    const p = planDelete(ROWS, ['xmas']);
    expect(p.ok && p.calls).toEqual([{ ids: ['a', 'c'], removeKeywords: ['xmas'] }]);
  });
  it('groups by what each item actually holds', () => {
    const p = planDelete(ROWS, ['xmas', 'gold']);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(serverApply(ROWS, p.calls)).toEqual({ a: ['santa', 'red'], b: ['christmas'], c: [], d: [], e: [] });
  });
  it('refuses an empty pick', () => {
    expect(planDelete(ROWS, []).ok).toBe(false);
  });
});

describe('planApply (create a tag on the selection)', () => {
  it('adds to selected items that do not have it', () => {
    const p = planApply(ROWS, ['a', 'c', 'd', 'zz'], 'xmas');
    expect(p.ok && p.calls).toEqual([{ ids: ['d'], addKeywords: ['xmas'] }]);
  });
  it('reports items at the cap instead of letting the server cut the tag', () => {
    const full = Array.from({ length: KEYWORDS_PER_ITEM_MAX }, (_, i) => `k${i}`);
    const p = planApply([{ id: 'a', keywords: full }, { id: 'b', keywords: [] }], ['a', 'b'], 'New Tag');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.full).toEqual(['a']);
    expect(p.calls).toEqual([{ ids: ['b'], addKeywords: ['new-tag'] }]);
  });
  it('checkTagName explains a bad name', () => {
    expect(checkTagName(' Gold Leaf ')).toEqual({ ok: true, tag: 'gold-leaf' });
    expect(checkTagName('   ').ok).toBe(false);
    expect(checkTagName('x'.repeat(40)).ok).toBe(false);
  });
});

describe('applyTagCalls mirrors the server', () => {
  it('matches editKeywords call by call', () => {
    const p = planMerge(ROWS, ['xmas', 'santa'], 'christmas');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const local = Object.fromEntries(applyTagCalls(ROWS, p.calls).map((r) => [r.id, r.keywords ?? []]));
    expect(local).toEqual(serverApply(ROWS, p.calls));
  });
  it('leaves untouched rows as the same object', () => {
    const out = applyTagCalls(ROWS, [{ ids: ['a'], removeKeywords: ['red'] }]);
    expect(out[1]).toBe(ROWS[1]);
  });
});
