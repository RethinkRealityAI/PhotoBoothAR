/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The one live removal queue for this tab (guestRemovals.ts is the pure logic).
 * One instance, so a removal started on My Photos still hides the photo on the
 * wall view, and its undo bar follows the guest from page to page.
 *
 * Durability: the not-yet-sent items are mirrored to localStorage. If the tab
 * closes inside the undo window, `pagehide` fires the deletes with `keepalive`,
 * and the next visit replays whatever is left (a repeat answers
 * `post_not_found`, which counts as done). Closing the page is not an undo.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { RemovalQueue, parsePersisted, type RemovalItem, type RemovalSnapshot } from './guestRemovals';
import { deleteMyPost, sendDeleteMyPostOnExit } from './db';
import { forgetSavedPhotos } from './session';

const STORAGE_KEY = 'pbar.pendingRemovals';

export const removals = new RemovalQueue({
  commit: (eventId, item) => deleteMyPost(eventId, item.id, item.deleteToken ?? ''),
  onRemoved: forgetSavedPhotos,
  persist: (pending) => {
    if (Object.keys(pending).length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
  },
  now: () => Date.now(),
  setTimer: (fn, ms) => window.setTimeout(fn, ms),
  clearTimer: (h) => window.clearTimeout(h as number),
});

if (typeof window !== 'undefined') {
  // A previous visit closed with removals unsent: finish them now.
  let leftover: Record<string, RemovalItem[]> = {};
  try {
    leftover = parsePersisted(localStorage.getItem(STORAGE_KEY));
  } catch {
    /* storage blocked */
  }
  for (const [eventId, items] of Object.entries(leftover)) removals.schedule(eventId, items, 0);

  window.addEventListener('pagehide', () => {
    for (const [eventId, items] of Object.entries(removals.pendingItems())) {
      for (const it of items) {
        if (it.origin === 'db' && it.deleteToken) sendDeleteMyPostOnExit(eventId, it.id, it.deleteToken);
      }
    }
  });
}

export function useRemovals(): RemovalSnapshot {
  return useSyncExternalStore(removals.subscribe, removals.getSnapshot, removals.getSnapshot);
}

/** Ids this guest is removing from this event; every gallery view hides them. */
export function usePendingRemovalIds(eventId: string): ReadonlySet<string> {
  const snap = useRemovals();
  // `snap` changes identity on every queue change, which is what re-derives this.
  return useMemo(() => removals.pendingIds(eventId), [snap, eventId]);
}
