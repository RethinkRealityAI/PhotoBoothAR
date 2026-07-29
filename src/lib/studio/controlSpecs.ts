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
 * Parse typed numeric entry against a control's own spec.
 *
 * Every studio property was a slider, so a host could not type "rotate 90" or
 * "x = 0" — they dragged and hoped. The numeric fields beside each slider run
 * their input through here so a typed value obeys EXACTLY the bounds the slider
 * obeys (this file stays the single source of limits; nothing that reads a
 * number declares its own).
 *
 * Returns null for input that is not a number at all, so a field can hold
 * in-progress text ("-", "1.") without snapping the object on every keystroke.
 * Anything numeric but out of range is CLAMPED, not rejected — a host who types
 * 500 into a 0..100 field means "as far as it goes".
 */
export function parseSpecInput(text: string, spec: { min: number; max: number }): number | null {
  const trimmed = text.trim().replace(/[%°]\s*$/, '').replace(/\s*cm$/i, '');
  if (trimmed === '' || trimmed === '-' || trimmed === '+' || trimmed === '.' || trimmed === '-.') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return clampToSpec(value, spec);
}

/**
 * Round a value to the resolution its step offers, so a typed 12.3456 stores as
 * 12.5 on a 0.5-step control rather than a number the slider can never return to.
 */
export function quantizeToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
  const snapped = Math.round(value / step) * step;
  // Kill float dust (0.30000000000000004) at the step's own precision.
  const decimals = step < 1 ? Math.min(6, Math.ceil(-Math.log10(step)) + 1) : 0;
  return Number(snapped.toFixed(decimals));
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

/* — 3D placement defaults ------------------------------------------------- */

/**
 * The anchor config a 3D object should RESET to.
 *
 * PropertiesDock passed a literal 0 as the default for all six offset/rotation
 * rows. That is wrong for four of the five built-in head pieces, which ship
 * deliberately tuned nudges (Royal Crown sits at y −1.0cm, the Halo at +3.4).
 * So "reset" dragged a piece AWAY from the position it was designed at, and the
 * reset button's enabled state was inverted: greyed out at 0 — which is not the
 * default — and offered when the piece was already exactly where it belonged.
 */
export function defaultAnchorConfig(
  o: { type: string; proceduralId?: string },
  headPieceMap: Record<string, { config: { offset: Vec3Like; rotation: Vec3Like; scale: number } }>,
): { offset: Vec3Like; rotation: Vec3Like; scale: number } {
  const preset = o.type === 'headpiece' && o.proceduralId ? headPieceMap[o.proceduralId] : undefined;
  if (preset) {
    return {
      offset: { ...preset.config.offset },
      rotation: { ...preset.config.rotation },
      scale: preset.config.scale,
    };
  }
  return { offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 };
}

export interface Vec3Like { x: number; y: number; z: number }
