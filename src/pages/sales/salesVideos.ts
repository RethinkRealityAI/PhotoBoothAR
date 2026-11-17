/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Slide.video keys → the landing page's muted feature films (same files, so
 * a deck and the site look like one product). Unknown keys resolve to null
 * and the slide falls back to its image.
 */
import wallFilm from '../../assets/landing/wall-feature.mp4';
import wallPoster from '../../assets/landing/wall-feature-poster.jpg';
import boothFilm from '../../assets/landing/booth-feature.mp4';
import boothPoster from '../../assets/landing/booth-feature-poster.jpg';
import cardsFilm from '../../assets/landing/cards-feature.mp4';
import cardsPoster from '../../assets/landing/cards-feature-poster.jpg';
import challengesFilm from '../../assets/landing/challenges-feature.mp4';
import challengesPoster from '../../assets/landing/challenges-feature-poster.jpg';
import sizzleFilm from '../../assets/landing/beamwall-sizzle.mp4';
import sizzlePoster from '../../assets/landing/beamwall-sizzle-poster.jpg';

export interface SalesVideo {
  src: string;
  poster: string;
  label: string;
}

const VIDEOS: Record<string, SalesVideo> = {
  wall: { src: wallFilm, poster: wallPoster, label: 'Guest photos beaming from phones onto the live wall' },
  booth: { src: boothFilm, poster: boothPoster, label: 'Face-tracked 3D props in the guest booth' },
  cards: { src: cardsFilm, poster: cardsPoster, label: 'A keepsake card with video guestbook messages' },
  challenges: { src: challengesFilm, poster: challengesPoster, label: 'Photo challenges with an AI-checked leaderboard' },
  sizzle: { src: sizzleFilm, poster: sizzlePoster, label: 'A room lit up by its live photo wall' },
};

export const SALES_VIDEO_KEYS = Object.keys(VIDEOS);

export function salesVideo(key: string | undefined | null): SalesVideo | null {
  if (key === undefined || key === null || key === '') return null;
  return Object.prototype.hasOwnProperty.call(VIDEOS, key) ? VIDEOS[key] : null;
}
