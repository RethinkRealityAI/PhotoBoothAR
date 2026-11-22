/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Camera / capture quality helpers. PURE (no DOM, no React) so the numbers the
 * booth uses are pinned by tests.
 *
 * Why this exists: the booth's still photo is a 1080x1920 composite
 * (StageCanvas CAPTURE_W/H). The camera layer already fills it 1:1 on a phone
 * held upright (we ask for 1920x1080, which portrait phones hand over as
 * 1080x1920). The 3D layer did NOT: R3F's buffer is CSS width x DPR, capped at
 * 2, so on a 390 CSS-px iPhone it was 780px wide and got stretched 1.38x into
 * the keepsake, which is what made props look softer than the face under them.
 */

/** Width of the still-photo buffer the 3D canvas is composited into. */
export const PHOTO_BUFFER_W = 1080;
/** R3F's own default ceiling, and the floor of our ceiling. */
export const BASE_DPR_MAX = 2;
/** Never ask for more than this, whatever the maths says (fill-rate guard). */
export const HARD_DPR_MAX = 3;

/**
 * The R3F `dpr` ceiling that makes the 3D canvas at least as wide as the photo
 * buffer, so a captured prop is drawn 1:1 instead of upscaled.
 *
 * R3F clamps the result to the device's real devicePixelRatio, so this never
 * renders sharper than the screen can show; it only removes the artificial
 * 2x cap on 3x phones. Bad input (0, NaN, negative) falls back to R3F's
 * default of 2, which is exactly the previous behaviour.
 */
export function photoDprMax(cssWidth: number, bufferW: number = PHOTO_BUFFER_W): number {
  if (!Number.isFinite(cssWidth) || cssWidth <= 0 || !Number.isFinite(bufferW) || bufferW <= 0) {
    return BASE_DPR_MAX;
  }
  const needed = bufferW / cssWidth;
  // Round UP to 2 decimals so 1080/390 = 2.769… never lands a pixel short.
  const rounded = Math.ceil(needed * 100) / 100;
  return Math.min(HARD_DPR_MAX, Math.max(BASE_DPR_MAX, rounded));
}

/** The subset of MediaTrackSettings / MediaTrackCapabilities we read. */
export interface TrackNumbers {
  width?: number;
  height?: number;
  frameRate?: number;
}
export interface TrackRanges {
  width?: { max?: number };
  height?: { max?: number };
  frameRate?: { max?: number };
}

/** "1080×1920 @30" (or null when the track has not reported a size yet). */
export function formatGranted(s: TrackNumbers | null | undefined): string | null {
  if (!s || !(Number(s.width) > 0) || !(Number(s.height) > 0)) return null;
  const fps = Number(s.frameRate) > 0 ? ` @${Math.round(Number(s.frameRate))}` : '';
  return `${Math.round(Number(s.width))}×${Math.round(Number(s.height))}${fps}`;
}

/**
 * The camera's own maximum, as the browser reports it (getCapabilities). The
 * max width/height are reported in sensor orientation (landscape) on most
 * phones, so this is shown as long×short to avoid implying a rotation.
 * Null when the browser does not expose capabilities (older Firefox).
 */
export function formatMax(c: TrackRanges | null | undefined): string | null {
  if (!c) return null;
  const w = Number(c.width?.max);
  const h = Number(c.height?.max);
  if (!(w > 0) || !(h > 0)) return null;
  const long = Math.round(Math.max(w, h));
  const short = Math.round(Math.min(w, h));
  const fps = Number(c.frameRate?.max) > 0 ? ` @${Math.round(Number(c.frameRate!.max))}` : '';
  return `${long}×${short}${fps}`;
}
