/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * React.lazy for ROUTE components that survives a deploy: a tab opened on the
 * previous build reloads once to pick up the new one instead of showing the
 * error screen (logic + tests: staleChunk.ts loadWithStaleReload).
 *
 * Legacy single-event builds get plain React.lazy — byte-for-byte the
 * behaviour they shipped with.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { loadWithStaleReload, STALE_RELOAD_KEY, type StaleReloadDeps } from './staleChunk';

const IS_LEGACY_BUILD = (((import.meta.env.VITE_EVENT as string | undefined) ?? '')).trim() !== '';

/** sessionStorage can throw (private mode, blocked site data): unreadable = never reloaded. */
export function readLastStaleReload(): number | null {
  try {
    const v = sessionStorage.getItem(STALE_RELOAD_KEY);
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}

export function markStaleReload(at: number): void {
  try {
    sessionStorage.setItem(STALE_RELOAD_KEY, String(at));
  } catch {
    /* private mode: the cooldown only lasts this page load */
  }
}

const BROWSER_DEPS: StaleReloadDeps = {
  now: () => Date.now(),
  readLastReload: readLastStaleReload,
  markReload: markStaleReload,
  reload: () => window.location.reload(),
};

/** Same constraint as React's own `lazy<T extends ComponentType<any>>`. */
export function lazyRoute<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  if (IS_LEGACY_BUILD) return lazy(factory);
  return lazy(() => loadWithStaleReload(factory, BROWSER_DEPS));
}
