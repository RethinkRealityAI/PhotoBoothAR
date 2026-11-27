/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The private "try it" event: the homepage's "How it works" QR code opens the
 * platform's demo event, and a visitor trying it out must only ever see their
 * OWN shots — never other visitors' photos, and never a public wall post of
 * theirs (Dapo, 2026-11-27: "It should be temporary and only show that users
 * images like the props demo example on the landing page").
 *
 * So on such an event nothing is uploaded or stored on a server: the booth's
 * send, the wall, the welcome page's photo field, My photos and the challenges
 * page all read and write the in-memory store below (wired in lib/db.ts and
 * lib/session.ts). It lives as long as the tab: a reload or closing the page
 * forgets every shot, which is the promise the visitor is shown.
 *
 * Pure apart from the optional `window`/`sessionStorage` reads, which are
 * guarded, so node tests can drive it directly.
 */
import type { MediaType, Post, SavedPhoto } from '../types';

/** The platform's demo event (lib/host.ts DEMO_EVENT_SLUG, kept a literal here
 *  so this module never pulls in the Supabase client). Always private. */
export const PRIVATE_TRY_SLUGS: ReadonlySet<string> = new Set(['demo']);

/** The homepage QR's marker (lib/beamyAssets.ts demoQrUrl). It also makes the
 *  event private for the rest of the tab, so a CMS-chosen demo slug other than
 *  `demo` is covered too. */
export const PRIVATE_TRY_PARAM = 'beamy-qr';
const FLAG_KEY = 'pbar.privateTry';

function flaggedSlugs(): Set<string> {
  try {
    const raw = sessionStorage.getItem(FLAG_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);
  } catch {
    return new Set();
  }
}

/** The event slug a QR landing URL marks private, or null. */
export function slugFromQrLanding(pathname: string, search: string): string | null {
  if (new URLSearchParams(search).get('from') !== PRIVATE_TRY_PARAM) return null;
  const m = /^\/e\/([^/?#]+)/.exec(pathname);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/** Slugs marked private in this tab only (no sessionStorage, e.g. tests). */
const memoryFlags = new Set<string>();

/** Whether this event's photos stay on this device. */
export function isPrivateTry(eventId: string): boolean {
  if (!eventId) return false;
  if (PRIVATE_TRY_SLUGS.has(eventId) || memoryFlags.has(eventId)) return true;
  if (typeof window !== 'undefined' && window.location) {
    const landed = slugFromQrLanding(window.location.pathname, window.location.search);
    if (landed !== null) {
      memoryFlags.add(landed);
      try {
        const all = flaggedSlugs();
        all.add(landed);
        sessionStorage.setItem(FLAG_KEY, JSON.stringify([...all]));
      } catch { /* the in-memory flag still holds for this page */ }
      if (landed === eventId) return true;
    }
  }
  if (flaggedSlugs().has(eventId)) {
    memoryFlags.add(eventId);
    return true;
  }
  return false;
}

/* ── The in-memory store (one list of posts + one gallery per event) ── */

const posts = new Map<string, Post[]>();
const gallery = new Map<string, SavedPhoto[]>();
type Listener = (e: { kind: 'insert'; post: Post } | { kind: 'delete'; id: string }) => void;
const listeners = new Map<string, Set<Listener>>();

function newId(): string {
  // A uuid, because a delete token must be one (lib/postDelete.ts isDeleteToken)
  // and post ids are uuids everywhere else.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`;
}

export interface PrivatePostInput {
  /** A URL the browser can show (an object URL of the capture). */
  url: string;
  mediaType?: MediaType;
  durationMs?: number;
  message?: string;
  guestName?: string;
  experienceId?: string | null;
  challengeId?: string | null;
  width?: number;
  height?: number;
  sessionId: string;
  now?: number;
}

/** Keep a shot on this device. Returns the post plus a delete token, the same
 *  shape a real send hands back, so the booth's success and Remove flows work. */
export function addPrivatePost(eventId: string, input: PrivatePostInput): { post: Post; deleteToken: string } {
  const post: Post = {
    id: newId(),
    created_at: new Date(input.now ?? Date.now()).toISOString(),
    image_url: input.url,
    media_type: input.mediaType ?? 'image',
    duration_ms: input.durationMs ?? null,
    message: input.message?.trim() || null,
    guest_name: input.guestName?.trim() || null,
    experience_id: input.experienceId ?? null,
    challenge_id: input.challengeId ?? null,
    session_id: input.sessionId,
    approved: true,
    hidden: false,
    width: input.width ?? null,
    height: input.height ?? null,
  };
  posts.set(eventId, [post, ...(posts.get(eventId) ?? [])]);
  listeners.get(eventId)?.forEach((l) => l({ kind: 'insert', post }));
  return { post, deleteToken: newId() };
}

/** This device's shots, newest first. */
export function listPrivatePosts(eventId: string): Post[] {
  return [...(posts.get(eventId) ?? [])];
}

export function removePrivatePost(eventId: string, id: string): boolean {
  const all = posts.get(eventId) ?? [];
  const kept = all.filter((p) => p.id !== id);
  if (kept.length === all.length) return false;
  posts.set(eventId, kept);
  listeners.get(eventId)?.forEach((l) => l({ kind: 'delete', id }));
  return true;
}

/** Live updates for the wall and welcome page. Returns the unsubscribe. */
export function subscribePrivatePosts(eventId: string, listener: Listener): () => void {
  let set = listeners.get(eventId);
  if (!set) {
    set = new Set();
    listeners.set(eventId, set);
  }
  set.add(listener);
  return () => { set.delete(listener); };
}

/** The local gallery (lib/session.ts) for a private event: memory, not
 *  localStorage, because its object URLs die with the page. */
export function privateGallery(eventId: string): SavedPhoto[] {
  return [...(gallery.get(eventId) ?? [])];
}

export function setPrivateGallery(eventId: string, photos: SavedPhoto[]): void {
  gallery.set(eventId, photos);
}

/** Test hook: forget everything. */
export function resetPrivateTry(): void {
  posts.clear();
  gallery.clear();
  listeners.clear();
  memoryFlags.clear();
}
