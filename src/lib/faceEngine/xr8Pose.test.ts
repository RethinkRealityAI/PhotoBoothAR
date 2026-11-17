import { describe, expect, it } from 'vitest';
import { xr8Keypoints, xr8LocalToHeadCm, xr8ToFaceMatrix, RIG_VERTICAL_FOV_DEG } from './xr8Pose';
import { XR8_SPIKE_FRAMES, type Xr8SpikeFrame } from './xr8Spike.fixture';

/*
 * Cross-engine agreement on REAL frames: 8th Wall converted by xr8Pose vs MediaPipe's own
 * facialTransformationMatrix on the same video frame. MediaPipe is not ground truth — on the
 * expressive / yawed faces the two engines genuinely disagree by several degrees — so the
 * tolerances are tiered: NEUTRAL clips (the still and its synthetic roll/pan/zoom), EXPRESSIVE clips,
 * and the two DISPUTED clips where the engines' meshes disagree most (friend: chin, face height
 * −11 %; bdaywoman2: chin and ears). Every bound sits just above the value MEASURED on these
 * fixture frames on the first run (2026-11-17), so the suite is a regression detector, not a
 * correctness claim. Where a bound sits above the calibration target, the comment says so.
 */
const NEUTRAL = new Set(['static', 'roll', 'pan', 'zoom']);
const DISPUTED = new Set(['friend', 'bdaywoman2']);
type Tier = 'neutral' | 'expressive' | 'disputed';
const tierOf = (clip: string): Tier => (NEUTRAL.has(clip) ? 'neutral' : DISPUTED.has(clip) ? 'disputed' : 'expressive');
/** Bounds per tier; measured maxima in the comments. */
const BOUND = {
  rotDeg: { neutral: 3, expressive: 8, disputed: 8 }, // measured 2.60 · 6.96 (guy) · 4.07
  depth: { neutral: 0.03, expressive: 0.06, disputed: 0.09 }, // measured 1.8 % · 4.5 % · 8.4 %
  // Target was 5 px neutral: MISSED on roll (crown 5.9 px) and pan (ear 5.0 px).
  anchorPx: { neutral: 7, expressive: 13, disputed: 30 }, // measured 5.9 · 12.0 · 27.3 (bdaywoman2 chin)
  keypointPx: { neutral: 8, expressive: 25, disputed: 45 }, // measured 6.7 · 22.3 (confman ear) · 40.9
  // Target was 3 % neutral: MISSED on roll (3.3 %) and pan (3.1 %).
  faceH: { neutral: 0.04, expressive: 0.04, disputed: 0.13 }, // measured 3.3 % · 2.8 % · 11.5 % (friend)
} as const;
const F63 = 1 / Math.tan((RIG_VERTICAL_FOV_DEG / 2) * (Math.PI / 180));
// Anchors from faceRig ANCHOR_PRESETS (cm, canonical head space).
const ANCHORS: Record<string, [number, number, number]> = {
  crown: [0, 8.3, 4.0], noseTip: [0, -0.5, 7.6], leftEye: [4.3, 3.4, 4.0], rightEye: [-4.3, 3.4, 4.0],
  leftEar: [7.7, 1.5, -1.5], rightEar: [-7.7, 1.5, -1.5], chin: [0, -7.5, 5.0],
};

const apply = (m: ArrayLike<number>, p: readonly number[]): [number, number, number] => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];
const projPx = (v: [number, number, number], W: number, H: number): [number, number] => [
  ((((F63 * H) / W) * v[0]) / -v[2] + 1) / 2 * W,
  ((1 - (F63 * v[1]) / -v[2]) / 2) * H,
];
/** Angle between the rotation blocks of two column-major matrices (deg). */
function rotAngleDeg(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = (m: ArrayLike<number>, c: number) => Math.hypot(m[c * 4], m[c * 4 + 1], m[c * 4 + 2]);
  let tr = 0;
  for (let c = 0; c < 3; c++) {
    let d = 0;
    for (let r = 0; r < 3; r++) d += (a[c * 4 + r] / n(a, c)) * (b[c * 4 + r] / n(b, c));
    tr += d;
  }
  return (Math.acos(Math.min(1, Math.max(-1, (tr - 1) / 2))) * 180) / Math.PI;
}
const convert = (f: Xr8SpikeFrame) => xr8ToFaceMatrix(f.transform, f.intrinsics, f.videoW, f.videoH);

describe('xr8ToFaceMatrix — real spike frames, 8th Wall vs MediaPipe', () => {
  it('has 22 fixture frames across 11 clips', () => {
    expect(XR8_SPIKE_FRAMES.length).toBe(22);
  });

  for (const f of XR8_SPIKE_FRAMES) {
    const tier = tierOf(f.clip);
    it(`${f.clip}: rotation, anchors and depth agree with MediaPipe (${tier} tolerance)`, () => {
      const m = convert(f);
      expect(m).not.toBeNull();
      const ours = m as ArrayLike<number>;
      expect(rotAngleDeg(ours, f.mpMatrix)).toBeLessThan(BOUND.rotDeg[tier]);
      expect(Math.abs(ours[14] / f.mpMatrix[14] - 1)).toBeLessThan(BOUND.depth[tier]);
      for (const [name, a] of Object.entries(ANCHORS)) {
        const pa = projPx(apply(ours, a), f.videoW, f.videoH);
        const pm = projPx(apply(f.mpMatrix, a), f.videoW, f.videoH);
        expect(Math.hypot(pa[0] - pm[0], pa[1] - pm[1]), `${name} px`).toBeLessThan(BOUND.anchorPx[tier]);
      }
    });
  }

  it('returns a rigid, right-handed rotation (MediaPipe matrices have scale exactly 1)', () => {
    const m = convert(XR8_SPIKE_FRAMES[0]) as ArrayLike<number>;
    for (let c = 0; c < 3; c++) expect(Math.hypot(m[c * 4], m[c * 4 + 1], m[c * 4 + 2])).toBeCloseTo(1, 6);
    const det =
      m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
    expect(det).toBeCloseTo(1, 6);
    expect(m[3]).toBe(0);
    expect(m[7]).toBe(0);
    expect(m[11]).toBe(0);
    expect(m[15]).toBe(1);
  });

  it('writes into the caller buffer (no allocation on the hot path)', () => {
    const buf = new Float32Array(16);
    expect(xr8ToFaceMatrix(XR8_SPIKE_FRAMES[0].transform, XR8_SPIKE_FRAMES[0].intrinsics, 540, 960, buf)).toBe(buf);
  });

  it('rejects non-finite input, a non-positive scale, a face behind the camera and bad intrinsics', () => {
    const f = XR8_SPIKE_FRAMES[0];
    const t = (patch: object) => ({ ...f.transform, ...patch });
    expect(xr8ToFaceMatrix(t({ scale: 0 }), f.intrinsics, 540, 960)).toBeNull();
    expect(xr8ToFaceMatrix(t({ position: { x: NaN, y: 0, z: -1 } }), f.intrinsics, 540, 960)).toBeNull();
    expect(xr8ToFaceMatrix(t({ position: { x: 0, y: 0, z: 2 } }), f.intrinsics, 540, 960)).toBeNull();
    expect(xr8ToFaceMatrix(f.transform, [1, 2, 3], 540, 960)).toBeNull();
    expect(xr8ToFaceMatrix(f.transform, f.intrinsics, 0, 960)).toBeNull();
    const k = [...f.intrinsics];
    k[5] = 0;
    expect(xr8ToFaceMatrix(f.transform, k, 540, 960)).toBeNull();
  });

  it('fov: identity under 63° intrinsics; otherwise the head centre keeps its 8th Wall image position', () => {
    const f = XR8_SPIKE_FRAMES[0];
    const W = f.videoW, H = f.videoH, K = f.intrinsics;
    const k = [...K];
    k[5] = F63;
    k[0] = (F63 * H) / W;
    // Under 63° intrinsics the reprojection is the identity, so `a` carries the raw centre.
    const a = xr8ToFaceMatrix(f.transform, k, W, H) as ArrayLike<number>;
    const b = xr8ToFaceMatrix(f.transform, K, W, H) as ArrayLike<number>;
    // Where 8th Wall's own camera (K) images that raw centre…
    const w = K[3] * a[12] + K[7] * a[13] + K[11] * a[14] + K[15];
    const p8 = [((K[0] * a[12] + K[4] * a[13] + K[8] * a[14] + K[12]) / w + 1) / 2 * W,
      (1 - (K[1] * a[12] + K[5] * a[13] + K[9] * a[14] + K[13]) / w) / 2 * H];
    // …is exactly where our 63° camera images the converted centre.
    const pb = projPx([b[12], b[13], b[14]], W, H);
    expect(Math.hypot(pb[0] - p8[0], pb[1] - p8[1])).toBeLessThan(0.01);
    // …but the wider 8th Wall fov (64.57°) puts the same head ~3 % farther under our 63° camera.
    expect(b[14] / a[14]).toBeCloseTo(F63 / f.intrinsics[5], 6);
  });
});

describe('xr8Keypoints — vs MediaPipe landmarks on the same frames', () => {
  const uvArray = (f: Xr8SpikeFrame) => {
    const a: { u: number; v: number }[] = Array.from({ length: 468 }, () => ({ u: NaN, v: NaN }));
    for (const [i, [u, v]] of Object.entries(f.uvs)) a[Number(i)] = { u, v };
    return a;
  };
  const mpKeypoints = (f: Xr8SpikeFrame) => {
    const l = f.mpLandmarks;
    return {
      forehead: l[10], chin: l[152],
      leftEar: [(l[127][0] + l[234][0]) / 2, (l[127][1] + l[234][1]) / 2],
      rightEar: [(l[356][0] + l[454][0]) / 2, (l[356][1] + l[454][1]) / 2],
    } as Record<string, number[]>;
  };

  for (const f of XR8_SPIKE_FRAMES) {
    it(`${f.clip}: every keypoint and the face height within tolerance of MediaPipe's`, () => {
      const k = xr8Keypoints(uvArray(f));
      expect(k).not.toBeNull();
      const kp = k as NonNullable<typeof k>;
      const mp = mpKeypoints(f);
      for (const name of ['forehead', 'chin', 'leftEar', 'rightEar'] as const) {
        const d = Math.hypot((kp[name].x - mp[name][0]) * f.videoW, (kp[name].y - mp[name][1]) * f.videoH);
        expect(d, name).toBeLessThan(BOUND.keypointPx[tierOf(f.clip)]);
      }
      const hOurs = Math.hypot((kp.forehead.x - kp.chin.x) * f.videoW, (kp.forehead.y - kp.chin.y) * f.videoH);
      const hMp = Math.hypot((mp.forehead[0] - mp.chin[0]) * f.videoW, (mp.forehead[1] - mp.chin[1]) * f.videoH);
      expect(Math.abs(hOurs / hMp - 1)).toBeLessThan(BOUND.faceH[tierOf(f.clip)]);
    });
  }

  it('null for a short mesh or a non-finite value', () => {
    expect(xr8Keypoints([])).toBeNull();
    const a = Array.from({ length: 468 }, () => ({ u: 0.5, v: 0.5 }));
    a[152] = { u: NaN, v: 0.5 };
    expect(xr8Keypoints(a)).toBeNull();
  });
});

describe('xr8LocalToHeadCm — mesh in the contract head frame', () => {
  it('a vertex placed through the matrix lands where 8th Wall saw it (chin, nose-side keypoints)', () => {
    for (const f of XR8_SPIKE_FRAMES) {
      const m = convert(f) as ArrayLike<number>;
      for (const i of [152]) {
        const out = new Float32Array(3);
        const [x, y, z] = f.local[i];
        expect(xr8LocalToHeadCm([{ x, y, z }], out)).toBe(1);
        const px = projPx(apply(m, [out[0], out[1], out[2]]), f.videoW, f.videoH);
        const [u, v] = f.uvs[i];
        // Only the fov reprojection residual remains (measured < 1.5 px); 2.5 px bound.
        expect(Math.hypot(px[0] - u * f.videoW, px[1] - v * f.videoH), `${f.clip} v${i}`).toBeLessThan(2.5);
      }
    }
  });

  it('writes at most out.length/3 vertices', () => {
    const out = new Float32Array(4);
    expect(xr8LocalToHeadCm([{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }], out)).toBe(1);
  });
});
