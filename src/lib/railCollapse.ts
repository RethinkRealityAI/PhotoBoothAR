/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Collapsed / expanded memory for every desktop side menu (host rail, admin
 * rail, Studio docks, editor options panel, sales hub rail, library
 * categories). One key per surface under `beamwall:rail:<surface>`, so
 * collapsing the admin rail never collapses the host one.
 *
 * PURE: the store is injected (localStorage in the app, a Map-backed stub in
 * tests) and every access is guarded, because storage can throw in private
 * windows. Unknown or missing values read as EXPANDED: a menu that silently
 * starts hidden is worse than one that starts open.
 */
export type RailSurface =
  | 'host'
  | 'admin'
  | 'studio-assets'
  | 'studio-props'
  | 'editor'
  | 'sales'
  | 'library-categories';

export interface RailStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function railStorageKey(surface: RailSurface): string {
  return `beamwall:rail:${surface}`;
}

export function readRailCollapsed(store: RailStore | null | undefined, surface: RailSurface): boolean {
  try {
    return store?.getItem(railStorageKey(surface)) === 'collapsed';
  } catch {
    return false;
  }
}

/** True when the choice was persisted; false when storage refused (the
 *  session still gets it, it just will not survive a reload). */
export function writeRailCollapsed(store: RailStore | null | undefined, surface: RailSurface, collapsed: boolean): boolean {
  try {
    if (!store) return false;
    store.setItem(railStorageKey(surface), collapsed ? 'collapsed' : 'expanded');
    return true;
  } catch {
    return false;
  }
}
