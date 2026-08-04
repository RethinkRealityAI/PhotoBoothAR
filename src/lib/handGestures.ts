/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hand-gesture scoring — PURE logic (no three.js, no MediaPipe import), so
 * vitest (node env) exercises every band. handRig.ts feeds it HandLandmarker
 * results as plain arrays; the scores join the SAME map the trigger engine
 * already consumes (src/lib/studio/triggers.ts), keyed by the source names
 * themselves ('fistClench', 'palmOpen', …). ARKit blendshape categories are
 * `mouthSmileLeft`-style, so the namespaces cannot collide.
 *
 * Every signal is a RATIO of landmark distances, so it is invariant to hand
 * size, distance from camera, and video resolution. Landmark indices follow
 * MediaPipe's 21-point hand model: 0 wrist; per finger (MCP, PIP, DIP, TIP) =
 * thumb 1-4, index 5-8, middle 9-12, ring 13-16, pinky 17-20.
 */

import { HAND_TRIGGER_SOURCES } from './studio/triggers';

export interface HandPoint {
  x: number;
  y: number;
  z: number;
}

/** One detected hand: 21 normalized image-space points + 21 metric world points
 *  (metres, hand-centred, camera-aligned — see handPose.ts for the frame). */
export interface HandSample {
  landmarks: HandPoint[];
  world: HandPoint[];
}

/** The face keypoints the temple gesture needs, normalized image space.
 *  Stashed by faceRig.ts from the same detection loop. */
export interface FaceKeypoints {
  forehead: { x: number; y: number };
  chin: { x: number; y: number };
  leftEar: { x: number; y: number };
  rightEar: { x: number; y: number };
}

/** Screen-space anchor for a hand-emitted effect + what BeamFX needs. */
export interface HandAnchorSample {
  /** Normalized image coords of the firing point. Raw, UNMIRRORED. */
  originX: number;
  originY: number;
  /** Wrist→middle-MCP distance in normalized units — the depth/scale proxy. */
  spanNorm: number;
  /** Unit palm normal in the hand's METRIC world frame (out of the palm). */
  normal: [number, number, number];
}

const FINGERS = [
  { mcp: 5, pip: 6, tip: 8 }, // index
  { mcp: 9, pip: 10, tip: 12 }, // middle
  { mcp: 13, pip: 14, tip: 16 }, // ring
  { mcp: 17, pip: 18, tip: 20 }, // pinky
] as const;

const FINGERTIPS = [4, 8, 12, 16, 20] as const;

/** Zero for every key — returned whole so a lost hand decays EVERY channel
 *  instead of latching the last score (mirrors faceRig's fresh-stash rule). */
function zeroScores(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of HAND_TRIGGER_SOURCES) out[k] = 0;
  return out;
}

/** Anything with normalized image coords — hand landmarks AND face keypoints. */
interface Pt2 {
  x: number;
  y: number;
}

/**
 * Distance in units of image HEIGHT.
 *
 * Normalized landmark coords are (x/W, y/H), so a bare hypot mixes two pixel
 * scales: on a 720×1280 portrait feed 0.1 in x is 72px while 0.1 in y is 128px
 * — every x-distance was over-weighted by H/W = 1.78, biasing every ratio below
 * toward whichever axis the gesture happens to lie along. Scaling x by
 * `ax` = W/H restores an isotropic metric (and makes the ratios genuinely
 * resolution-independent, which the file header already claims).
 *
 * ax = 1 is the square-image case and the default, so a caller that has no
 * frame size yet degrades to the old behaviour instead of to nonsense.
 */
function dist2d(a: Pt2, b: Pt2, ax = 1): number {
  return Math.hypot((a.x - b.x) * ax, a.y - b.y);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function validHand(h: HandSample | null | undefined): h is HandSample {
  if (!h || !Array.isArray(h.landmarks) || h.landmarks.length < 21) return false;
  for (const p of h.landmarks) {
    if (!p || !isFinite(p.x) || !isFinite(p.y)) return false;
  }
  return true;
}

/** Extension ratio |TIP−W| / |MCP−W|: ≈2 fully extended, ≈0.8 fully curled.
 *  Both terms scale with hand size AND camera distance, so the ratio is free.
 *  Robust to foreshortening too: a finger curling toward the lens pulls its
 *  projected tip back past its own knuckle, which is what makes ≈0.8 the fist
 *  reading rather than an artefact of the projection. */
function extensionRatio(l: HandPoint[], mcp: number, tip: number, ax: number): number {
  const base = dist2d(l[mcp], l[0], ax);
  if (base < 1e-6) return 0;
  return dist2d(l[tip], l[0], ax) / base;
}

function extended(l: HandPoint[], f: (typeof FINGERS)[number], ax: number): number {
  return smoothstep(1.15, 1.75, extensionRatio(l, f.mcp, f.tip, ax));
}

function curled(l: HandPoint[], f: (typeof FINGERS)[number], ax: number): number {
  return 1 - smoothstep(0.95, 1.45, extensionRatio(l, f.mcp, f.tip, ax));
}

/* — tuned bands (all ratios are in units of image height, post-aspect) ------ *
 *
 * PINCH separation |tip4 − tip8| over the palm base |mcp5 − wrist| (≈88mm on an
 * adult hand). A firm pinch measures 12-18mm of separation → ratio 0.14-0.20;
 * ~28mm apart (ratio 0.32) is the loosest pose anyone would still call a pinch.
 * 1 − smoothstep(0.20, 0.45) maps 0.14-0.20 → 1.0 and 0.32 → 0.60, exactly the
 * engine's `enter` for pinch, so the band and the threshold agree by
 * construction. An open hand (thumb tip ≈100mm from the index tip, ratio >1.1)
 * scores 0.
 */
const PINCH_NEAR = 0.2;
const PINCH_FAR = 0.45;
/*
 * PINCH curl guard. The shipped gate multiplied by extended() —
 * smoothstep(1.15, 1.75) on the extension ratio — which demands a STRAIGHT
 * index, while a pinch necessarily FLEXES it: a real pinch projects an
 * extension ratio of ≈1.37, scoring 0.30 on that band, so `pinch` could not
 * reach its 0.60 enter threshold at ANY human pose (measured against the real
 * module: firm 0.029, loose 0.552, anatomically-impossible max reach 0.848).
 * The guard only has to exclude a CLOSED fist, whose index tip projects back
 * past its own knuckle (ratio ≈0.74-0.82); (0.95, 1.20) clears 0.82 → 0 and
 * 1.37 → 1 with margin at both ends.
 * Rejected alternative |tip8 − mcp5| / |pip6 − mcp5| ("the tip is out past the
 * PIP"): a fist curls the finger toward the LENS, so the projected |pip6 − mcp5|
 * collapses to a few mm and the ratio explodes to ≈3.5 — it passes a fist.
 */
const PINCH_UNCURLED_LO = 0.95;
const PINCH_UNCURLED_HI = 1.2;
/*
 * PALM spread |tip8 − tip20| over the knuckle span |mcp5 − mcp17| (≈75mm).
 * Fingers held TOGETHER already put the tips ≈78mm apart (ratio ≈1.04) because
 * the fingers are longer than the palm is wide — so the shipped (0.55, 0.95)
 * band saturated at 1 for every hand in every pose and contributed nothing (a
 * flat chop scored as an open palm, the exact case the term was added for).
 * A fanned palm measures ≈116mm (ratio ≈1.54): (0.9, 1.4) scores that 1.0 and
 * the chop 0.19.
 */
const SPREAD_LO = 0.9;
const SPREAD_HI = 1.4;

/** Per-hand raw scores. Exported for tests; callers use handGestureScores.
 *  `aspect` is the video's W/H — see dist2d; every ratio below is isotropic
 *  only when it is passed. */
export function scoreOneHand(
  hand: HandSample,
  face: FaceKeypoints | null,
  aspect = 1,
): Record<string, number> {
  const l = hand.landmarks;
  const out = zeroScores();
  const ax = isFinite(aspect) && aspect > 0 ? aspect : 1;

  const handSpan = dist2d(l[0], l[9], ax); // wrist → middle MCP
  const knuckleSpan = dist2d(l[5], l[17], ax); // index MCP → pinky MCP
  const palmBase = dist2d(l[5], l[0], ax); // index MCP → wrist (≈88mm)
  if (handSpan < 1e-6 || knuckleSpan < 1e-6 || palmBase < 1e-6) return out;

  const ext = FINGERS.map((f) => extended(l, f, ax));
  const curl = FINGERS.map((f) => curled(l, f, ax));

  // fist: ALL four fingers curled (min, so three-and-a-thumb never counts) AND
  // the thumb tucked across (thumb tip near the pinky MCP relative to palm width).
  const thumbTucked = 1 - smoothstep(0.9, 1.4, dist2d(l[4], l[17], ax) / knuckleSpan);
  out.fistClench = Math.min(...curl) * thumbTucked;

  // open palm: ALL four extended AND spread (index tip far from pinky tip) —
  // the spread term separates a palm from a flat karate chop.
  const spread = smoothstep(SPREAD_LO, SPREAD_HI, dist2d(l[8], l[20], ax) / knuckleSpan);
  out.palmOpen = Math.min(...ext) * spread;

  // pinch: thumb tip meets index tip, over the palm base; gated only on the
  // index not being CURLED INTO A FIST (see the PINCH_* notes — gating on a
  // straight index made the gesture unreachable, since pinching bends it).
  const pinchGap = dist2d(l[4], l[8], ax) / palmBase;
  const indexUncurled = smoothstep(PINCH_UNCURLED_LO, PINCH_UNCURLED_HI, extensionRatio(l, 5, 8, ax));
  out.pinch = (1 - smoothstep(PINCH_NEAR, PINCH_FAR, pinchGap)) * indexUncurled;

  // peace: index+middle out, ring+pinky curled, with a visible V gap.
  const vGap = smoothstep(0.25, 0.6, dist2d(l[8], l[12], ax) / handSpan);
  out.peaceSign = Math.min(ext[0], ext[1]) * Math.min(curl[2], curl[3]) * vGap;

  // hand-to-temple (the Cyclops move, math from the PlayCanvas reference):
  // any fingertip close to either ear anchor, thresholds scaled by face height,
  // with the reference's hand-size sanity gate (0.2–1.1× face height) so a hand
  // NEAR the camera passing over the face doesn't fire.
  if (face) {
    // Same isotropic metric as every other distance here — the face-height
    // denominator is near-vertical while an ear-to-fingertip vector is often
    // near-horizontal, so an uncorrected pair compared two different units.
    const faceH = dist2d(face.forehead, face.chin, ax);
    if (faceH > 1e-6) {
      const sizeOk = handSpan / faceH;
      if (sizeOk >= 0.2 && sizeOk <= 1.1) {
        let best = Infinity;
        for (const t of FINGERTIPS) {
          for (const ear of [face.leftEar, face.rightEar]) {
            const d = dist2d(l[t], ear, ax);
            if (d < best) best = d;
          }
        }
        // enter 0.30× / exit 0.45× face height in the reference; as a continuous
        // score that band maps to smoothstep edges (engine hysteresis re-splits it).
        out.handToTemple = 1 - smoothstep(0.28, 0.48, best / faceH);
      }
    }
  }

  return out;
}

/**
 * Gesture scores 0..1 across all detected hands (max per key — either hand may
 * fire). Empty/short/NaN input → all-zero map with every key present, never a
 * partial map and never a throw.
 */
export function handGestureScores(
  hands: readonly (HandSample | null | undefined)[],
  face: FaceKeypoints | null = null,
  aspect = 1,
): Record<string, number> {
  const out = zeroScores();
  for (const hand of hands) {
    if (!validHand(hand)) continue;
    const s = scoreOneHand(hand, face, aspect);
    for (const k of HAND_TRIGGER_SOURCES) {
      if (s[k] > out[k]) out[k] = s[k];
    }
  }
  return out;
}

/**
 * The firing point + depth/direction data for a hand-emitted effect, from the
 * strongest-scoring hand (ties → the larger/closer hand). Null when no valid
 * hand is in frame.
 */
export function handAnchor(
  hands: readonly (HandSample | null | undefined)[],
  face: FaceKeypoints | null = null,
  aspect = 1,
): HandAnchorSample | null {
  const ax = isFinite(aspect) && aspect > 0 ? aspect : 1;
  let best: { hand: HandSample; strength: number; span: number } | null = null;
  for (const hand of hands) {
    if (!validHand(hand)) continue;
    const s = scoreOneHand(hand, face, aspect);
    let strength = 0;
    for (const k of HAND_TRIGGER_SOURCES) if (s[k] > strength) strength = s[k];
    // spanNorm is consumed by estimateHandDepthCm, whose pinhole derivation is
    // stated in units of image HEIGHT (beam.ts:252) — so it takes the same
    // aspect correction; the raw hypot was mixing width- and height-normalized
    // components into a value that formula reads as height-normalized.
    const span = dist2d(hand.landmarks[0], hand.landmarks[9], ax);
    if (
      best === null ||
      strength > best.strength ||
      (strength === best.strength && span > best.span)
    ) {
      best = { hand, strength, span };
    }
  }
  if (best === null) return null;

  const l = best.hand.landmarks;
  // Firing point: the knuckle centroid — stable for a fist AND a palm, and the
  // natural muzzle for a gauntlet blast; close enough to the tip for a pinch.
  const ox = (l[5].x + l[9].x + l[13].x + l[17].x) / 4;
  const oy = (l[5].y + l[9].y + l[13].y + l[17].y) / 4;

  // Palm normal from the METRIC world landmarks (screen z is wrist-relative and
  // unitless — never build a basis from it). cross(index−wrist, pinky−wrist).
  let normal: [number, number, number] = [0, 0, -1];
  const w = best.hand.world;
  if (Array.isArray(w) && w.length >= 21) {
    const ax = w[5].x - w[0].x;
    const ay = w[5].y - w[0].y;
    const az = w[5].z - w[0].z;
    const bx = w[17].x - w[0].x;
    const by = w[17].y - w[0].y;
    const bz = w[17].z - w[0].z;
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    const len = Math.hypot(cx, cy, cz);
    if (len > 1e-9 && isFinite(len)) normal = [cx / len, cy / len, cz / len];
  }

  return { originX: ox, originY: oy, spanNorm: best.span, normal };
}
