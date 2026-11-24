/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Slide.video keys → the site's muted v2 films, or the live wall ('wall').
 * Unknown keys resolve to null and the slide falls back to its image.
 */
import virtualFilm from '../../assets/landing/virtual-feature.mp4';
import virtualPoster from '../../assets/landing/virtual-feature-poster.jpg';

export interface SalesVideo {
  src: string;
  poster: string;
  label: string;
}

// Brand v2: only films made in the v2 look. The four pre-v2 feature films
// (midnight + serif, the retired spiky crown) left the decks 2026-11-24.
const VIDEOS: Record<string, SalesVideo> = {
  virtual: { src: virtualFilm, poster: virtualPoster, label: 'Friends anywhere add photos, videos and notes to one digital card' },
};

/** Keys drawn as the homepage's LIVE wall (DeckVisuals DeckWall), not a film.
 *  'sizzle' is the old room-on-the-wall film's key, kept so saved content resolves. */
const LIVE_WALL_KEYS = new Set(['wall', 'sizzle']);
export function isLiveWallKey(key: string | undefined | null): boolean {
  return key !== undefined && key !== null && LIVE_WALL_KEYS.has(key);
}

export const SALES_VIDEO_KEYS = Object.keys(VIDEOS);

export function salesVideo(key: string | undefined | null): SalesVideo | null {
  if (key === undefined || key === null || key === '') return null;
  return Object.prototype.hasOwnProperty.call(VIDEOS, key) ? VIDEOS[key] : null;
}
