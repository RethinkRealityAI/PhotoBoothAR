/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Footer for a server-paged list: what you are looking at, and how to see more.
 *
 * Replaces the numbered pager the admin screens used to carry, which was honest
 * only because the client held every row and could count them. Now the server
 * decides what to send, so a total page count would be a guess — and the audit's
 * recurring finding was screens implying completeness they did not have. This
 * says how many rows are shown and whether any were left behind.
 */
export default function ListMore({
  hasMore,
  loading,
  onMore,
  note,
}: {
  hasMore: boolean;
  loading: boolean;
  onMore: () => void;
  /** One line of truth about the rows above. Empty renders nothing. */
  note: string;
}) {
  if (!note && !hasMore) return null;
  return (
    <div className="mt-4 flex flex-col items-center gap-3">
      {note && (
        <p className="font-sans text-[11px] text-brand-muted/50 text-center leading-snug" aria-live="polite">
          {note}
        </p>
      )}
      {hasMore && (
        <button
          onClick={onMore}
          disabled={loading}
          className="pressable liquid-glass rounded-full px-5 min-h-11 font-label uppercase tracking-luxe text-[10px] text-brand-fg disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
