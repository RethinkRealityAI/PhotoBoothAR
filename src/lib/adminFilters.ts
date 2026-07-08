/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Client-side search/sort/paginate for admin-suite tables. Pure — unit tested.
 * The admin-api list actions return the full row set (early-stage data volume),
 * so table interaction happens here instead of round-tripping to the server.
 */

/** Case-insensitive substring match against the given string-valued keys. */
export function searchRows<T>(rows: T[], query: string, keys: (keyof T)[]): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) =>
    keys.some((key) => String(row[key] ?? '').toLowerCase().includes(q)),
  );
}

export type SortDirection = 'asc' | 'desc';

/** Stable sort by a single key. null/undefined sort last regardless of direction. */
export function sortRows<T>(rows: T[], key: keyof T, direction: SortDirection = 'asc'): T[] {
  const withIndex = rows.map((row, index) => ({ row, index }));
  withIndex.sort((a, b) => {
    const av = a.row[key];
    const bv = b.row[key];
    if (av == null && bv == null) return a.index - b.index;
    if (av == null) return 1;
    if (bv == null) return -1;
    let cmp = 0;
    if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv));
    if (cmp === 0) cmp = a.index - b.index;
    return direction === 'asc' ? cmp : -cmp;
  });
  return withIndex.map((w) => w.row);
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** 1-indexed pagination. Out-of-range pages clamp to the nearest valid page. */
export function paginateRows<T>(rows: T[], page: number, pageSize: number): Page<T> {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, Math.floor(page)), totalPages);
  const start = (safePage - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), total, page: safePage, pageSize, totalPages };
}
