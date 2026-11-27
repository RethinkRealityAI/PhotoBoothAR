/**
 * Room light for the standing Frame (world mode). PURE, unit-tested in node.
 *
 * WHY: the board was drawn at full studio brightness whatever the room looked
 * like, so in a dim reception or at sunset it glowed like a sticker on top of
 * the picture. Matching its brightness and colour cast to the scene is most of
 * what makes it look like it is standing there.
 *
 * WHAT 8th Wall gives (XrController `enableLighting`, measured on the real
 * engine): `exposure`, about -0.9 for a very dark picture, 0 for a normal one
 * and +0.35 for a bright one. Its `temperature` is always 6500 (it is not
 * estimated), so the colour cast comes from our own sample of the camera
 * picture: a row of pixels from the lower half, where the floor and the room
 * are (the sky and the lamps are higher up).
 *
 * The result is a colour the board's materials are multiplied by. It is
 * deliberately partial: a white dress must still read white, so only a third of
 * the cast is taken, and the board never drops under 45% or above 112%.
 */

export type Rgb = [number, number, number];

export const LIGHT_NEUTRAL: Readonly<Rgb> = [1, 1, 1];
export const LIGHT_MIN_GAIN = 0.45;
export const LIGHT_MAX_GAIN = 1.12;
/** How much of the scene's colour cast the board takes on. */
export const LIGHT_CAST = 0.35;
/** Seconds for the board to follow a change of light (no flicker with the camera's auto exposure). */
export const LIGHT_EASE_S = 0.6;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Mean of a row of RGBA bytes (readPixels), 0..1 per channel. null for an empty or black-only read. */
export function meanOfRow(rgba: ArrayLike<number>): Rgb | null {
  const n = Math.floor(rgba.length / 4);
  if (n === 0) return null;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < n; i++) { r += rgba[i * 4]; g += rgba[i * 4 + 1]; b += rgba[i * 4 + 2]; }
  const out: Rgb = [r / n / 255, g / n / 255, b / n / 255];
  return out[0] + out[1] + out[2] > 0 ? out : null;
}

/**
 * The colour to multiply the board by.
 * @param exposure 8th Wall's exposure estimate (null when it gave none).
 * @param scene mean colour of the camera picture's lower half, 0..1 (null = unknown).
 */
export function boardLight(exposure: number | null, scene: Readonly<Rgb> | null): Rgb {
  // Brightness: 8th Wall's exposure, and how dark the picture itself is.
  let gain = exposure === null || !Number.isFinite(exposure) ? 1 : 1 + clamp(exposure, -1, 0.5) * 0.55;
  let cast: Rgb = [1, 1, 1];
  if (scene) {
    const l = 0.299 * scene[0] + 0.587 * scene[1] + 0.114 * scene[2];
    // A normally exposed picture averages about 0.42; darker than that dims the board.
    gain *= clamp(0.58 + l, 0.6, 1.08);
    if (l > 0.02) {
      cast = [
        1 + (clamp(scene[0] / l, 0.55, 1.6) - 1) * LIGHT_CAST,
        1 + (clamp(scene[1] / l, 0.55, 1.6) - 1) * LIGHT_CAST,
        1 + (clamp(scene[2] / l, 0.55, 1.6) - 1) * LIGHT_CAST,
      ];
    }
  }
  gain = clamp(gain, LIGHT_MIN_GAIN, LIGHT_MAX_GAIN);
  return [cast[0] * gain, cast[1] * gain, cast[2] * gain];
}

/** Move `cur` towards `target` over LIGHT_EASE_S (in place). */
export function easeLight(cur: Rgb, target: Readonly<Rgb>, dtS: number): Rgb {
  const k = !(dtS > 0) ? 0 : 1 - Math.exp(-dtS / LIGHT_EASE_S);
  cur[0] += (target[0] - cur[0]) * k;
  cur[1] += (target[1] - cur[1]) * k;
  cur[2] += (target[2] - cur[2]) * k;
  return cur;
}

/** `?wlight=0` switches it off (tester A/B). */
export function worldLightFrom(search: string): boolean {
  return new URLSearchParams(search).get('wlight') !== '0';
}
