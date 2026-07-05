/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure routing helpers for GuestNav — kept free of React so they're unit-tested
 * in isolation. `keyForPath` maps a (possibly tenant-prefixed) location to the
 * active nav destination.
 */
export type NavKey = 'booth' | 'wall' | 'challenges' | 'photos' | 'upload';

/**
 * Resolve the active nav key for a pathname, stripping the event basePath
 * (`/e/<slug>`) first so it works at runtime and on legacy root builds alike.
 */
export function keyForPath(path: string, basePath: string): NavKey | null {
  const rel = basePath && path.startsWith(basePath) ? path.slice(basePath.length) : path;
  if (rel.startsWith('/wall')) return 'wall';
  if (rel.startsWith('/challenges')) return 'challenges';
  if (rel.startsWith('/upload')) return 'upload';
  if (rel.startsWith('/me') || rel.startsWith('/gallery')) return 'photos';
  if (rel.startsWith('/booth') || rel.startsWith('/experience') || rel === '' || rel === '/') return 'booth';
  return null;
}
