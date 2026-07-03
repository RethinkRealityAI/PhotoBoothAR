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

type KeySuffix = 'session' | 'gallery' | 'guestName' | 'completedChallenges';

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
