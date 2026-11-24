/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Generic admin table: column defs + rows in, a glass-styled table (loading
 * skeleton / empty state / optional row click, keyboard-openable rows, and a
 * stacked-card layout on phones) out. Search, sort and paginate are the
 * caller's job (see src/lib/adminFilters.ts) — this component only renders.
 */
import type { KeyboardEvent, ReactNode } from 'react';
import { Inbox } from 'lucide-react';

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  className?: string;
}

/** Enter / Space on a focused row opens it, as a click would. Keys typed into
 *  a control inside the row (a button, a link) belong to that control. */
function rowKeyHandler(open: () => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  };
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
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 glass rounded-xl motion-safe:animate-pulse" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="glass rounded-2xl px-6 py-12 text-center">
        <Inbox className="mx-auto mb-3 h-6 w-6 text-brand-muted/50" aria-hidden />
        <p className="font-sans text-sm text-brand-muted/80">{emptyMessage}</p>
      </div>
    );
  }

  // On a phone the first column is the card's title, labelled columns become
  // label/value pairs and unlabelled ones (row actions) a footer. A table
  // wider than the screen used to scroll sideways inside its card, hiding the
  // status and the actions behind a swipe nobody knew to make.
  const [head, ...rest] = columns;
  const fields = rest.filter((c) => c.label !== '');
  const actions = rest.filter((c) => c.label === '');
  const focusRing = 'outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/70';

  return (
    <>
      <ul className="sm:hidden flex flex-col gap-2">
        {rows.map((row) => {
          const open = onRowClick ? () => onRowClick(row) : undefined;
          return (
            <li
              key={getRowKey(row)}
              onClick={open}
              onKeyDown={open ? rowKeyHandler(open) : undefined}
              tabIndex={open ? 0 : undefined}
              className={`glass rounded-2xl p-4 font-sans text-xs text-brand-fg/90 ${open ? `cursor-pointer ${focusRing}` : ''}`}
            >
              {head && <div className="text-sm">{head.render(row)}</div>}
              {fields.length > 0 && (
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
                  {fields.map((col) => (
                    <div key={col.key} className="min-w-0">
                      <dt className="text-[10px] text-brand-muted/70">{col.label}</dt>
                      <dd className="mt-0.5 min-w-0 break-words">{col.render(row)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {actions.map((col) => (
                <div key={col.key} className="mt-3 border-t border-white/10 pt-3 [&>div]:justify-start [&>div]:flex-wrap">
                  {col.render(row)}
                </div>
              ))}
            </li>
          );
        })}
      </ul>

      <div className="hidden sm:block glass rounded-2xl overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[36rem]">
          <thead>
            <tr className="border-b border-white/10">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={`font-sans font-medium text-[11px] text-brand-muted/70 px-4 py-3 whitespace-nowrap ${col.className ?? ''}`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const open = onRowClick ? () => onRowClick(row) : undefined;
              return (
                <tr
                  key={getRowKey(row)}
                  onClick={open}
                  onKeyDown={open ? rowKeyHandler(open) : undefined}
                  tabIndex={open ? 0 : undefined}
                  className={`border-b border-white/[0.06] last:border-0 ${open ? `cursor-pointer hover:bg-white/[0.04] transition-colors ${focusRing}` : ''}`}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={`px-4 py-3 font-sans text-xs text-brand-fg/90 ${col.className ?? ''}`}>
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
