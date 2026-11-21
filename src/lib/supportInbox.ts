/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure half of /admin/support's filter bar: what each status chip means,
 * what it asks the server for, and which empty state an empty list is.
 *
 * ── Why "Needs action" is filtered here and not by support-api ──
 * "Needs action" means the team owes the next move: a brand-new ticket, one
 * an operator reopened, or one where the customer just wrote back. A ticket
 * waiting on the CUSTOMER is not ours to act on, so it is excluded.
 * admin_list_tickets takes ONE status (its `'open'` alias for the open set is
 * shadowed by `STATUSES.has('open')`, so it only ever matched the literal
 * `open` status, which hid every `new` ticket from the default view). Until
 * the function accepts a status list, the chip asks for every status and
 * keeps the actionable rows on the client. Load more still pages correctly
 * because the server pages the unfiltered query.
 */
import type { SupportStatus } from './supportModel';

export type InboxStatusFilter = 'needs_action' | SupportStatus | 'all';

export const INBOX_STATUS_FILTERS: ReadonlyArray<{ id: InboxStatusFilter; label: string }> = [
  { id: 'needs_action', label: 'Needs action' },
  { id: 'new', label: 'New' },
  { id: 'waiting_on_us', label: 'On us' },
  { id: 'waiting_on_customer', label: 'On them' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'closed', label: 'Closed' },
  { id: 'all', label: 'All' },
];

const ACTIONABLE: ReadonlySet<SupportStatus> = new Set<SupportStatus>(['new', 'open', 'waiting_on_us']);

/** The team owes the next move. A ticket waiting on the customer does not count. */
export function needsAction(status: SupportStatus): boolean {
  return ACTIONABLE.has(status);
}

/** The `status` argument sent to admin_list_tickets ('' = every status). */
export function serverStatusFor(filter: InboxStatusFilter): string {
  return filter === 'needs_action' || filter === 'all' ? '' : filter;
}

/** Whether a row the server returned belongs in the chip's view. */
export function keepForFilter(filter: InboxStatusFilter, status: SupportStatus): boolean {
  if (filter === 'needs_action') return needsAction(status);
  if (filter === 'all') return true;
  return status === filter;
}

export interface InboxFilters {
  status: InboxStatusFilter;
  category: string;
  unreadOnly: boolean;
  search: string;
}

export const CLEARED_FILTERS: InboxFilters = { status: 'all', category: '', unreadOnly: false, search: '' };

/**
 * True when the SERVER query has no filter, so an empty answer means there are
 * no tickets at all. A client-side chip (needs_action) still counts as
 * unfiltered here, because the server was asked for everything.
 */
export function serverQueryIsUnfiltered(f: InboxFilters): boolean {
  return serverStatusFor(f.status) === '' && f.category === '' && !f.unreadOnly && f.search.trim() === '';
}

/** True when every filter is in its cleared state. */
export function filtersAreCleared(f: InboxFilters): boolean {
  return f.status === 'all' && serverQueryIsUnfiltered(f);
}

/** Human labels for the filters that are narrowing the list, in bar order. */
export function activeFilterLabels(f: InboxFilters, categoryLabel: (id: string) => string): string[] {
  const out: string[] = [];
  if (f.status !== 'all') {
    const def = INBOX_STATUS_FILTERS.find((s) => s.id === f.status);
    out.push(def?.label ?? f.status);
  }
  if (f.unreadOnly) out.push('Unread only');
  if (f.category !== '') out.push(categoryLabel(f.category));
  const term = f.search.trim();
  if (term !== '') out.push(`“${term}”`);
  return out;
}

export type InboxEmptyKind = 'none-ever' | 'filtered' | 'unknown';

/**
 * Which empty state an empty visible list shows.
 *  - The server query was unfiltered and returned nothing: no tickets exist.
 *  - The filters hid everything and we know tickets exist: 'filtered'.
 *  - Filters are on and the probe for "any ticket at all?" has not answered
 *    (or failed): 'unknown'. Say it is filtered, without claiming tickets exist.
 */
export function inboxEmptyKind(input: {
  filters: InboxFilters;
  /** Rows the SERVER returned for the current query, before client filtering. */
  serverRows: number;
  serverHasMore: boolean;
  /** Result of the "does any ticket exist?" probe; null = not known. */
  anyTickets: boolean | null;
}): InboxEmptyKind {
  const { filters, serverRows, serverHasMore, anyTickets } = input;
  if (serverQueryIsUnfiltered(filters)) {
    if (serverRows === 0 && !serverHasMore) return 'none-ever';
    return 'filtered'; // tickets exist, the client-side chip hid them all
  }
  if (anyTickets === false) return 'none-ever';
  if (anyTickets === true) return 'filtered';
  return 'unknown';
}
