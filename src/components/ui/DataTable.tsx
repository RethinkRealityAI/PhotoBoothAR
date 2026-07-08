/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Generic admin table: column defs + rows in, a glass-styled table (loading
 * skeleton / empty state / optional row click) out. Search, sort and paginate
 * are the caller's job (see src/lib/adminFilters.ts) — this component only renders.
 */
import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  className?: string;
}

export default function DataTable<T>({
  columns,
  rows,
  getRowKey,
  loading = false,
  emptyMessage = 'Nothing here yet.',
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  loading?: boolean;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
}) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 glass rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="glass rounded-2xl p-10 text-center">
        <p className="font-sans text-sm text-brand-muted/60">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl overflow-x-auto">
      <table className="w-full text-left border-collapse min-w-[36rem]">
        <thead>
          <tr className="border-b border-white/10">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`font-label uppercase tracking-luxe text-[9px] text-brand-muted/50 px-4 py-3 whitespace-nowrap ${col.className ?? ''}`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={getRowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b border-white/[0.04] last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-white/[0.03] transition-colors' : ''}`}
            >
              {columns.map((col) => (
                <td key={col.key} className={`px-4 py-3 font-sans text-xs text-brand-fg/90 ${col.className ?? ''}`}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
