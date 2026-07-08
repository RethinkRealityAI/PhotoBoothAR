/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Prev/next pager for admin DataTables. Renders nothing for a single page.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function Pagination({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between gap-4 pt-4 mt-1">
      <p className="font-sans text-[11px] text-brand-muted/50">{total} total</p>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/60 hover:text-brand-fg transition-colors disabled:opacity-30 disabled:hover:bg-white/[0.04]"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60 min-w-[4.5rem] text-center">
          Page {page} / {totalPages}
        </p>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/60 hover:text-brand-fg transition-colors disabled:opacity-30 disabled:hover:bg-white/[0.04]"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
