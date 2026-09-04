/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Larger-text preference for the host chats and A2UI cards. Stored per
 * browser under `beamwall:textsize`; the layout writes it to
 * `document.documentElement.dataset.textsize`, and the CSS scales the
 * `.ui-scalable` roots through `--ui-scale` — never `html{font-size}`, so the
 * studio canvas does not move.
 *
 * PURE: the store is injected (localStorage in the app, a Map-backed stub in
 * tests) and every access is guarded — storage can throw in private windows.
 */
export type TextSize = 'md' | 'lg';

export const TEXT_SIZE_KEY = 'beamwall:textsize';

export interface TextSizeStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readTextSize(store: TextSizeStore | null | undefined): TextSize {
  try {
    return store?.getItem(TEXT_SIZE_KEY) === 'lg' ? 'lg' : 'md';
  } catch {
    return 'md';
  }
}

/** True when the preference was persisted; false when storage refused. */
export function writeTextSize(store: TextSizeStore | null | undefined, size: TextSize): boolean {
  try {
    if (!store) return false;
    store.setItem(TEXT_SIZE_KEY, size === 'lg' ? 'lg' : 'md');
    return true;
  } catch {
    return false;
  }
}
