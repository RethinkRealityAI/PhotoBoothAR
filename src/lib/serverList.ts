/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure half of a server-searched, server-paged admin list.
 *
 * The admin screens used to fetch a whole table and search it in the browser, so
 * "search" and "next page" were free and the initial payload was unbounded. Now
 * that the server does both, the screen has real state to get right: a debounced
 * term, appended pages, and — the part that is easy to fumble — a response
 * arriving for a term the operator has already changed.
 *
 * This module holds the decisions, so they can be tested without a DOM: whether
 * a response is still wanted, and how a page merges into what is on screen.
 */

export interface ListQuery {
  search?: string;
  limit?: number;
  offset?: number;
}

/** Milliseconds of quiet before a typed term is sent. Long enough that typing
 *  "wedding" is one request rather than seven. */
export const SEARCH_DEBOUNCE_MS = 300;

export interface ListState<T> {
  rows: T[];
  hasMore: boolean;
  /** The search term these rows answer — used to discard stale responses. */
  term: string;
}

export function emptyList<T>(term = ''): ListState<T> {
  return { rows: [], hasMore: false, term };
}

/**
 * Fold a fetched page into the current state.
 *
 * `append` is what distinguishes "load more" from a fresh search. A response for
 * a term that no longer matches is DISCARDED rather than merged: without this,
 * typing "ac" then "acme" and having the slower "ac" response land last would
 * leave the operator looking at results for a query they can no longer see, with
 * no indication anything was wrong.
 */
export function mergePage<T>(
  current: ListState<T>,
  incoming: { rows: T[]; hasMore: boolean; term: string },
  append: boolean,
): ListState<T> {
  if (incoming.term !== current.term) return current;
  return {
    term: current.term,
    hasMore: incoming.hasMore,
    rows: append ? [...current.rows, ...incoming.rows] : incoming.rows,
  };
}

/** The query for the next page of `state`, given the page size. */
export function nextPageQuery<T>(state: ListState<T>, pageSize: number): ListQuery {
  return { search: state.term || undefined, limit: pageSize, offset: state.rows.length };
}

/** The query for a fresh first page. */
export function firstPageQuery(term: string, pageSize: number): ListQuery {
  return { search: term.trim() || undefined, limit: pageSize, offset: 0 };
}

/**
 * What to tell the operator underneath the table.
 *
 * The audit's recurring finding was screens that implied completeness they did
 * not have. A paged list is exactly that trap: twenty of an unknown number of
 * rows looks identical to all twenty. So when more exists, say so.
 */
export function listFootnote(shown: number, hasMore: boolean, noun: string): string {
  if (shown === 0) return '';
  if (!hasMore) return `${shown} ${noun}${shown === 1 ? '' : 's'}.`;
  return `Showing the first ${shown} ${noun}${shown === 1 ? '' : 's'} — there are more. Search to narrow it down.`;
}
