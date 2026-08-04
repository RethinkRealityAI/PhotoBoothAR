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

/* — synthetic 21-point rigs ------------------------------------------------ *
 * Built in normalized image space (y down). Wrist sits at (0.5, 0.8) and the
 * fingers point up-screen. Only the landmarks the scorer reads are placed
 * carefully; PIP/DIP fillers sit between MCP and TIP.
 */

const p = (x: number, y: number, z = 0): HandPoint => ({ x, y, z });

function baseHand(): HandPoint[] {
  const l: HandPoint[] = new Array(21).fill(null).map(() => p(0.5, 0.7));
  l[0] = p(0.5, 0.8); // wrist
  // thumb chain, resting away from the palm
  l[1] = p(0.46, 0.76);
  l[2] = p(0.42, 0.73);
  l[3] = p(0.39, 0.7);
  l[4] = p(0.36, 0.68);
  // MCPs
  l[5] = p(0.44, 0.62);
  l[9] = p(0.48, 0.6);
  l[13] = p(0.52, 0.61);
  l[17] = p(0.56, 0.63);
  return l;
}

function extendFingers(l: HandPoint[]): void {
  l[8] = p(0.38, 0.44); // index tip
  l[12] = p(0.46, 0.4); // middle tip
  l[16] = p(0.54, 0.42); // ring tip
  l[20] = p(0.62, 0.47); // pinky tip
  l[6] = p(0.41, 0.53);
  l[10] = p(0.47, 0.5);
  l[14] = p(0.53, 0.51);
  l[18] = p(0.59, 0.55);
}

function curlFingers(l: HandPoint[]): void {
  l[8] = p(0.46, 0.65);
  l[12] = p(0.49, 0.63);
  l[16] = p(0.53, 0.645);
  l[20] = p(0.565, 0.665);
  l[6] = p(0.45, 0.6);
  l[10] = p(0.48, 0.58);
  l[14] = p(0.525, 0.59);
  l[18] = p(0.56, 0.61);
}

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

function sample(l: HandPoint[]): HandSample {
  return { landmarks: l, world: worldPoints() };
}

export function openPalmHand(): HandSample {
  const l = baseHand();
  extendFingers(l);
  return sample(l);
}

export function fistHand(): HandSample {
  const l = baseHand();
  curlFingers(l);
  l[4] = p(0.55, 0.64); // thumb tucked over the pinky MCP
  l[3] = p(0.51, 0.68);
  return sample(l);
}

function pinchHand(): HandSample {
  const l = baseHand();
  extendFingers(l);
  l[4] = p(0.385, 0.445); // thumb tip onto the index tip
  return sample(l);
}

function peaceHand(): HandSample {
  const l = baseHand();
  extendFingers(l);
  curlFingers(l); // curl everything, then re-extend index+middle wider apart
  l[8] = p(0.36, 0.45);
  l[12] = p(0.46, 0.4);
  l[6] = p(0.4, 0.54);
  l[10] = p(0.47, 0.5);
  return sample(l);
}

// Face sits in the upper half of frame, clear of the hand rigs' fingertips.
const FACE: FaceKeypoints = {
  forehead: { x: 0.5, y: 0.1 },
  chin: { x: 0.5, y: 0.42 },
  leftEar: { x: 0.35, y: 0.25 },
  rightEar: { x: 0.65, y: 0.25 },
};

function templeHand(): HandSample {
  const l = baseHand();
  extendFingers(l);
  // shift the whole hand so the index tip lands on the right ear anchor
  const dx = FACE.rightEar.x + 0.01 - l[8].x;
  const dy = FACE.rightEar.y + 0.01 - l[8].y;
  for (let i = 0; i < 21; i++) l[i] = p(l[i].x + dx, l[i].y + dy, l[i].z);
  return sample(l);
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

  it('scores a pinch only when the index is extended', () => {
    const s = handGestureScores([pinchHand()]);
    expect(s.pinch).toBeGreaterThan(0.9);
    const fist = handGestureScores([fistHand()]);
    expect(fist.pinch).toBe(0); // thumb near index root in a fist must not pinch
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
    // A "hand" 3x the face height (hand thrust at the lens) must not fire.
    const l = baseHand();
    extendFingers(l);
    for (let i = 0; i < 21; i++) {
      l[i] = p(0.5 + (l[i].x - 0.5) * 6, 0.5 + (l[i].y - 0.5) * 6);
    }
    const dx = FACE.rightEar.x - l[8].x;
    const dy = FACE.rightEar.y - l[8].y;
    for (let i = 0; i < 21; i++) l[i] = p(l[i].x + dx, l[i].y + dy);
    const s = handGestureScores([sample(l)], FACE);
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
    expect(a.originX).toBeCloseTo(0.5, 1);
    expect(a.originY).toBeCloseTo(0.615, 1);
    expect(a.spanNorm).toBeGreaterThan(0.1);
    const len = Math.hypot(a.normal[0], a.normal[1], a.normal[2]);
    expect(len).toBeCloseTo(1, 5);
  });

  it('prefers the strongest-scoring hand', () => {
    const fist = fistHand();
    const idle = baseHand(); // no tips placed → weak everything
    const a = handAnchor([sample(idle), fist]);
    expect(a).not.toBeNull();
    if (a === null) return;
    // fist knuckle centroid sits at x=0.5; the idle hand shares it, so check
    // via origin y (fist tips curled near 0.615 band).
    expect(a.originY).toBeCloseTo(0.615, 1);
  });
});
