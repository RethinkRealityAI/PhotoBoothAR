/**
 * World mode, part 5: keep the placed Frame glued to the floor with the
 * camera picture itself.
 *
 * Motion sensors alone know how the phone TURNED, not where it MOVED, and
 * their idea of the camera's field of view is a guess. Either error makes a
 * placed object slide a little against the room as the phone moves. This
 * watches a few small patches of the real floor next to the Frame's feet and
 * measures where they actually went in the picture; WorldStage turns the gap
 * between "where the sensors say" and "where the floor really is" into a small
 * correction, so the Frame stays on the patch of floor it was placed on.
 *
 * Plain block matching (sum of absolute differences) on a small greyscale
 * copy of the frame: no libraries, a fraction of a millisecond per patch.
 * Pure, so it is unit-tested in node.
 */

/** Greyscale (0..255) from RGBA pixels. */
export function toGray(rgba: Uint8ClampedArray, w: number, h: number, out?: Float32Array): Float32Array {
  const g = out && out.length === w * h ? out : new Float32Array(w * h);
  for (let i = 0, k = 0; i < w * h; i++, k += 4) g[i] = rgba[k] * 0.299 + rgba[k + 1] * 0.587 + rgba[k + 2] * 0.114;
  return g;
}

export interface Patch {
  size: number;
  /** size*size grey values, mean removed (so a lighting change does not break the match). */
  data: Float32Array;
  /** Standard deviation of the patch: low = blank floor, nothing to lock onto. */
  std: number;
}

/** The size×size patch centred on (cx, cy), or null if it does not fit inside the image. */
export function grabPatch(gray: Float32Array, w: number, h: number, cx: number, cy: number, size: number): Patch | null {
  const half = size >> 1;
  const x0 = Math.round(cx) - half, y0 = Math.round(cy) - half;
  if (x0 < 0 || y0 < 0 || x0 + size > w || y0 + size > h) return null;
  const data = new Float32Array(size * size);
  let sum = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = gray[(y0 + y) * w + x0 + x];
    data[y * size + x] = v;
    sum += v;
  }
  const mean = sum / (size * size);
  let sq = 0;
  for (let i = 0; i < data.length; i++) { data[i] -= mean; sq += data[i] * data[i]; }
  return { size, data, std: Math.sqrt(sq / data.length) };
}

export interface Match {
  /** Sub-pixel centre of the best match. */
  x: number;
  y: number;
  /** Mean absolute difference per pixel at the best match, relative to the patch's std (lower = better). */
  error: number;
  /** Best error / the best error found at least 3 px away (lower = more distinctive; near 1 = ambiguous). */
  ambiguity: number;
}

/**
 * Search for `patch` around (px, py) within ±radius pixels. Returns null when
 * the search window leaves the image.
 */
export function matchPatch(
  gray: Float32Array, w: number, h: number, patch: Patch, px: number, py: number, radius: number,
): Match | null {
  const size = patch.size, half = size >> 1;
  const cx = Math.round(px), cy = Math.round(py);
  const side = radius * 2 + 1;
  const scores = new Float32Array(side * side).fill(Infinity);
  let best = Infinity, bx = 0, by = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    const y0 = cy + dy - half;
    if (y0 < 0 || y0 + size > h) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const x0 = cx + dx - half;
      if (x0 < 0 || x0 + size > w) continue;
      let sum = 0;
      for (let y = 0; y < size; y++) { const row = (y0 + y) * w + x0; for (let x = 0; x < size; x++) sum += gray[row + x]; }
      const mean = sum / (size * size);
      let sad = 0;
      for (let y = 0; y < size; y++) {
        const row = (y0 + y) * w + x0, prow = y * size;
        for (let x = 0; x < size; x++) sad += Math.abs(gray[row + x] - mean - patch.data[prow + x]);
      }
      // Every score is computed in full (no early exit): the sub-pixel step and
      // the ambiguity check read the neighbours' scores.
      scores[(dy + radius) * side + dx + radius] = sad;
      if (sad < best) { best = sad; bx = dx; by = dy; }
    }
  }
  if (!Number.isFinite(best)) return null;
  // Best score at least 3 px away from the winner: how unique the match is.
  let second = Infinity;
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) {
    if (Math.max(Math.abs(i - radius - bx), Math.abs(j - radius - by)) < 3) continue;
    const s = scores[j * side + i];
    if (s < second) second = s;
  }
  // Parabolic sub-pixel refinement on each axis.
  const at = (dx: number, dy: number) => {
    if (Math.abs(dx) > radius || Math.abs(dy) > radius) return Infinity;
    return scores[(dy + radius) * side + dx + radius];
  };
  const refine = (m: number, c: number, p: number) => {
    if (!Number.isFinite(m) || !Number.isFinite(p)) return 0;
    const den = m - 2 * c + p;
    return den > 1e-6 ? Math.max(-0.5, Math.min(0.5, (m - p) / (2 * den))) : 0;
  };
  const sx = refine(at(bx - 1, by), best, at(bx + 1, by));
  const sy = refine(at(bx, by - 1), best, at(bx, by + 1));
  const n = size * size;
  return {
    x: cx + bx + sx,
    y: cy + by + sy,
    error: best / n / Math.max(1, patch.std),
    ambiguity: Number.isFinite(second) && second > 0 ? best / second : 1,
  };
}

/** A patch worth tracking: textured enough to lock onto. */
export const MIN_PATCH_STD = 7;
/** A match worth trusting. */
export const MAX_MATCH_ERROR = 0.75;
export const MAX_AMBIGUITY = 0.8;

export function goodMatch(m: Match | null): m is Match {
  return m !== null && m.error <= MAX_MATCH_ERROR && m.ambiguity <= MAX_AMBIGUITY;
}

/** Median of a small list (robust to one patch a guest is standing on). */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
