import { describe, expect, it } from 'vitest';
import {
  BULK_OPTIMIZE_MAX,
  bulkApplyPlan,
  bulkApplySummary,
  bulkOptRows,
  bulkRowFacts,
  canReplaceFile,
  glbFileName,
  replaceConsequence,
  replaceOutcomeText,
  replaceTargetFor,
  withRunResult,
  type BulkOptRow,
} from './libraryReplace';
import { IMPORT_MAX_BYTES } from './libraryImport';

const MB = 1024 * 1024;
const item = (over: Partial<{ id: string; name: string; kind: string; state: 'listed' | 'retired' | 'withdrawn' | null; version: number | null; linkCount: number; modelUrl: string | null; source: string }> = {}) => ({
  id: 'a', name: 'Gold Crown', kind: '3d_attachment', state: 'listed' as const, version: 1, linkCount: 0, modelUrl: 'https://x/m.glb', source: 'library', ...over,
});
const stats = (before: number, after: number, triBefore = 100_000, triAfter = 100_000) => ({
  bytesBefore: before, bytesAfter: after, trianglesBefore: triBefore, trianglesAfter: triAfter,
  textureMaxEdgeBefore: 2048, textureMaxEdgeAfter: 2048, seconds: 1,
});

describe('which items can have their file replaced', () => {
  it('a published lone 3D prop in the library only', () => {
    expect(canReplaceFile(item())).toBe(true);
    expect(canReplaceFile(item({ state: 'retired' }))).toBe(true);
    expect(canReplaceFile(item({ state: 'withdrawn' }))).toBe(false);
    expect(canReplaceFile(item({ kind: 'composite' }))).toBe(false);
    expect(canReplaceFile(item({ source: 'event' }))).toBe(false);
    expect(canReplaceFile(item({ source: 'builtin', state: null }))).toBe(false);
    expect(canReplaceFile(item({ modelUrl: null }))).toBe(false);
  });

  it('picks the version hosts see, then the newest, ignoring case and punctuation', () => {
    const rows = [
      item({ id: 'v1', version: 1, state: 'retired' }),
      item({ id: 'v3', version: 3, state: 'retired' }),
      item({ id: 'v2', version: 2, state: 'listed' }),
      item({ id: 'scene', kind: 'composite' }),
      item({ id: 'gone', state: 'withdrawn', version: 9 }),
    ];
    expect(replaceTargetFor('gold-crown!', rows)?.id).toBe('v2');
    expect(replaceTargetFor('Gold Crown', rows.filter((r) => r.id !== 'v2'))?.id).toBe('v3');
    expect(replaceTargetFor('Silver Crown', rows)).toBeNull();
    expect(replaceTargetFor('  ', rows)).toBeNull();
    expect(replaceTargetFor('Gold Crown', [item({ kind: 'composite' })])).toBeNull();
  });
});

describe('the confirm says which path will happen', () => {
  it('in place when no event uses it', () => {
    const c = replaceConsequence({ name: 'Gold Crown', linkCount: 0, state: 'listed' }, false);
    expect(c.path).toBe('in_place');
    expect(c.lines[0]).toMatch(/No event uses “Gold Crown” yet, so its file is swapped in place/);
  });
  it('a new version when events use it, worded for listed vs hidden and for capped counts', () => {
    const one = replaceConsequence({ name: 'Gold Crown', linkCount: 1, state: 'listed' }, false);
    expect(one.path).toBe('new_version');
    expect(one.lines[0]).toBe('1 event uses “Gold Crown”, so they keep the file they have now.');
    expect(one.lines[2]).toMatch(/current one is hidden from hosts/);
    const many = replaceConsequence({ name: 'X', linkCount: 1000, state: 'retired' }, true);
    expect(many.lines[0]).toMatch(/^1000\+ events use/);
    expect(many.lines[2]).toMatch(/stays hidden from hosts/);
  });
});

describe('the toast reports what really happened', () => {
  const clean = { path: 'in_place' as const, version: 1, retireFailed: [], accessCopyFailed: false, draftRemoved: true };
  it('a clean swap is a success', () => {
    expect(replaceOutcomeText('Gold Crown', clean, '38 MB → 4 MB')).toEqual({ text: 'Replaced the file of “Gold Crown” (38 MB → 4 MB). Same item, new file.', tone: 'success' });
    expect(replaceOutcomeText('Gold Crown', { ...clean, path: 'new_version', version: 4 }).text).toMatch(/now has version 4\. Events using the old version keep it\./);
  });
  it('every partial failure is named and turns the toast into an error', () => {
    const r = replaceOutcomeText('G', { ...clean, path: 'new_version', retireFailed: ['x'], accessCopyFailed: true, draftRemoved: false });
    expect(r.tone).toBe('error');
    expect(r.text).toMatch(/could not be hidden/);
    expect(r.text).toMatch(/customer list did not copy/);
    expect(r.text).toMatch(/still in Bulk import/);
  });
  it('names optimizer output sensibly', () => {
    expect(glbFileName('Gold Crown (v2)')).toBe('gold-crown-v2.glb');
    expect(glbFileName('✨')).toBe('model.glb');
  });
});

describe('bulk optimize rows', () => {
  const rows = bulkOptRows([
    item({ id: 'a', linkCount: 0 }),
    item({ id: 'b', linkCount: 3 }),
    item({ id: 'scene', kind: 'composite' }),
    item({ id: 'off', state: 'withdrawn' }),
  ]);

  it('takes at most BULK_OPTIMIZE_MAX, the first ones selected', () => {
    const many = bulkOptRows(Array.from({ length: BULK_OPTIMIZE_MAX + 5 }, (_, n) => item({ id: `m${n}` })));
    expect(many).toHaveLength(BULK_OPTIMIZE_MAX);
    expect(many[0].id).toBe('m0');
  });

  it('keeps only replaceable items, all waiting and unticked', () => {
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(rows.every((r) => r.status === 'waiting' && !r.checked && r.stats === null)).toBe(true);
  });

  it('ticks a row only when the saving is worth keeping', () => {
    expect(withRunResult(rows[0], { ok: true, stats: stats(40 * MB, 4 * MB) }).checked).toBe(true);
    expect(withRunResult(rows[0], { ok: true, stats: stats(10 * MB, 9.8 * MB) }).checked).toBe(false);
    expect(withRunResult(rows[0], { ok: true, stats: stats(120 * MB, IMPORT_MAX_BYTES + 1) }).checked).toBe(false);
    const failed = withRunResult({ ...rows[0], checked: true }, { ok: false, reason: 'nope' });
    expect(failed).toMatchObject({ status: 'failed', checked: false, reason: 'nope', stats: null });
  });

  it('phrases the facts', () => {
    const done = withRunResult(rows[0], { ok: true, stats: stats(40 * MB, 4 * MB, 200_000, 150_000) });
    expect(bulkRowFacts(done)).toEqual({ size: '40 MB → 4.0 MB (−90%)', triangles: '200k triangles → 150k triangles', saved: '90%', worth: true });
    expect(bulkRowFacts(rows[0])).toBeNull();
    expect(bulkRowFacts(withRunResult(rows[0], { ok: true, stats: stats(4 * MB, 2 * MB) }))?.triangles).toBe('100k triangles');
  });

  it('plans Apply by path, skipping unticked, failed and already-applied rows', () => {
    const r: BulkOptRow[] = [
      withRunResult(rows[0], { ok: true, stats: stats(40 * MB, 4 * MB) }),
      withRunResult(rows[1], { ok: true, stats: stats(40 * MB, 4 * MB) }),
      { ...withRunResult(rows[0], { ok: true, stats: stats(40 * MB, 4 * MB) }), id: 'done', applied: 'in_place' },
      { ...withRunResult(rows[0], { ok: false, reason: 'x' }), id: 'bad', checked: true },
    ];
    expect(bulkApplyPlan(r)).toEqual({ ids: ['a', 'b'], inPlace: 1, newVersion: 1 });
  });

  it('summarises the real outcome, partial failures included', () => {
    const base = withRunResult(rows[0], { ok: true, stats: stats(40 * MB, 4 * MB) });
    const after: BulkOptRow[] = [
      { ...base, id: 'a', applied: 'in_place' },
      { ...base, id: 'b', name: 'Hat', applied: null, applyError: 'The upload failed.' },
      { ...base, id: 'c', applied: 'new_version', applyError: 'still in Bulk import' },
      { ...base, id: 'z' },
    ];
    const s = bulkApplySummary(after, ['a', 'b', 'c']);
    expect(s.tone).toBe('error');
    expect(s.text).toBe('Optimized 2 of 3. 1 need a follow-up (see each row). 1 failed: Hat — The upload failed..');
    expect(bulkApplySummary([{ ...base, applied: 'in_place' }], ['a'])).toEqual({ text: 'Optimized 1 of 1.', tone: 'success' });
  });
});
