import { describe, it, expect } from 'vitest';
import { searchRows, sortRows, paginateRows } from './adminFilters';

interface Row { id: number; name: string; count: number | null }

const ROWS: Row[] = [
  { id: 1, name: 'Hope Gala', count: 3 },
  { id: 2, name: 'Jenna & Jake', count: 1 },
  { id: 3, name: 'Detola & Wuyi', count: null },
  { id: 4, name: 'Acme Corp', count: 2 },
];

describe('searchRows', () => {
  it('matches case-insensitively across the given keys', () => {
    expect(searchRows(ROWS, 'gala', ['name']).map((r) => r.id)).toEqual([1]);
    expect(searchRows(ROWS, 'JENNA', ['name']).map((r) => r.id)).toEqual([2]);
  });
  it('returns all rows for an empty/whitespace query', () => {
    expect(searchRows(ROWS, '', ['name'])).toHaveLength(4);
    expect(searchRows(ROWS, '   ', ['name'])).toHaveLength(4);
  });
  it('returns no rows when nothing matches', () => {
    expect(searchRows(ROWS, 'zzz', ['name'])).toEqual([]);
  });
});

describe('sortRows', () => {
  it('sorts numbers ascending/descending, nulls last either way', () => {
    expect(sortRows(ROWS, 'count', 'asc').map((r) => r.id)).toEqual([2, 4, 1, 3]);
    expect(sortRows(ROWS, 'count', 'desc').map((r) => r.id)).toEqual([1, 4, 2, 3]);
  });
  it('sorts strings alphabetically', () => {
    expect(sortRows(ROWS, 'name', 'asc').map((r) => r.id)).toEqual([4, 3, 1, 2]);
  });
  it('is stable and does not mutate the input array', () => {
    const copy = [...ROWS];
    sortRows(ROWS, 'count', 'asc');
    expect(ROWS).toEqual(copy);
  });
});

describe('paginateRows', () => {
  it('slices the requested page', () => {
    const page = paginateRows(ROWS, 1, 2);
    expect(page.rows.map((r) => r.id)).toEqual([1, 2]);
    expect(page).toMatchObject({ total: 4, page: 1, pageSize: 2, totalPages: 2 });
  });
  it('returns the second page', () => {
    const page = paginateRows(ROWS, 2, 2);
    expect(page.rows.map((r) => r.id)).toEqual([3, 4]);
  });
  it('clamps an out-of-range page to the last valid page', () => {
    const page = paginateRows(ROWS, 99, 2);
    expect(page.page).toBe(2);
    expect(page.rows.map((r) => r.id)).toEqual([3, 4]);
  });
  it('clamps below page 1 to page 1', () => {
    const page = paginateRows(ROWS, 0, 2);
    expect(page.page).toBe(1);
  });
  it('handles an empty array', () => {
    const page = paginateRows([], 1, 10);
    expect(page).toMatchObject({ rows: [], total: 0, page: 1, pageSize: 10, totalPages: 1 });
  });
});
