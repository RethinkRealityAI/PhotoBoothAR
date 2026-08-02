/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Landing-page imagery — Higgsfield-generated art, vendored into the repo by
 * the "Fetch remote assets" GitHub Action (scripts/remote-assets.json holds
 * the source URLs). Self-hosted: no runtime dependency on the generation CDN.
 */
import boothPortrait from '../assets/landing/booth-portrait.webp';
import wallScene from '../assets/landing/wall-scene.webp';
import boothCutout from '../assets/landing/booth-cutout.webp';
import trophyCutout from '../assets/landing/trophy-cutout.webp';
import cardCutout from '../assets/landing/card-cutout.webp';
import frameClusterCutout from '../assets/landing/frame-cluster-cutout.webp';
import stepCreateCutout from '../assets/landing/step-create-cutout.webp';
import stepQrCutout from '../assets/landing/step-qr-cutout.webp';
import stepWallCutout from '../assets/landing/step-wall-cutout.webp';
import boothGuyCutout from '../assets/landing/booth-guy-cutout.webp';
import eventConference from '../assets/landing/event-conference.webp';
import eventTradeshow from '../assets/landing/event-tradeshow.webp';
import eventWedding from '../assets/landing/event-wedding.webp';
import eventGala from '../assets/landing/event-gala.webp';
import eventBirthday from '../assets/landing/event-birthday.webp';
import eventActivation from '../assets/landing/event-activation.webp';
import heroWedding from '../assets/landing/hero/hero-wedding.webp';
import heroGala from '../assets/landing/hero/hero-gala.webp';
import heroConference from '../assets/landing/hero/hero-conference.webp';
import heroBirthday from '../assets/landing/hero/hero-birthday.webp';
import heroTradeshow from '../assets/landing/hero/hero-tradeshow.webp';
// v2: the first render's background carried an M-lettered light wall that read
// as someone's logo; this one is a pure abstract emerald/gold installation.
// v1 (hero-activation.webp) stays committed but unreferenced — owner may delete.
import heroActivation from '../assets/landing/hero/hero-activation-v2.webp';

/** Editorial portrait — person with AR glasses in beam lighting (has bg). */
export const HERO_BOOTH_PORTRAIT = boothPortrait;

/** Beam-wall venue scene — glowing frames in a dark hall (has bg). */
export const WALL_SCENE = wallScene;

/** Woman taking an AR selfie, sparkles around her phone (transparent bg). */
export const BOOTH_CUTOUT = boothCutout;

/** Glowing glass trophy (transparent bg). */
export const TROPHY_CUTOUT = trophyCutout;

/** Elegant glowing greeting card (transparent bg). */
export const CARD_CUTOUT = cardCutout;

/** Floating cluster of multi-color glass frames (transparent bg). */
export const FRAME_CLUSTER_CUTOUT = frameClusterCutout;

/** How-it-works step 1 — frame-design cluster with color swatches (transparent bg). */
export const STEP_CREATE_CUTOUT = stepCreateCutout;

/** How-it-works step 2 — gold-framed QR table card (transparent bg). */
export const STEP_QR_CUTOUT = stepQrCutout;

/** How-it-works step 3 — glowing live photo wall with a beaming-in shot (transparent bg). */
export const STEP_WALL_CUTOUT = stepWallCutout;

/** Young man mid-AR-selfie, sparkles at his phone (transparent bg) — the booth section's decor. */
export const BOOTH_GUY_CUTOUT = boothGuyCutout;

/** Who-it's-for event-type cards (sliced from one Higgsfield contact sheet). */
export const EVENT_CONFERENCE = eventConference;
export const EVENT_TRADESHOW = eventTradeshow;
export const EVENT_WEDDING = eventWedding;
export const EVENT_GALA = eventGala;
export const EVENT_BIRTHDAY = eventBirthday;
export const EVENT_ACTIVATION = eventActivation;

/**
 * Hero-carousel frame photos — one per event TYPE, portrait 9:16, matched to
 * the frame design each card wears (LiveHeroCarousel's SLOTS table).
 *
 * These are AI-GENERATED ILLUSTRATIONS, not photographs of real Beamwall
 * events, which is why the caption under the strip promises styling rather
 * than "live moments". Any of the six is swappable per slot from
 * /admin/landing → Hero frames.
 */
export const HERO_WEDDING = heroWedding;
export const HERO_GALA = heroGala;
export const HERO_CONFERENCE = heroConference;
export const HERO_BIRTHDAY = heroBirthday;
export const HERO_TRADESHOW = heroTradeshow;
export const HERO_ACTIVATION = heroActivation;

/** The same six, in STRIP ORDER — index i is hero slot i, matching
 *  LiveHeroCarousel's SLOTS and DEFAULT_LANDING_CONTENT.heroSlots. /admin/landing
 *  previews the bundled default for a slot by indexing this. */
export const HERO_SLOT_IMAGES = [
  heroBirthday,
  heroWedding,
  heroActivation,
  heroConference,
  heroGala,
  heroTradeshow,
];
