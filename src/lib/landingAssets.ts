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
