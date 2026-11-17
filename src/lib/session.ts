/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Anonymous guest session + local gallery so attendees can re-download
 * their own photos later on the same device, with no login required.
 *
 * Keys are event-scoped (`pbar.<eventId>.*`) so one device can attend many
 * events. The original single-tenant builds used un-scoped `hopegala.*` keys;
 * those are migrated one-time (read old → copy to new) for the legacy events
 * so existing guests keep their session id, gallery and progress.
 */
import { SavedPhoto } from '../types';

const LEGACY_EVENT_IDS = new Set(['hope-gala', 'jenna-jake', 'detola-wuyi']);

type KeySuffix =
  | 'session'
  | 'gallery'
  | 'guestName'
  | 'completedChallenges'
  | 'guestNameSkipped'
  | 'keepsakeOptIn';

function scopedKey(eventId: string, suffix: KeySuffix): string {
  return `pbar.${eventId}.${suffix}`;
}

/** Read an event-scoped value, migrating the legacy un-scoped key if needed. */
function readKey(eventId: string, suffix: KeySuffix): string | null {
  const key = scopedKey(eventId, suffix);
  let value = localStorage.getItem(key);
  if (value === null && LEGACY_EVENT_IDS.has(eventId)) {
    const legacy = localStorage.getItem(`hopegala.${suffix}`);
    if (legacy !== null) {
      localStorage.setItem(key, legacy);
      value = legacy;
    }
  }
  return value;
}

/** Stable per-device id used to tag a guest's submissions. */
export function getSessionId(eventId: string): string {
  try {
    let id = readKey(eventId, 'session');
    if (!id) {
      id = (crypto.randomUUID?.() ?? `s_${Math.random().toString(36).slice(2)}_${performance.now()}`);
      localStorage.setItem(scopedKey(eventId, 'session'), id);
    }
    return id;
  } catch {
    return 'ephemeral';
  }
}

export function getSavedPhotos(eventId: string): SavedPhoto[] {
  try {
    const raw = readKey(eventId, 'gallery');
    return raw ? (JSON.parse(raw) as SavedPhoto[]) : [];
  } catch {
    return [];
  }
}

export function savePhoto(eventId: string, photo: SavedPhoto): void {
  try {
    const all = getSavedPhotos(eventId);
    if (all.some((p) => p.id === photo.id)) return;
    all.unshift(photo);
    localStorage.setItem(scopedKey(eventId, 'gallery'), JSON.stringify(all.slice(0, 100)));
    window.dispatchEvent(new CustomEvent('gallery:changed'));
  } catch {
    /* storage may be unavailable in private mode; non-fatal */
  }
}

export function clearGallery(eventId: string): void {
  try {
    localStorage.removeItem(scopedKey(eventId, 'gallery'));
    window.dispatchEvent(new CustomEvent('gallery:changed'));
  } catch {
    /* non-fatal */
  }
}

/* ── Guest name (saved once for challenge mode, reused thereafter) ── */

export function getGuestName(eventId: string): string {
  try {
    return readKey(eventId, 'guestName') ?? '';
  } catch {
    return '';
  }
}

export function setGuestName(eventId: string, name: string): void {
  const n = name.trim().slice(0, 60);
  if (!n) return;
  try {
    localStorage.setItem(scopedKey(eventId, 'guestName'), n);
  } catch {
    /* non-fatal */
  }
}

/**
 * The guest declined to give a name for on-frame lettering. Remembered per
 * event so the booth asks ONCE — being re-asked at every shutter press would be
 * worse than the feature is good. Separate from `guestName` because "skipped"
 * and "not asked yet" must not look the same.
 */
export function hasSkippedGuestName(eventId: string): boolean {
  try {
    return readKey(eventId, 'guestNameSkipped') === '1';
  } catch {
    return false;
  }
}

export function skipGuestName(eventId: string): void {
  try {
    localStorage.setItem(scopedKey(eventId, 'guestNameSkipped'), '1');
  } catch {
    /* non-fatal */
  }
}

/* ── Completed challenges (so finished ones drop off this device's list) ── */

export function getCompletedChallenges(eventId: string): string[] {
  try {
    const raw = readKey(eventId, 'completedChallenges');
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/** Merge ids into the completed set (used to hydrate from the server too). */
export function addCompletedChallenges(eventId: string, ids: string[]): void {
  if (!ids.length) return;
  try {
    const set = new Set(getCompletedChallenges(eventId));
    ids.forEach((id) => id && set.add(id));
    localStorage.setItem(scopedKey(eventId, 'completedChallenges'), JSON.stringify([...set]));
    window.dispatchEvent(new CustomEvent('challenges:changed'));
  } catch {
    /* non-fatal */
  }
}

export function addCompletedChallenge(eventId: string, id: string): void {
  addCompletedChallenges(eventId, [id]);
}

/* ── Keepsake email opt-in (one post-event email, consented at the booth) ── */

/**
 * Whether this device already gave an address for this event's keepsake email.
 *
 * Only the FLAG is kept locally, never the address — a shared party phone must
 * not hand the next guest someone else's email, and the row itself is
 * write-only from the browser anyway (migration 034). Purpose is the same as
 * `hasSkippedGuestName`: ask once. Being asked again after saying yes reads as
 * "it didn't work", which is the fastest way to lose the guest's trust in the
 * thing we just promised to send them.
 */
export function hasKeepsakeOptIn(eventId: string): boolean {
  try {
    return readKey(eventId, 'keepsakeOptIn') === '1';
  } catch {
    return false;
  }
}

export function markKeepsakeOptIn(eventId: string): void {
  try {
    localStorage.setItem(scopedKey(eventId, 'keepsakeOptIn'), '1');
  } catch {
    /* non-fatal */
  }
}
