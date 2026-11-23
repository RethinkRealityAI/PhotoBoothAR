/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Camera quality readout helpers. PURE (no DOM, no React), pinned by tests.
 *
 * Used by the tester readout (`?trackdebug`) to show what the camera actually
 * granted vs the most the device reports it can do.
 */

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
