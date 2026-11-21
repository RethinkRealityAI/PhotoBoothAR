/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * What the booth shows while the camera is (not) coming up. Pure: no DOM,
 * no React — Booth.tsx and booth/CameraError.tsx read these.
 */
import type { CameraFailure } from './camera';

/**
 * The once-per-device "Choose Your Look" tutorial sits at z-[70], above the
 * camera error screen. With camera access denied, a guest had to page through
 * (or skip) five tutorial cards before learning the camera was blocked — and
 * the tutorial teaches controls they cannot use yet. A camera error therefore
 * wins: the tutorial is held back (not dismissed — it stays owed) until the
 * camera is no longer failing, e.g. after a successful "Try again".
 */
export function shouldShowOnboarding(opts: {
  started: boolean;
  onboardingVisible: boolean;
  cameraError: CameraFailure | null;
}): boolean {
  return opts.started && opts.onboardingVisible && opts.cameraError === null;
}

/** The pre-platform wording, kept for the frozen legacy single-event sites. */
export const LEGACY_NO_CAMERA_BODY =
  'No camera was detected on this device. Please connect a camera and try again.';

/** Phones have a built-in camera, so "connect a camera" read as nonsense
 *  there. The screen's own Upload-a-photo / See-the-wall links follow. */
export const NO_CAMERA_BODY =
  'We couldn’t find a camera on this device. You can still upload a photo or see the wall below.';

export function noCameraBody(legacyBuild: boolean): string {
  return legacyBuild ? LEGACY_NO_CAMERA_BODY : NO_CAMERA_BODY;
}
