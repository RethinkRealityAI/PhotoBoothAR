/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Slide.image keys → bundled imagery. The keys are a fixed list agreed with
 * salesContent.ts; an unknown key resolves to null and the slide simply drops
 * its picture rather than rendering a broken <img>.
 *
 * Reuses the landing page's vendored art (src/lib/landingAssets.ts) so a deck
 * and the site a prospect clicks through to look like one product.
 */
import {
  BOOTH_CUTOUT,
  BOOTH_GUY_CUTOUT,
  CARD_CUTOUT,
  EVENT_ACTIVATION,
  EVENT_BIRTHDAY,
  EVENT_CONFERENCE,
  EVENT_GALA,
  EVENT_TRADESHOW,
  EVENT_WEDDING,
  FRAME_CLUSTER_CUTOUT,
  STEP_CREATE_CUTOUT,
  STEP_QR_CUTOUT,
  STEP_WALL_CUTOUT,
  TROPHY_CUTOUT,
  WALL_SCENE,
} from '../../lib/landingAssets';
import beamy from '../../assets/sales/beamy.webp';
import beamyWave from '../../assets/sales/beamy-wave.webp';
import beamyBlast from '../../assets/sales/beamy-blast.webp';

export interface SalesImage {
  src: string;
  /** Intrinsic size, so every <img> reserves its box (no layout shift). */
  width: number;
  height: number;
  /** true = transparent cutout (float it); false = a scene (frame it). */
  cutout: boolean;
  alt: string;
}

const IMG: Record<string, SalesImage> = {
  'hero-wall': { src: WALL_SCENE, width: 900, height: 1350, cutout: false, alt: 'Glowing photo-wall frames lit in a dark venue' },
  'booth-phone': { src: BOOTH_CUTOUT, width: 900, height: 1200, cutout: true, alt: 'A guest taking an AR selfie on her phone' },
  'booth-guy': { src: BOOTH_GUY_CUTOUT, width: 720, height: 960, cutout: true, alt: 'A guest mid AR selfie' },
  frames: { src: FRAME_CLUSTER_CUTOUT, width: 900, height: 900, cutout: true, alt: 'A cluster of glowing photo frames' },
  card: { src: CARD_CUTOUT, width: 900, height: 900, cutout: true, alt: 'A glowing keepsake card' },
  'step-create': { src: STEP_CREATE_CUTOUT, width: 880, height: 880, cutout: true, alt: 'Frame designs with colour swatches' },
  'step-qr': { src: STEP_QR_CUTOUT, width: 880, height: 880, cutout: true, alt: 'A QR table card' },
  'step-wall': { src: STEP_WALL_CUTOUT, width: 880, height: 880, cutout: true, alt: 'A live photo wall with a photo beaming in' },
  trophy: { src: TROPHY_CUTOUT, width: 900, height: 900, cutout: true, alt: 'A glowing glass trophy' },
  'event-wedding': { src: EVENT_WEDDING, width: 720, height: 725, cutout: false, alt: 'A wedding reception' },
  'event-gala': { src: EVENT_GALA, width: 720, height: 725, cutout: false, alt: 'A gala dinner' },
  'event-conference': { src: EVENT_CONFERENCE, width: 720, height: 725, cutout: false, alt: 'A conference hall' },
  'event-tradeshow': { src: EVENT_TRADESHOW, width: 720, height: 725, cutout: false, alt: 'A trade-show stand' },
  'event-activation': { src: EVENT_ACTIVATION, width: 720, height: 725, cutout: false, alt: 'A brand activation' },
  'event-birthday': { src: EVENT_BIRTHDAY, width: 720, height: 725, cutout: false, alt: 'A birthday party' },
  beamy: { src: beamy, width: 530, height: 472, cutout: true, alt: 'Beamy, the Beamwall mascot' },
  'beamy-wave': { src: beamyWave, width: 360, height: 560, cutout: false, alt: 'Beamy waving hello' },
  'beamy-blast': { src: beamyBlast, width: 360, height: 560, cutout: false, alt: 'Beamy firing a light beam' },
};

/** Key → URL, the plain map the brief asked for. */
export const SALES_IMAGES: Record<string, string> = Object.fromEntries(
  Object.entries(IMG).map(([k, v]) => [k, v.src]),
);

/** Safe lookup: undefined/unknown keys return null, never throw. */
export function salesImage(key: string | undefined | null): SalesImage | null {
  if (key === undefined || key === null || key === '') return null;
  return Object.prototype.hasOwnProperty.call(IMG, key) ? IMG[key] : null;
}

/** Mascot art for hub decoration. */
export const BEAMY = IMG.beamy;
export const BEAMY_WAVE = IMG['beamy-wave'];
