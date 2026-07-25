/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The React half of a server-searched, server-paged admin list.
 *
 * All three list screens (Customers, Events, Payments) need identical
 * behaviour — debounce the term, refetch from zero, append on load-more, keep
 * "the query failed" apart from "there are no rows" — so it lives here once
 * rather than three times. The decisions it makes are in src/lib/serverList.ts
 * and tested there; this is the wiring.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SEARCH_DEBOUNCE_MS,
  emptyList,
  firstPageQuery,
  mergePage,
  nextPageQuery,
  type ListQuery,
  type ListState,
} from './serverList';

/** What a screen's adapter must return: the page, or an error string. */
export interface FetchedPage<T> {
  rows: T[];
  hasMore: boolean;
  error: string | null;
}

export interface ServerList<T> {
  rows: T[];
  hasMore: boolean;
  /** True during the first load of a term — the table shows a skeleton. */
  loading: boolean;
  /** True while a load-more is in flight — only that button shows a spinner. */
  loadingMore: boolean;
  /** Non-null when the LAST load failed: the rows below are not "no results". */
  error: string | null;
  /** The raw input value, updated on every keystroke. */
  query: string;
  setQuery: (s: string) => void;
  loadMore: () => void;
  /** Refetch the first page of the current term (after a mutation). */
  reload: () => void;
  /**
   * Patch the loaded rows in place, for an optimistic update after a successful
   * mutation. Preferred over `reload` for a single-field change: a reload would
   * throw away every page the operator has loaded past the first, and scroll
   * them back to the top of a list they were working through.
   */
  patchRows: (fn: (rows: T[]) => T[]) => void;
}

export function useServerList<T>(
  fetchPage: (q: ListQuery) => Promise<FetchedPage<T>>,
  pageSize: number,
): ServerList<T> {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<ListState<T>>(() => emptyList<T>());
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Held in a ref so a screen passing an inline adapter doesn't refetch on
  // every render — the effect below must depend on the TERM, not the closure.
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  // Live mirror of `state`, so loadMore can compute its offset from the rows
  // actually on screen. Reading it out of a setState updater would depend on
  // that updater running synchronously, which React does not promise.
  const stateRef = useRef(state);
  stateRef.current = state;

  // Debounced first page. The cleanup cancels both the pending timer and the
  // in-flight response, and mergePage independently refuses a page whose term
  // has moved on — belt and braces, because a stale page silently replacing the
  // visible one is the failure nobody notices.
  useEffect(() => {
    const term = query.trim();
    let alive = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      const page = await fetchRef.current(firstPageQuery(term, pageSize));
      if (!alive) return;
      setError(page.error);
      setState((cur) => mergePage({ ...cur, term }, { ...page, term }, false));
      setLoading(false);
    }, SEARCH_DEBOUNCE_MS);
    return () => { alive = false; clearTimeout(timer); };
  }, [query, pageSize, reloadKey]);

  const loadMore = useCallback(async () => {
    if (loadingMore || loading) return;
    const at = stateRef.current;
    if (!at.hasMore) return;
    setLoadingMore(true);
    const page = await fetchRef.current(nextPageQuery(at, pageSize));
    setError(page.error);
    // Tagged with the term the page was REQUESTED for: if the operator typed
    // something new while it was in flight, mergePage drops it.
    setState((cur) => mergePage(cur, { ...page, term: at.term }, true));
    setLoadingMore(false);
  }, [loading, loadingMore, pageSize]);

  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  const patchRows = useCallback((fn: (rows: T[]) => T[]) => {
    setState((cur) => ({ ...cur, rows: fn(cur.rows) }));
  }, []);

  return {
    rows: state.rows,
    hasMore: state.hasMore,
    loading,
    loadingMore,
    error,
    query,
    setQuery,
    loadMore,
    reload,
    patchRows,
  };
}
