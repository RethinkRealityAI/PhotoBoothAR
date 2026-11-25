/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The host's live wall preview: the REAL wall (/e/:slug/wall?preview=1)
 * running inside an iframe in the setup wizard, fed sample photos and the
 * host's unsaved design over postMessage. Pure (no React, no DOM globals) so
 * the message contract is unit-tested.
 *
 * Why an iframe of the real wall rather than a sketch: the host sees exactly
 * what the room will see, including the arrival effect, at the projector's
 * own 1440×900 layout scaled down.
 *
 * Safety: preview mode only changes what THIS browser draws (sample photos,
 * no database reads or writes, nothing persisted). It is honoured only inside
 * a frame, and messages are accepted only from the same origin and from the
 * parent window, so another site cannot drive it.
 */
import type { Post, WallSettings } from '../types';

export const WALL_PREVIEW_PARAM = 'preview';

/** True when this page load is the wizard's embedded wall preview. */
export function isWallPreviewRequest(search: string, inFrame: boolean): boolean {
  if (!inFrame) return false;
  return new URLSearchParams(search).get(WALL_PREVIEW_PARAM) === '1';
}

/** Browser convenience: reads location + framing (false outside a browser). */
export function isWallPreviewFrame(): boolean {
  if (typeof window === 'undefined') return false;
  let inFrame = false;
  try {
    inFrame = window.self !== window.top;
  } catch {
    inFrame = true; // cross-origin top: we are framed
  }
  return isWallPreviewRequest(window.location.search, inFrame);
}

/** The settings a preview may set (display only). */
export type PreviewSettings = Pick<
  WallSettings,
  'showQR' | 'qrOnWall' | 'showLeaderboard' | 'showChallenges' | 'featuredSpotlight' | 'wallLook'
>;

export type WallPreviewMessage =
  | { type: 'beamwall:wall-preview:settings'; settings: Partial<PreviewSettings> }
  | { type: 'beamwall:wall-preview:beam' };

export const WALL_PREVIEW_READY = 'beamwall:wall-preview:ready';

const BOOL_KEYS = ['showQR', 'qrOnWall', 'showLeaderboard', 'showChallenges', 'featuredSpotlight'] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validate an incoming message. Unknown shapes are null; only the boolean
 * toggles and a raw wallLook object pass (the wall normalizes the look
 * itself, exactly as it does a stored one).
 */
export function parseWallPreviewMessage(data: unknown): WallPreviewMessage | null {
  if (!isRecord(data)) return null;
  if (data.type === 'beamwall:wall-preview:beam') return { type: 'beamwall:wall-preview:beam' };
  if (data.type !== 'beamwall:wall-preview:settings' || !isRecord(data.settings)) return null;
  const raw = data.settings;
  const settings: Partial<PreviewSettings> = {};
  for (const k of BOOL_KEYS) {
    if (typeof raw[k] === 'boolean') settings[k] = raw[k] as boolean;
  }
  if (isRecord(raw.wallLook)) settings.wallLook = raw.wallLook as PreviewSettings['wallLook'];
  return { type: 'beamwall:wall-preview:settings', settings };
}

const GUESTS = ['Ada', 'Tolu', 'Sam', 'Bisi', 'Kemi', 'Jordan', 'Priya', 'Leo', 'Maya', 'Chidi', 'Zara', 'Noah'];

/** Give stand-in photos guest names so captions show in the preview. */
export function namedSamples(posts: readonly Post[]): Post[] {
  return posts.map((p, i) => ({ ...p, guest_name: GUESTS[i % GUESTS.length] }));
}

/** The n-th sample photo "beamed" from the preview button: a fresh id each
 *  time (so the wall treats it as a new arrival), images and names cycling. */
export function previewArrival(samples: readonly Post[], n: number): Post | null {
  if (samples.length === 0) return null;
  const base = samples[n % samples.length];
  return {
    ...base,
    id: `preview-beam-${n}`,
    created_at: new Date(0).toISOString(),
    guest_name: GUESTS[(n + 5) % GUESTS.length],
  };
}

/** How many photos the preview keeps on the wall before dropping the oldest. */
export const PREVIEW_MAX_POSTS = 36;
