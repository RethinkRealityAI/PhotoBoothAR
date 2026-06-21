/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Anonymous guest session + local gallery so attendees can re-download
 * their own photos later on the same device, with no login required.
 */
import { SavedPhoto } from '../types';

const SESSION_KEY = 'hopegala.session';
const GALLERY_KEY = 'hopegala.gallery';
const NAME_KEY = 'hopegala.guestName';
const COMPLETED_KEY = 'hopegala.completedChallenges';

/** Stable per-device id used to tag a guest's submissions. */
export function getSessionId(): string {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = (crypto.randomUUID?.() ?? `s_${Math.random().toString(36).slice(2)}_${performance.now()}`);
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return 'ephemeral';
  }
}

export function getSavedPhotos(): SavedPhoto[] {
  try {
    const raw = localStorage.getItem(GALLERY_KEY);
    return raw ? (JSON.parse(raw) as SavedPhoto[]) : [];
  } catch {
    return [];
  }
}

export function savePhoto(photo: SavedPhoto): void {
  try {
    const all = getSavedPhotos();
    if (all.some((p) => p.id === photo.id)) return;
    all.unshift(photo);
    localStorage.setItem(GALLERY_KEY, JSON.stringify(all.slice(0, 100)));
    window.dispatchEvent(new CustomEvent('gallery:changed'));
  } catch {
    /* storage may be unavailable in private mode; non-fatal */
  }
}

export function clearGallery(): void {
  try {
    localStorage.removeItem(GALLERY_KEY);
    window.dispatchEvent(new CustomEvent('gallery:changed'));
  } catch {
    /* non-fatal */
  }
}

/* ── Guest name (saved once for challenge mode, reused thereafter) ── */

export function getGuestName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setGuestName(name: string): void {
  const n = name.trim().slice(0, 60);
  if (!n) return;
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    /* non-fatal */
  }
}

/* ── Completed challenges (so finished ones drop off this device's list) ── */

export function getCompletedChallenges(): string[] {
  try {
    const raw = localStorage.getItem(COMPLETED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/** Merge ids into the completed set (used to hydrate from the server too). */
export function addCompletedChallenges(ids: string[]): void {
  if (!ids.length) return;
  try {
    const set = new Set(getCompletedChallenges());
    ids.forEach((id) => id && set.add(id));
    localStorage.setItem(COMPLETED_KEY, JSON.stringify([...set]));
    window.dispatchEvent(new CustomEvent('challenges:changed'));
  } catch {
    /* non-fatal */
  }
}

export function addCompletedChallenge(id: string): void {
  addCompletedChallenges([id]);
}
