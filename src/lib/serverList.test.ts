import { describe, it, expect } from 'vitest';
import { emptyList, firstPageQuery, listFootnote, mergePage, nextPageQuery } from './serverList';

interface Row { id: string }
const r = (id: string): Row => ({ id });

describe('mergePage', () => {
  it('replaces the rows on a fresh search', () => {
    const state = { rows: [r('old')], hasMore: true, term: 'acme' };
    const next = mergePage(state, { rows: [r('a'), r('b')], hasMore: false, term: 'acme' }, false);
    expect(next.rows.map((x) => x.id)).toEqual(['a', 'b']);
    expect(next.hasMore).toBe(false);
  });

  it('appends on load-more', () => {
    const state = { rows: [r('a')], hasMore: true, term: '' };
    const next = mergePage(state, { rows: [r('b')], hasMore: true, term: '' }, true);
    expect(next.rows.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('DISCARDS a response for a term the operator has moved on from', () => {
    // Type "ac", then "acme"; the slower "ac" response lands last. Merging it
    // would show results for a query no longer on screen, silently.
    const state = { rows: [r('acme-1')], hasMore: false, term: 'acme' };
    const stale = { rows: [r('ac-1'), r('ac-2')], hasMore: true, term: 'ac' };
    expect(mergePage(state, stale, false)).toBe(state);
    expect(mergePage(state, stale, true)).toBe(state);
  });

  it('carries the current term, never the incoming one', () => {
    const state = { rows: [], hasMore: false, term: 'acme' };
    expect(mergePage(state, { rows: [r('a')], hasMore: false, term: 'acme' }, false).term).toBe('acme');
  });

  it('handles an empty page without inventing hasMore', () => {
    const state = { rows: [r('a')], hasMore: true, term: '' };
    const next = mergePage(state, { rows: [], hasMore: false, term: '' }, true);
    expect(next.rows).toHaveLength(1);
    expect(next.hasMore).toBe(false);
  });
});

describe('page queries', () => {
  it('offsets the next page by what is already shown', () => {
    const state = { rows: [r('a'), r('b'), r('c')], hasMore: true, term: 'acme' };
    expect(nextPageQuery(state, 100)).toEqual({ search: 'acme', limit: 100, offset: 3 });
  });

  it('omits an empty search rather than sending an empty string', () => {
    expect(nextPageQuery(emptyList<Row>(), 50)).toEqual({ search: undefined, limit: 50, offset: 0 });
    expect(firstPageQuery('   ', 50)).toEqual({ search: undefined, limit: 50, offset: 0 });
  });

  it('trims the term for a first page', () => {
    expect(firstPageQuery('  acme  ', 25)).toEqual({ search: 'acme', limit: 25, offset: 0 });
  });
});

describe('listFootnote', () => {
  it('says nothing when there is nothing to say', () => {
    expect(listFootnote(0, false, 'customer')).toBe('');
    expect(listFootnote(0, true, 'customer')).toBe('');
  });

  it('states the total when the list is complete', () => {
    expect(listFootnote(3, false, 'customer')).toBe('3 customers.');
    expect(listFootnote(1, false, 'customer')).toBe('1 customer.');
  });

  it('admits when rows were left behind — the whole point of it', () => {
    const note = listFootnote(100, true, 'order');
    expect(note).toMatch(/first 100 orders/);
    expect(note).toMatch(/there are more/i);
  });
});
