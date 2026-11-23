/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * After a deploy, a tab opened on the previous build still asks for that
 * build's hashed chunks. Netlify answers a missing file with index.html at
 * 200, so the lazy import fails with a fetch or MIME error that has nothing
 * to do with the user's connection. This tells that case apart so the UI
 * can say "reload" instead of "check the connection". Pure: no DOM.
 */

const STALE_PATTERNS: readonly RegExp[] = [
  /failed to fetch dynamically imported module/i, // Chromium
  /error loading dynamically imported module/i, // Firefox
  /importing a module script failed/i, // Safari
  /is not a valid javascript mime type/i, // HTML served for a .js chunk
  /expected a javascript.*module script/i,
  /unable to preload css/i, // Vite's own preload helper
];

/** True when a dynamic import failed because this page's build is out of date. */
export function isStaleChunkError(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : typeof e === 'string' ? e : '';
  return msg !== '' && STALE_PATTERNS.some((p) => p.test(msg));
}

export const STALE_APP_MESSAGE =
  'Beamwall was updated after this page was opened, so this part of the page is out of date. Reload the page and try again.';

/** Minimum gap between two automatic reloads, so a truly missing file cannot loop. */
export const STALE_RELOAD_COOLDOWN_MS = 30_000;

/**
 * Should a failed lazy chunk quietly reload the page? Only on surfaces where a
 * reload loses nothing a person cannot redo: never mid-event for a guest (the
 * booth, the wall, a card being written, a beamed demo shot) — those keep
 * their own fallbacks and error screens — and never twice inside the cooldown.
 */
export function shouldReloadForStaleChunk(pathname: string, lastReloadAt: number | null, now: number): boolean {
  if (/^\/(e|beam|c)(\/|$)/.test(pathname)) return false;
  if (lastReloadAt !== null && Number.isFinite(lastReloadAt) && now - lastReloadAt < STALE_RELOAD_COOLDOWN_MS) return false;
  return true;
}

/** sessionStorage key holding the time of the last automatic reload. Shared by
 *  the `vite:preloadError` listener (main.tsx) and lazy routes (lazyRoute.ts),
 *  so both honour ONE cooldown and can never ping-pong each other. */
export const STALE_RELOAD_KEY = 'pbar.staleReloadAt';

/** What loading a lazy ROUTE chunk needs from the browser — injected so the
 *  decision is testable in node. */
export interface StaleReloadDeps {
  now: () => number;
  /** Last automatic reload time, or null (never / unreadable storage). */
  readLastReload: () => number | null;
  markReload: (at: number) => void;
  reload: () => void;
}

/** A promise that never settles: the page is reloading, so the route's
 *  Suspense spinner is the right thing to show until it does. */
const PENDING_RELOAD = new Promise<never>(() => {});

/**
 * Load a lazy ROUTE component; when its chunk is gone because a deploy
 * replaced this build, reload the page once instead of crashing into the
 * error boundary.
 *
 * Route chunks may reload on EVERY surface, guest pages included — unlike the
 * window-level listener's guest exclusion (shouldReloadForStaleChunk), which
 * protects in-page chunks (3D, reveals) loading under a live booth. When a
 * route chunk fails, the previous route has already unmounted and the new one
 * cannot render at all, so a reload loses nothing the error screen's own
 * Reload button would not.
 *
 * - resolves `undefined`: the window listener already cancelled the error and
 *   is reloading (Vite's helper then returns undefined) — wait, don't hand
 *   React.lazy an undefined module (that throws and flashes the error screen).
 * - a stale error outside the cooldown: mark, reload, wait.
 * - anything else, or inside the cooldown: rethrow to the error boundary.
 */
export async function loadWithStaleReload<T>(
  factory: () => Promise<T | undefined>,
  deps: StaleReloadDeps,
): Promise<T> {
  let mod: T | undefined;
  try {
    mod = await factory();
  } catch (e) {
    if (!isStaleChunkError(e)) throw e;
    const now = deps.now();
    const last = deps.readLastReload();
    if (last !== null && Number.isFinite(last) && now - last < STALE_RELOAD_COOLDOWN_MS) throw e;
    deps.markReload(now);
    deps.reload();
    return PENDING_RELOAD;
  }
  if (mod === undefined) return PENDING_RELOAD;
  return mod;
}
