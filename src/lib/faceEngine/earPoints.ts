/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Where a guest's EAR LOBES are, in the contract head frame (canonical cm).
 * PURE: no DOM, no three.js.
 *
 * WHY. The ear anchors used to be two fixed points measured on the edge of the
 * canonical FACE mesh (±7.5, −2.9, −1.5). The face mesh stops at the cheek: a
 * real lobe sits about 2.5cm further BACK and ~0.7cm further OUT, so earrings
 * hung on the jaw in front of the ear, and on a turned head the far one floated
 * in the air beside the face instead of going behind it.
 *
 * 8th Wall ships a dedicated ear model (`enableEars`) that reports three points
 * per ear — lobe, canal, helix — each with found/lost. Measured on 8 faces
 * (still clips, software GL), in this frame:
 *   lobe   x ±7.4..8.7   y −1.6..−3.4   z −3.6..−4.3     (found on 5 of 8 faces'
 *   canal  x ±8.3..9.3   y −1.0..+1.9   z −3.5..−4.2      visible ears; long hair
 *                                                          hides both)
 * and the face mesh's own `leftEar/rightEar` attachment point (the face EDGE,
 * always available) sits 0.36..1.1cm inside the lobe (mean 0.77).
 *
 * THE KEY FACT: an ear does not move relative to the skull. So a lobe is not
 * tracked per frame — every sighting refines a per-session average in head
 * space. That is jitter-free, and it survives the ear being hidden (a turned
 * head, hair swinging across): once seen, it is known.
 *
 * Preference per side, best first:
 *   1. the averaged tracked LOBE
 *   2. the averaged tracked CANAL plus the measured canal→lobe step
 *   3. the OTHER ear's estimate (1 or 2), reflected — heads are near-symmetric
 *   4. the face edge + the measured edge→lobe step (per-face width, no ear seen)
 *   5. EAR_LOBE_DEFAULT (no 8th Wall at all: MediaPipe mode / fallback / studio)
 */

export type EarVec = [number, number, number];

/** Median measured lobe, subject's LEFT (+x). The right ear is the reflection. */
export const EAR_LOBE_DEFAULT: Readonly<EarVec> = [8.2, -2.3, -3.9];
/** lobe − canal, measured (x is toward the head centre, so it is applied by side). */
export const CANAL_TO_LOBE: Readonly<EarVec> = [-0.35, -1.9, 0];
/** |lobe.x| − |faceEdge.x|, measured mean. */
export const EDGE_TO_LOBE_X = 0.77;

/** A point outside this box (left-ear convention, x > 0) is a mis-detection, not an ear. */
const MIN: Readonly<EarVec> = [5.5, -7, -9];
const MAX: Readonly<EarVec> = [12, 5, 1];
/** Sightings averaged exactly (cumulative mean) before it becomes a slow EMA. */
const WARM_SAMPLES = 24;
const EMA_ALPHA = 1 / WARM_SAMPLES;
/** A face gone this long is a new guest: forget the ears. */
export const EAR_FORGET_AFTER_MS = 1500;

export type EarSource = 'lobe' | 'canal' | 'mirrored' | 'edge' | 'default';

export interface EarSideObservation {
  /** Head-frame cm, or null when 8th Wall did not find the point this frame. */
  lobe: EarVec | null;
  canal: EarVec | null;
  /** The face mesh's ear attachment point (face edge); null when unavailable. */
  edge: EarVec | null;
}

interface Avg { v: EarVec; n: number }
interface Side { lobe: Avg; canal: Avg; edge: Avg }

export interface EarState {
  left: Side;
  right: Side;
  /** Time of the last observation; NaN before the first. */
  lastT: number;
}

export interface EarEstimate {
  left: EarVec;
  right: EarVec;
  leftSource: EarSource;
  rightSource: EarSource;
}

const avg = (): Avg => ({ v: [0, 0, 0], n: 0 });
const side = (): Side => ({ lobe: avg(), canal: avg(), edge: avg() });

export function createEarState(): EarState {
  return { left: side(), right: side(), lastT: Number.NaN };
}

export function resetEarState(s: EarState): void {
  for (const sd of [s.left, s.right]) for (const a of [sd.lobe, sd.canal, sd.edge]) a.n = 0;
  s.lastT = Number.NaN;
}

/** A finite point inside the plausible ear box for its side (sign = +1 left, −1 right). */
function plausible(p: EarVec | null, sign: number): p is EarVec {
  if (!p) return false;
  const x = p[0] * sign;
  if (!Number.isFinite(x) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) return false;
  return x >= MIN[0] && x <= MAX[0] && p[1] >= MIN[1] && p[1] <= MAX[1] && p[2] >= MIN[2] && p[2] <= MAX[2];
}

function accumulate(a: Avg, p: EarVec): void {
  a.n = Math.min(a.n + 1, WARM_SAMPLES);
  const k = a.n < WARM_SAMPLES ? 1 / a.n : EMA_ALPHA;
  a.v[0] += (p[0] - a.v[0]) * k;
  a.v[1] += (p[1] - a.v[1]) * k;
  a.v[2] += (p[2] - a.v[2]) * k;
}

/**
 * Fold one frame's sightings into the session averages. `t` is the sample time
 * (performance.now() ms); a gap longer than EAR_FORGET_AFTER_MS starts over.
 */
export function observeEars(s: EarState, t: number, left: EarSideObservation, right: EarSideObservation): void {
  if (Number.isFinite(s.lastT) && t - s.lastT > EAR_FORGET_AFTER_MS) resetEarState(s);
  s.lastT = t;
  const fold = (sd: Side, o: EarSideObservation, sign: number) => {
    if (plausible(o.lobe, sign)) accumulate(sd.lobe, o.lobe);
    if (plausible(o.canal, sign)) accumulate(sd.canal, o.canal);
    // The face edge is not an ear: only its x (face half-width) is range-checked.
    if (o.edge && Number.isFinite(o.edge[0]) && o.edge[0] * sign > 4 && o.edge[0] * sign < 11) accumulate(sd.edge, o.edge);
  };
  fold(s.left, left, 1);
  fold(s.right, right, -1);
}

/** A side's own estimate from tracked ear points, or null when its ear was never seen. */
function own(sd: Side, sign: number): { v: EarVec; source: EarSource } | null {
  if (sd.lobe.n > 0) return { v: [sd.lobe.v[0], sd.lobe.v[1], sd.lobe.v[2]], source: 'lobe' };
  if (sd.canal.n > 0) {
    return {
      v: [sd.canal.v[0] + CANAL_TO_LOBE[0] * sign, sd.canal.v[1] + CANAL_TO_LOBE[1], sd.canal.v[2] + CANAL_TO_LOBE[2]],
      source: 'canal',
    };
  }
  return null;
}

function fallback(sd: Side, sign: number): { v: EarVec; source: EarSource } {
  if (sd.edge.n > 0) {
    return { v: [(Math.abs(sd.edge.v[0]) + EDGE_TO_LOBE_X) * sign, EAR_LOBE_DEFAULT[1], EAR_LOBE_DEFAULT[2]], source: 'edge' };
  }
  return { v: [EAR_LOBE_DEFAULT[0] * sign, EAR_LOBE_DEFAULT[1], EAR_LOBE_DEFAULT[2]], source: 'default' };
}

/** The current best lobe position per side (always defined — see the preference list above). */
export function estimateEars(s: EarState | null): EarEstimate {
  const l = s ? own(s.left, 1) : null;
  const r = s ? own(s.right, -1) : null;
  const mirror = (o: { v: EarVec }): { v: EarVec; source: EarSource } => ({ v: [-o.v[0], o.v[1], o.v[2]], source: 'mirrored' });
  const left = l ?? (r ? mirror(r) : s ? fallback(s.left, 1) : fallback(side(), 1));
  const right = r ?? (l ? mirror(l) : s ? fallback(s.right, -1) : fallback(side(), -1));
  return { left: left.v, right: right.v, leftSource: left.source, rightSource: right.source };
}
