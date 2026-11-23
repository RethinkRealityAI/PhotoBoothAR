/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Stand-in moments (bundled AI event photos, no real guests) for walls and
 * previews of an event nobody has photographed yet, so a new event never
 * looks bare. Never shown as a guest's photo: callers keep real posts apart.
 */
import type { Post } from '../../types';
import heroWedding from '../../assets/landing/hero/hero-wedding.webp';
import heroGala from '../../assets/landing/hero/hero-gala.webp';
import heroBirthday from '../../assets/landing/hero/hero-birthday.webp';
import heroConference from '../../assets/landing/hero/hero-conference.webp';
import heroTradeshow from '../../assets/landing/hero/hero-tradeshow.webp';
import heroActivation from '../../assets/landing/hero/hero-activation-v2.webp';
import eventWedding from '../../assets/landing/event-wedding.webp';
import eventGala from '../../assets/landing/event-gala.webp';
import eventBirthday from '../../assets/landing/event-birthday.webp';
import boothPortrait from '../../assets/landing/booth-portrait.webp';
import boothStandin from '../../assets/landing/booth-standin.webp';
const SAMPLE_URLS = [
  heroWedding, heroGala, heroBirthday, heroConference, heroTradeshow, heroActivation,
  eventWedding, eventGala, eventBirthday, boothPortrait,
];

/** Stand-in moments for an event that has none yet, so the preview still shows the look. */
export function samplePosts(n = 30): Post[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `sample-${i}`,
    created_at: new Date(0).toISOString(),
    image_url: SAMPLE_URLS[i % SAMPLE_URLS.length],
    media_type: 'image',
    duration_ms: null,
    message: null,
    guest_name: null,
    experience_id: null,
    challenge_id: null,
    session_id: null,
    approved: true,
    hidden: false,
    width: null,
    height: null,
  }));
}


/** The welcome wall's tiles: the event's own photos, or stand-ins until the first lands. */
export const WALL_FIELD_SAMPLES: readonly Post[] = samplePosts(10);

/** The stand-in guest a bare frame is drawn over in the booth showcase. */
export const SHOWCASE_STANDIN: string = boothPortrait;

/** The stand-in guest on the splash pages' phone screen, under the event's
 *  own frame: a clean portrait with headroom, nothing on the head or face. */
export const BOOTH_STANDIN: string = boothStandin;
