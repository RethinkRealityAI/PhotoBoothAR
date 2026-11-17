/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 8th Wall face mesh -> the ONLY MediaPipe/ARKit blendshape categories Beamwall's
 * triggers read (triggers.ts sourceSignal: smile, mouthOpen, wink, browRaise).
 * 8th Wall has no blendshapes; these are geometric features of its mesh, mapped
 * onto MediaPipe's score scale. PURE, no allocation per call.
 *
 * Input is the mesh in the contract head frame (canonical cm, +X subject's left,
 * +Y up; xr8Pose.xr8LocalToHeadCm), so every feature is pose-invariant. All
 * lengths are divided by the eye-corner distance (iod = |v33 - v263|).
 *
 * What is CALIBRATED vs EXTRAPOLATED (spike: MediaPipe and 8th Wall on the same
 * frames, 11 clips, 7 faces — see xr8Expressions.test.ts for the per-clip check):
 *  - mouthSmileLeft/Right: least-squares fit on 9 clips, both sides
 *    (smile = b0 + b1·mouthWidth + b2·cornerLift), within ~0.15 of MediaPipe on
 *    10/11 clips. FAILS on one clip (friend, hand near the mouth): 0.42 vs 0.92.
 *  - jawOpen: linear in the lip gap; calibrated up to gap 0.46 iod (MediaPipe
 *    0.27-0.44 there). Everything above ~0.45 — including the trigger's enter
 *    level 0.5 — is EXTRAPOLATED from one wide-open data point.
 *  - eyeBlinkLeft/Right: piecewise in the lid aperture. Calibrated for OPEN and
 *    SQUINTING eyes only (aperture 0.17-0.35); no closed-eye footage existed, so
 *    the closed end (score 1 at aperture <= 0.06) is EXTRAPOLATED.
 *  - browInnerUp/browOuterUpLeft/Right: no raised-brow footage existed, so these
 *    are BASELINE-RELATIVE (rise above the face's own rest pose), and the gain
 *    (BROW_FULL_RAISE_IOD) is EXTRAPOLATED. A rest face scores 0 by construction.
 *
 * 8th Wall's own booleans are NOT used: they are thresholds on these same mesh
 * vertices (engine reality/engine/faces/tracked-face-state.cc:146-155), so they
 * add no information, and measured on real frames they are wrong as floors —
 * `mouthOpen` fires on closed-lip smiles and laughs, `eyebrowRaised` compares to
 * the FIRST frame's brows (:121-127, the engine's own TODO says it is fooled),
 * and the eye-open threshold (lid 0.034 local units) sits only 6 % below a
 * laughing squint (0.0362) that MediaPipe scores 0.30, so a 0.9 floor there
 * would turn an asymmetric squint into a wink.
 *
 * Sides: Left = the subject's left (+X), the same as MediaPipe here and as 8th
 * Wall's own naming (c8/geometry/facemesh-data.h:26 FACEMESH_UPPER_L_EYE = 386).
 */

/** The categories emitted — exactly the ones triggers.ts reads. */
export const XR8_EXPRESSION_CATEGORIES = [
  'mouthSmileLeft', 'mouthSmileRight', 'jawOpen', 'eyeBlinkLeft', 'eyeBlinkRight',
  'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
] as const;
export type Xr8ExpressionCategory = (typeof XR8_EXPRESSION_CATEGORIES)[number];

/** smile = SMILE_B0 + SMILE_B1·mouthWidth/iod + SMILE_B2·cornerLift/iod (fit, see header). */
export const SMILE_B0 = -0.8874;
export const SMILE_B1 = 2.1235;
export const SMILE_B2 = 2.2413;
/** jawOpen = (gap/iod − JAW_GAP_REST)·JAW_GAIN. */
export const JAW_GAP_REST = 0.15;
export const JAW_GAIN = 1.157;
/** Brow rise above rest (in iod) that scores 1.0 — EXTRAPOLATED. */
export const BROW_FULL_RAISE_IOD = 0.06;
/** Rest tracker: follows the brow DOWN fast, UP slowly, so it settles on the rest pose. */
export const BROW_BASE_DOWN_TAU_S = 0.25;
export const BROW_BASE_UP_TAU_S = 6;

/** Per-face state for the baseline-relative brow scores. Reset on face lost. */
export interface Xr8ExpressionState {
  primed: boolean;
  t: number;
  inner: number;
  outerL: number;
  outerR: number;
}

export function createXr8ExpressionState(): Xr8ExpressionState {
  return { primed: false, t: 0, inner: 0, outerL: 0, outerR: 0 };
}

export function resetXr8ExpressionState(s: Xr8ExpressionState): void {
  s.primed = false;
  s.t = 0;
  s.inner = 0;
  s.outerL = 0;
  s.outerR = 0;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Lid aperture (lid gap / eye width) -> MediaPipe-scale blink score. */
export function blinkFromAperture(ap: number): number {
  if (ap >= 0.3) return clamp01((0.1 * (0.355 - ap)) / 0.055);
  if (ap >= 0.18) return 0.1 + 1.83 * (0.3 - ap);
  return clamp01(0.32 + 5.67 * (0.18 - ap));
}

/** Vertices read (all < 468, so any FACE mesh has them). */
const NEEDED = [13, 14, 33, 61, 70, 107, 133, 145, 159, 263, 291, 300, 336, 362, 374, 386] as const;

function dist(m: ArrayLike<number>, a: number, b: number): number {
  return Math.hypot(m[a * 3] - m[b * 3], m[a * 3 + 1] - m[b * 3 + 1], m[a * 3 + 2] - m[b * 3 + 2]);
}
const y = (m: ArrayLike<number>, i: number): number => m[i * 3 + 1];

function track(base: number, f: number, dt: number): number {
  const tau = f < base ? BROW_BASE_DOWN_TAU_S : BROW_BASE_UP_TAU_S;
  return base + (f - base) * (1 - Math.exp(-dt / tau));
}

/**
 * Writes the 8 categories into `out` and returns it; null (out untouched, state
 * untouched) when the mesh is too short or any needed vertex is non-finite.
 * `headCm` = flat x,y,z per vertex in the contract head frame; `t` in ms.
 */
export function xr8Expressions(
  headCm: ArrayLike<number>,
  t: number,
  state: Xr8ExpressionState,
  out: Record<string, number>,
): Record<string, number> | null {
  if (headCm.length < 387 * 3 || !Number.isFinite(t)) return null;
  for (const i of NEEDED) {
    if (!Number.isFinite(headCm[i * 3]) || !Number.isFinite(headCm[i * 3 + 1]) || !Number.isFinite(headCm[i * 3 + 2])) return null;
  }
  const iod = dist(headCm, 33, 263);
  if (!(iod > 1e-6)) return null;

  // Mouth.
  const width = dist(headCm, 61, 291) / iod;
  const mid = (y(headCm, 13) + y(headCm, 14)) / 2;
  const smile = (lift: number) => clamp01(SMILE_B0 + SMILE_B1 * width + SMILE_B2 * lift);
  out.mouthSmileLeft = smile((y(headCm, 291) - mid) / iod);
  out.mouthSmileRight = smile((y(headCm, 61) - mid) / iod);
  out.jawOpen = clamp01((dist(headCm, 13, 14) / iod - JAW_GAP_REST) * JAW_GAIN);

  // Eyes.
  const wL = dist(headCm, 362, 263), wR = dist(headCm, 33, 133);
  out.eyeBlinkLeft = wL > 1e-6 ? blinkFromAperture(dist(headCm, 386, 374) / wL) : 0;
  out.eyeBlinkRight = wR > 1e-6 ? blinkFromAperture(dist(headCm, 159, 145) / wR) : 0;

  // Brows, relative to this face's tracked rest pose.
  const inner = (y(headCm, 107) - y(headCm, 133) + (y(headCm, 336) - y(headCm, 362))) / 2 / iod;
  const outerL = (y(headCm, 300) - y(headCm, 263)) / iod;
  const outerR = (y(headCm, 70) - y(headCm, 33)) / iod;
  if (!state.primed) {
    state.primed = true;
    state.inner = inner;
    state.outerL = outerL;
    state.outerR = outerR;
    out.browInnerUp = 0;
    out.browOuterUpLeft = 0;
    out.browOuterUpRight = 0;
  } else {
    const dt = Math.min(0.5, Math.max(0, (t - state.t) / 1000));
    out.browInnerUp = clamp01((inner - state.inner) / BROW_FULL_RAISE_IOD);
    out.browOuterUpLeft = clamp01((outerL - state.outerL) / BROW_FULL_RAISE_IOD);
    out.browOuterUpRight = clamp01((outerR - state.outerR) / BROW_FULL_RAISE_IOD);
    state.inner = track(state.inner, inner, dt);
    state.outerL = track(state.outerL, outerL, dt);
    state.outerR = track(state.outerR, outerR, dt);
  }
  state.t = t;
  return out;
}
