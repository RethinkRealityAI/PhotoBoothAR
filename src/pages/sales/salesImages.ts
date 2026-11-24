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
import beamyBlast from '../../assets/sales/beamy-blast.webp';
// Brand v2: the real 3D Beamy (public/mascot/beamy.glb) rendered on the
// homepage's own stage (BeamyStage) wearing real library Looks, on a
// transparent canvas. Re-render: see the note at the end of this file.
import v2Hello from '../../assets/sales/v2/beamy-hello.webp';
import v2Crown from '../../assets/sales/v2/beamy-crown.webp';
import v2TopHat from '../../assets/sales/v2/beamy-tophat.webp';
import v2Mask from '../../assets/sales/v2/beamy-mask.webp';
import v2Paint from '../../assets/sales/v2/beamy-paint.webp';
import v2Aviators from '../../assets/sales/v2/beamy-aviators.webp';
import v2Necklace from '../../assets/sales/v2/beamy-necklace.webp';
import v2Antlers from '../../assets/sales/v2/beamy-antlers.webp';
import v2AsoEbi from '../../assets/sales/v2/beamy-asoebi.webp';
import v2Wedding from '../../assets/sales/v2/beamy-wedding.webp';
import v2Gala from '../../assets/sales/v2/beamy-gala.webp';

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
  // The old dark-background render; kept for any saved link, no deck uses it.
  'beamy-blast': { src: beamyBlast, width: 360, height: 560, cutout: false, alt: 'Beamy firing a light beam' },
  // Brand v2 Beamy, transparent. `beamy` and `beamy-wave` now point at the
  // v2 wave so the hub, booking page and CRM wear the same mascot as the site.
  beamy: { src: v2Hello, width: 731, height: 760, cutout: true, alt: 'Beamy, the Beamwall mascot, waving' },
  'beamy-wave': { src: v2Hello, width: 731, height: 760, cutout: true, alt: 'Beamy waving hello' },
  'beamy-crown': { src: v2Crown, width: 744, height: 760, cutout: true, alt: 'Beamy wearing a silver 3D crown' },
  'beamy-tophat': { src: v2TopHat, width: 641, height: 760, cutout: true, alt: 'Beamy wearing a 3D top hat' },
  'beamy-mask': { src: v2Mask, width: 822, height: 760, cutout: true, alt: 'Beamy wearing a porcelain Venetian mask' },
  'beamy-paint': { src: v2Paint, width: 833, height: 760, cutout: true, alt: 'Beamy wearing butterfly face paint' },
  'beamy-aviators': { src: v2Aviators, width: 842, height: 760, cutout: true, alt: 'Beamy wearing aviator sunglasses' },
  'beamy-necklace': { src: v2Necklace, width: 823, height: 760, cutout: true, alt: 'Beamy wearing an emerald necklace' },
  'beamy-antlers': { src: v2Antlers, width: 518, height: 760, cutout: true, alt: 'Beamy waving in reindeer antlers' },
  'beamy-asoebi': { src: v2AsoEbi, width: 546, height: 760, cutout: true, alt: 'Beamy in a silver crown inside an owanbe arch frame' },
  'beamy-wedding': { src: v2Wedding, width: 548, height: 760, cutout: true, alt: 'Beamy inside a wedding magazine-cover frame' },
  'beamy-gala': { src: v2Gala, width: 542, height: 760, cutout: true, alt: 'Beamy in a top hat inside a gala magazine-cover frame' },
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

/** Beamy wearing one Look per kind: the Looks slide's thumbnails. */
export const LOOK_SHOTS = {
  props: ['beamy-crown', 'beamy-tophat', 'beamy-aviators', 'beamy-necklace'],
  paint: ['beamy-paint', 'beamy-mask'],
} as const;

/** Mascot art for hub decoration. */
export const BEAMY = IMG.beamy;
export const BEAMY_WAVE = IMG['beamy-wave'];

/*
 * Re-rendering the v2 Beamy set (src/assets/sales/v2): mount BeamyStage on a
 * page whose html/body are transparent, call api.wear(look) with a look from
 * lib/beamyAssets (same url + fit), optionally api.play('Wave'), screenshot
 * with Playwright `omitBackground: true` at deviceScaleFactor 2, crop to the
 * alpha box and save as webp (~760px tall). Swiftshader GL works headless.
 */
