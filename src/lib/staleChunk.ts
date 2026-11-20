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
