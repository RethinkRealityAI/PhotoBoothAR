/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  curationSummary,
  filterContributions,
  shouldOfferFilter,
  FILTER_MIN_ROWS,
} from './cardCuration';

const rows = (...hidden: boolean[]) => hidden.map((h, i) => ({ hidden: h, id: `r${i}` }));

describe('curationSummary', () => {
  it('counts what a guest will actually see', () => {
    expect(curationSummary(rows(false, false, true))).toEqual({
      total: 3, included: 2, hidden: 1, canIncludeAll: true,
    });
  });

  it('is all-zero for an empty card rather than dividing by nothing', () => {
    expect(curationSummary([])).toEqual({ total: 0, included: 0, hidden: 0, canIncludeAll: false });
  });

  it('does not offer "include all" when nothing is hidden', () => {
    expect(curationSummary(rows(false, false)).canIncludeAll).toBe(false);
  });

  it('handles a fully hidden card — 0 included, still offerable', () => {
    expect(curationSummary(rows(true, true))).toEqual({
      total: 2, included: 0, hidden: 2, canIncludeAll: true,
    });
  });
});

describe('filterContributions', () => {
  const list = [
    { id: 'a', hidden: false },
    { id: 'b', hidden: true },
    { id: 'c', hidden: false },
  ];

  it('all → everything', () => {
    expect(filterContributions(list, 'all').map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('included → only what guests see', () => {
    expect(filterContributions(list, 'included').map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('hidden → only what is excluded', () => {
    expect(filterContributions(list, 'hidden').map((r) => r.id)).toEqual(['b']);
  });

  it('PRESERVES order — the list order is the card running order', () => {
    const ordered = [
      { id: '1', hidden: false },
      { id: '2', hidden: true },
      { id: '3', hidden: false },
      { id: '4', hidden: true },
    ];
    expect(filterContributions(ordered, 'included').map((r) => r.id)).toEqual(['1', '3']);
    expect(filterContributions(ordered, 'hidden').map((r) => r.id)).toEqual(['2', '4']);
  });

  it('never mutates or aliases the input array', () => {
    const src = [{ id: 'a', hidden: false }];
    const out = filterContributions(src, 'all');
    expect(out).not.toBe(src);
    out.pop();
    expect(src).toHaveLength(1);
  });

  it('returns empty rather than throwing when nothing matches', () => {
    expect(filterContributions(rows(false, false), 'hidden')).toEqual([]);
  });
});

describe('shouldOfferFilter', () => {
  it('stays out of the way on a short card', () => {
    expect(shouldOfferFilter(rows(false, false, false))).toBe(false);
  });

  it('appears at the threshold', () => {
    expect(shouldOfferFilter(rows(...Array(FILTER_MIN_ROWS).fill(false)))).toBe(true);
  });
});
