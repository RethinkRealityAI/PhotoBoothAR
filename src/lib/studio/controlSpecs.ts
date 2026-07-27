/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared bounds for the studio's editing controls.
 *
 * These existed as literals repeated across the stage and both docks, and had
 * drifted apart: the stage wheel-zoomed a 2D overlay up to 5x, while the Size
 * sliders in PropertiesDock and AssetsDock declared `max={3}`. An
 * `<input type="range">` clamps its own value to `max`, so a sticker scaled to
 * 4.2 by scrolling was silently snapped down to 3 the instant the host touched
 * the slider — losing work with no warning and no undo intent.
 *
 * One definition, imported everywhere, so a bound cannot drift again.
 */

/** 2D overlay (frame / sticker) uniform scale. */
export const OVERLAY_SCALE = {
  min: 0.1,
  max: 5,
  step: 0.05,
} as const;

/** 2D overlay position, as a percentage of the frame from centre. */
export const OVERLAY_POSITION = {
  min: -100,
  max: 100,
  step: 0.5,
} as const;

/** 2D overlay rotation, degrees. */
export const OVERLAY_ROTATION = {
  min: -180,
  max: 180,
  step: 1,
} as const;

/**
 * Clamp a value into a spec's range, snapping non-finite input to the minimum
 * rather than propagating NaN into a transform.
 */
export function clampToSpec(value: number, spec: { min: number; max: number }): number {
  if (!Number.isFinite(value)) return spec.min;
  return Math.min(spec.max, Math.max(spec.min, value));
}

/**
 * Format a slider value at the resolution its step actually offers.
 *
 * The position sliders stepped by 0.5 but printed `toFixed(0)`, so the readout
 * showed "1%", "1%", "2%", "2%" as the value walked 0.5 at a time — every other
 * arrow-key press appeared to do nothing.
 */
export function formatAtStep(value: number, step: number, suffix = ''): string {
  const decimals = step < 1 && step > 0 ? Math.min(2, Math.ceil(-Math.log10(step))) : 0;
  return `${value.toFixed(decimals)}${suffix}`;
}
