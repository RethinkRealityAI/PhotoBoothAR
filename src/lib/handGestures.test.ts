import { describe, expect, it } from 'vitest';
import {
  handAnchor,
  handGestureScores,
  scoreOneHand,
  type FaceKeypoints,
  type HandPoint,
  type HandSample,
} from './handGestures';
import { HAND_TRIGGER_SOURCES } from './studio/triggers';

/* — anatomical 21-point rigs ------------------------------------------------ *
 * The previous fixtures placed landmarks by eye, which hid a real bug: the old
 * `pinchHand()` put the thumb tip ON a FULLY EXTENDED index tip, a pose no hand
 * can make (pinching necessarily flexes the index), so `pinch` tested green
 * while scoring 0.03-0.55 on every real pinch. These are built from adult hand
 * measurements instead, forward-kinematically, so a fixture can only represent
 * a pose a hand can actually hold.
 *
 * Frame: millimetres in an ISOTROPIC space (y down, so "up the screen" is −y),
 * wrist at the origin, scaled by MM into image-height units and finally placed
 * into a frame of a given aspect by `toFrame` — which is what lets one pose be
 * scored at 9:16, 1:1 and 16:9 and be asserted identical.
 *
 * Flexion model: a finger flexes in the plane containing its axis and the
 * CAMERA axis (palm toward the lens), so segment i projects to
 * length_i · cos(cumulative flex) along the finger's in-image direction. That
 * is why a fist's tip lands BELOW its own knuckle (cos 180° = −1) — the
 * foreshortening that makes the extension ratio ≈0.8 for a fist and ≈2.0 for a
 * straight finger, which is what every band in handGestures.ts is tuned against.
 */

const p = (x: number, y: number, z = 0): HandPoint => ({ x, y, z });

/** Image-height units per millimetre — an 89mm palm spans 0.22 of the frame. */
const MM = 0.0025;
const WRIST: [number, number] = [0.5, 0.85];
const DEG = Math.PI / 180;

/** [MCP xy (mm, wrist-relative)], [phalanx lengths], landmark indices. */
const FINGER_RIG = {
  index: { mcp: [38, -80], len: [45, 25, 20], idx: [5, 6, 7, 8] },
  middle: { mcp: [13, -88], len: [50, 30, 22], idx: [9, 10, 11, 12] },
  ring: { mcp: [-12, -85], len: [45, 27, 20], idx: [13, 14, 15, 16] },
  pinky: { mcp: [-37, -75], len: [35, 20, 18], idx: [17, 18, 19, 20] },
} as const;
type FingerName = keyof typeof FINGER_RIG;

/** Joint flexion in degrees at [MCP, PIP, DIP]. */
const STRAIGHT: [number, number, number] = [0, 0, 0];
const RELAXED: [number, number, number] = [25, 30, 15];
const LOOSE: [number, number, number] = [30, 35, 20];
const PINCHING: [number, number, number] = [40, 45, 10]; // index tip ~35mm past the knuckle
const CLENCHED: [number, number, number] = [80, 100, 60]; // tip projects BELOW the knuckle

interface PoseSpec {
  /** Per-finger [lateral fan°, flexion]. */
  fingers: Record<FingerName, { fan: number; flex: [number, number, number] }>;
  /** Thumb chain CMC→MCP→IP→TIP in mm, wrist-relative. */
  thumb: [number, number][];
  /** Whole-hand translation in mm. */
  shift?: [number, number];
  /** Uniform scale about the wrist (the size-gate case). */
  scale?: number;
}

function buildPose(spec: PoseSpec): HandPoint[] {
  const mm: [number, number][] = new Array(21).fill(null).map(() => [0, 0] as [number, number]);
  mm[0] = [0, 0];
  const thumbIdx = [1, 2, 3, 4];
  spec.thumb.forEach((t, i) => { mm[thumbIdx[i]] = [t[0], t[1]]; });
  for (const name of Object.keys(FINGER_RIG) as FingerName[]) {
    const rig = FINGER_RIG[name];
    const { fan, flex } = spec.fingers[name];
    const ux = Math.sin(fan * DEG);
    const uy = -Math.cos(fan * DEG);
    let x = rig.mcp[0];
    let y = rig.mcp[1];
    mm[rig.idx[0]] = [x, y];
    let cum = 0;
    for (let i = 0; i < 3; i++) {
      cum += flex[i];
      const proj = rig.len[i] * Math.cos(cum * DEG); // weak-perspective foreshortening
      x += ux * proj;
      y += uy * proj;
      mm[rig.idx[i + 1]] = [x, y];
    }
  }
  const k = spec.scale ?? 1;
  const [sx, sy] = spec.shift ?? [0, 0];
  return mm.map(([x, y]) => p(WRIST[0] + (x * k + sx) * MM, WRIST[1] + (y * k + sy) * MM));
}

const allFingers = (fan: [number, number, number, number], flex: [number, number, number]) => ({
  index: { fan: fan[0], flex },
  middle: { fan: fan[1], flex },
  ring: { fan: fan[2], flex },
  pinky: { fan: fan[3], flex },
});

/** Thumb abducted out to the side — the resting/open position. */
const THUMB_OUT: [number, number][] = [[45, -30], [70, -50], [85, -65], [95, -75]];
/** Thumb wrapped across the front of the curled fingers. */
const THUMB_ACROSS: [number, number][] = [[42, -28], [45, -55], [28, -68], [10, -72]];
/** Thumb tip meeting a flexed index tip (~15mm apart). */
const THUMB_PINCH: [number, number][] = [[45, -30], [55, -60], [40, -90], [25, -108]];
/** Thumb holding the ring+pinky down for a peace sign. */
const THUMB_HOLD: [number, number][] = [[42, -28], [40, -52], [18, -66], [-5, -72]];

function worldPoints(): HandPoint[] {
  // Plausible metric layout (metres): palm facing the camera.
  const w: HandPoint[] = new Array(21).fill(null).map(() => p(0, 0, 0));
  w[0] = p(0, 0, 0);
  w[5] = p(0.025, -0.08, -0.005);
  w[9] = p(0.005, -0.085, -0.005);
  w[13] = p(-0.015, -0.08, -0.005);
  w[17] = p(-0.035, -0.07, 0);
  return w;
}

/** Place an isotropic pose into a frame of the given aspect (W/H): normalized x
 *  divides by it, because a physically square hand covers MORE normalized width
 *  in a narrow frame. scoreOneHand's `ax` term undoes exactly this. */
function toFrame(l: HandPoint[], aspect: number): HandPoint[] {
  return l.map((q) => p(0.5 + (q.x - 0.5) / aspect, q.y, q.z));
}

function sample(l: HandPoint[], aspect = 1): HandSample {
  return { landmarks: toFrame(l, aspect), world: worldPoints() };
}

export function openPalmHand(aspect = 1): HandSample {
  return sample(buildPose({ fingers: allFingers([10, 0, -8, -18], STRAIGHT), thumb: THUMB_OUT }), aspect);
}

/** Fingers straight but held TOGETHER — a karate chop, not an open palm. */
export function chopHand(aspect = 1): HandSample {
  return sample(buildPose({ fingers: allFingers([0, 0, 0, 0], STRAIGHT), thumb: THUMB_OUT }), aspect);
}

export function fistHand(aspect = 1): HandSample {
  return sample(buildPose({ fingers: allFingers([0, 0, 0, 0], CLENCHED), thumb: THUMB_ACROSS }), aspect);
}

/** A REAL pinch: the index flexes to bring its tip to the thumb tip (~15mm
 *  apart over an 88mm palm base = ratio 0.17); the other fingers stay relaxed. */
export function pinchHand(aspect = 1): HandSample {
  return sample(
    buildPose({
      fingers: {
        index: { fan: 0, flex: PINCHING },
        middle: { fan: 0, flex: RELAXED },
        ring: { fan: -8, flex: RELAXED },
        pinky: { fan: -14, flex: RELAXED },
      },
      thumb: THUMB_PINCH,
    }),
    aspect,
  );
}

export function peaceHand(aspect = 1): HandSample {
  return sample(
    buildPose({
      fingers: {
        index: { fan: 15, flex: STRAIGHT },
        middle: { fan: -10, flex: STRAIGHT },
        ring: { fan: -8, flex: CLENCHED },
        pinky: { fan: -18, flex: CLENCHED },
      },
      thumb: THUMB_HOLD,
    }),
    aspect,
  );
}

// Face sits in the upper half of frame, clear of the hand rigs' fingertips.
const FACE: FaceKeypoints = {
  forehead: { x: 0.5, y: 0.1 },
  chin: { x: 0.5, y: 0.42 },
  leftEar: { x: 0.35, y: 0.25 },
  rightEar: { x: 0.65, y: 0.25 },
};

function faceAt(aspect: number): FaceKeypoints {
  const f = (q: { x: number; y: number }) => ({ x: 0.5 + (q.x - 0.5) / aspect, y: q.y });
  return { forehead: f(FACE.forehead), chin: f(FACE.chin), leftEar: f(FACE.leftEar), rightEar: f(FACE.rightEar) };
}

/** A loosely-held hand raised to the ear — the Cyclops move. Deliberately NOT
 *  a spread palm, so the pose tests one gesture at a time. */
export function templeHand(aspect = 1): HandSample {
  const l = buildPose({ fingers: allFingers([3, 0, -3, -8], LOOSE), thumb: THUMB_OUT });
  // shift the whole hand so the index tip lands just past the right ear anchor
  const dx = (FACE.rightEar.x + 0.01 - l[8].x) / MM;
  const dy = (FACE.rightEar.y + 0.01 - l[8].y) / MM;
  const shifted = l.map((q) => p(q.x + dx * MM, q.y + dy * MM, q.z));
  return sample(shifted, aspect);
}

/* — scores ------------------------------------------------------------------ */

describe('handGestureScores', () => {
  it('returns a complete all-zero map for empty input', () => {
    const s = handGestureScores([]);
    for (const k of HAND_TRIGGER_SOURCES) expect(s[k]).toBe(0);
    expect(Object.keys(s).sort()).toEqual([...HAND_TRIGGER_SOURCES].sort());
  });

  it('never throws and zeroes out on short or NaN landmarks', () => {
    const short: HandSample = { landmarks: [p(0.1, 0.1)], world: [] };
    const nan = openPalmHand();
    nan.landmarks[9] = p(NaN, 0.5);
    for (const bad of [short, nan, null, undefined]) {
      const s = handGestureScores([bad]);
      for (const k of HAND_TRIGGER_SOURCES) expect(s[k]).toBe(0);
    }
  });

  it('scores a fist high on fistClench and zero on palmOpen', () => {
    const s = handGestureScores([fistHand()]);
    expect(s.fistClench).toBeGreaterThan(0.9);
    expect(s.palmOpen).toBe(0);
    expect(s.peaceSign).toBe(0);
  });

  it('scores an open palm high on palmOpen and zero on fistClench', () => {
    const s = handGestureScores([openPalmHand()]);
    expect(s.palmOpen).toBeGreaterThan(0.9);
    expect(s.fistClench).toBe(0);
  });

  it('scores a REAL pinch — index flexed, tips ~15mm apart', () => {
    const s = handGestureScores([pinchHand()]);
    expect(s.pinch).toBeGreaterThan(0.9);
    const fist = handGestureScores([fistHand()]);
    expect(fist.pinch).toBe(0); // thumb near the index root in a fist must not pinch
  });

  it('pinch relaxes off as the fingers separate, and is dead by an open hand', () => {
    // Same rig, thumb tip walked away from the index tip along the palm base.
    const gapScore = (mm: number) => {
      const l = buildPose({
        fingers: {
          index: { fan: 0, flex: PINCHING },
          middle: { fan: 0, flex: RELAXED },
          ring: { fan: -8, flex: RELAXED },
          pinky: { fan: -14, flex: RELAXED },
        },
        thumb: [[45, -30], [55, -60], [40, -90], [25 - mm * 0.5, -108 + mm * 0.87]],
      });
      return handGestureScores([sample(l)]).pinch;
    };
    expect(gapScore(0)).toBeGreaterThan(0.9); // ~15mm apart
    expect(gapScore(30)).toBeLessThan(0.5); // ~45mm — no longer a pinch
    expect(handGestureScores([openPalmHand()]).pinch).toBe(0);
  });

  it('scores a peace sign', () => {
    const s = handGestureScores([peaceHand()]);
    expect(s.peaceSign).toBeGreaterThan(0.8);
    expect(s.palmOpen).toBe(0);
  });

  it('takes the max per key across multiple hands', () => {
    const s = handGestureScores([fistHand(), openPalmHand()]);
    expect(s.fistClench).toBeGreaterThan(0.9);
    expect(s.palmOpen).toBeGreaterThan(0.9);
  });

  it('handToTemple fires near an ear and stays zero without face keypoints', () => {
    const near = handGestureScores([templeHand()], FACE);
    expect(near.handToTemple).toBeGreaterThan(0.9);
    const noFace = handGestureScores([templeHand()]);
    expect(noFace.handToTemple).toBe(0);
    const far = handGestureScores([openPalmHand()], FACE);
    expect(far.handToTemple).toBe(0);
  });

  it('handToTemple rejects a hand that fails the size sanity gate', () => {
    // A "hand" 6x life size (thrust at the lens) must not fire, however close
    // its fingertips land to an ear.
    const l = buildPose({ fingers: allFingers([3, 0, -3, -8], LOOSE), thumb: THUMB_OUT, scale: 6 });
    const dx = FACE.rightEar.x - l[8].x;
    const dy = FACE.rightEar.y - l[8].y;
    const at = l.map((q) => p(q.x + dx, q.y + dy, q.z));
    const s = handGestureScores([{ landmarks: at, world: worldPoints() }], FACE);
    expect(s.handToTemple).toBe(0);
  });

  it('degenerate zero-span hand scores zero everywhere', () => {
    const l: HandPoint[] = new Array(21).fill(null).map(() => p(0.5, 0.5));
    const s = scoreOneHand({ landmarks: l, world: [] }, null);
    for (const k of HAND_TRIGGER_SOURCES) expect(s[k]).toBe(0);
  });
});

/* — anchor ------------------------------------------------------------------ */

describe('handAnchor', () => {
  it('returns null for no valid hands', () => {
    expect(handAnchor([])).toBeNull();
    expect(handAnchor([null, undefined])).toBeNull();
  });

  it('anchors at the knuckle centroid with a unit palm normal', () => {
    const a = handAnchor([fistHand()]);
    expect(a).not.toBeNull();
    if (a === null) return;
    // MCP row mean y = −82mm → 0.85 − 82·MM. (Was 0.615 against the old
    // eyeballed rig; the CODE is unchanged here, the fixture moved.)
    expect(a.originX).toBeCloseTo(0.5, 2);
    expect(a.originY).toBeCloseTo(0.645, 3);
    expect(a.spanNorm).toBeGreaterThan(0.1);
    const len = Math.hypot(a.normal[0], a.normal[1], a.normal[2]);
    expect(len).toBeCloseTo(1, 5);
  });

  it('prefers the strongest-scoring hand', () => {
    // A loose hand off to the left scores near-nothing; the fist wins.
    const idle = buildPose({
      fingers: allFingers([3, 0, -3, -8], LOOSE),
      thumb: THUMB_OUT,
      shift: [-140, 60],
    });
    const a = handAnchor([sample(idle), fistHand()]);
    expect(a).not.toBeNull();
    if (a === null) return;
    expect(a.originX).toBeCloseTo(0.5, 2);
    expect(a.originY).toBeCloseTo(0.645, 3);
  });

  it('spanNorm is aspect-corrected, so the depth estimate reads image heights', () => {
    // The SAME physical hand in a 9:16 frame: raw normalized x is stretched
    // 1.78x, and an uncorrected hypot would report a longer palm (a nearer
    // hand) purely because the frame is narrow. beam.ts's pinhole formula is
    // stated in image heights, so the two must agree.
    const square = handAnchor([fistHand(1)]);
    const portrait = handAnchor([fistHand(9 / 16)], null, 9 / 16);
    expect(square).not.toBeNull();
    expect(portrait).not.toBeNull();
    if (square === null || portrait === null) return;
    expect(portrait.spanNorm).toBeCloseTo(square.spanNorm, 6);
  });
});

/* — no cross-firing + aspect invariance ------------------------------------ */

const POSES: Array<{ name: string; fires: string; build: (a: number) => HandSample; face: boolean }> = [
  { name: 'fist', fires: 'fistClench', build: fistHand, face: false },
  { name: 'open palm', fires: 'palmOpen', build: openPalmHand, face: false },
  { name: 'pinch', fires: 'pinch', build: pinchHand, face: false },
  { name: 'peace sign', fires: 'peaceSign', build: peaceHand, face: false },
  { name: 'hand to temple', fires: 'handToTemple', build: templeHand, face: true },
];

/** The engine's enter thresholds (src/lib/studio/triggers.ts THRESHOLDS). A raw
 *  score below `enter` can never fire — the EMA only ever approaches it. */
const ENTER: Record<string, number> = {
  fistClench: 0.62,
  palmOpen: 0.62,
  pinch: 0.6,
  peaceSign: 0.65,
  handToTemple: 0.6,
};

describe('every gesture is reachable and none cross-fires', () => {
  for (const pose of POSES) {
    it(`${pose.name} scores over enter on ${pose.fires} and under it on all others`, () => {
      const s = handGestureScores([pose.build(1)], FACE);
      expect(s[pose.fires]).toBeGreaterThan(ENTER[pose.fires]);
      // Labelled so a regression names the offending pair, not just a number.
      const crossFired = HAND_TRIGGER_SOURCES.filter((k) => k !== pose.fires && s[k] >= ENTER[k]).map(
        (k) => `${pose.name} → ${k} ${s[k].toFixed(3)}`,
      );
      expect(crossFired).toEqual([]);
    });
  }

  it('a flat chop is not an open palm (the spread term has real edges)', () => {
    expect(handGestureScores([chopHand()]).palmOpen).toBeLessThan(ENTER.palmOpen);
    expect(handGestureScores([openPalmHand()]).palmOpen).toBeGreaterThan(0.9);
  });

  it('scores the same pose identically at 9:16, 1:1 and 16:9', () => {
    for (const pose of POSES) {
      const at = (aspect: number) =>
        handGestureScores([pose.build(aspect)], pose.face ? faceAt(aspect) : null, aspect);
      const square = at(1);
      for (const aspect of [9 / 16, 16 / 9, 3 / 4]) {
        const other = at(aspect);
        for (const k of HAND_TRIGGER_SOURCES) {
          expect(`${pose.name}/${k}@${aspect}=${other[k].toFixed(6)}`).toBe(
            `${pose.name}/${k}@${aspect}=${square[k].toFixed(6)}`,
          );
        }
      }
    }
  });
});
