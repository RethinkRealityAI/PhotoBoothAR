import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import type { ExtraFace, FaceSample } from './faceEngine/types';

/* faceRig's pose path against a scripted engine: the manager is replaced so
 * each test decides which sample (if any) the next poll hands over, and
 * whether the session is legacy / frame-locked. */
const eng = vi.hoisted(() => ({
  next: null as FaceSample | null,
  legacy: false,
  locked: false,
  /** Multi-face: the extras handed over with the current sample. */
  extras: [] as ExtraFace[],
}));
vi.mock('./faceEngine', () => ({
  pollFaceEngine: () => {
    const pose = eng.next;
    eng.next = null; // a sample is handed over ONCE
    return { pose, expr: null, poseHasExpr: true };
  },
  faceInferenceMs: () => -Infinity,
  isLegacyFaceSession: () => eng.legacy,
  isFrameLockActive: () => eng.locked,
  getExtraFaces: () => eng.extras,
}));

type Rig = typeof import('./faceRig');
let rig: Rig;
let now = 0;
const perf = vi.spyOn(performance, 'now').mockImplementation(() => now);

function poseMatrix(x: number, y: number, z: number, yawRad: number): number[] {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawRad),
    new THREE.Vector3(1, 1, 1),
  );
  return m.toArray();
}
function feed(t: number, x: number, yaw = 0): void {
  eng.next = { t, matrix: poseMatrix(x, 0, -40, yaw), blendshapes: {}, keypoints: null };
}
let stream = { id: 'front' };
const video = () => ({ readyState: 4, get srcObject() { return stream; } }) as unknown as HTMLVideoElement;

beforeEach(async () => {
  Object.assign(eng, { next: null, legacy: false, locked: false, extras: [] });
  stream = { id: 'front' };
  now = 1000;
  vi.resetModules();
  rig = await import('./faceRig');
});

/** Render `frames` frames at `hz`, feeding a new sample on every 33ms boundary
 *  of a 10 cm/s sideways motion with ±0.15cm alternating noise. Returns the
 *  group's x after each NEW sample. */
function runMotion(hz: number, g: THREE.Object3D, v: HTMLVideoElement, frames: number): number[] {
  const out: number[] = [];
  let nextSample = 1000;
  let k = 0;
  for (let i = 0; i < frames; i++) {
    now = 1000 + (i * 1000) / hz;
    let fresh = false;
    if (now >= nextSample) {
      feed(nextSample, (nextSample - 1000) * 0.01 + (k % 2 ? 0.15 : -0.15));
      nextSample += 33;
      k++;
      fresh = true;
    }
    rig.updateHeadPose(g, v, false);
    if (fresh) out.push(g.position.x);
  }
  return out;
}

describe('shared head-pose filter (platform)', () => {
  it('is stepped on NEW samples only: extra render frames never re-filter a held sample', () => {
    const g = new THREE.Group();
    const v = video();
    feed(1000, 0);
    expect(rig.updateHeadPose(g, v, false)).toBe(true);
    feed(1033, 2);
    now = 1033;
    rig.updateHeadPose(g, v, false);
    const afterSample = g.position.x;
    for (let i = 1; i <= 5; i++) {
      now = 1033 + i * 4; // a 240Hz display between two samples
      rig.updateHeadPose(g, v, false);
      expect(g.position.x).toBe(afterSample);
    }
  });

  it('the output does not depend on the display rate (the +21% jitter at 120Hz was the re-filtering)', () => {
    const at60 = runMotion(60, new THREE.Group(), video(), 120);
    rig.resetFaceRig();
    const at120 = runMotion(120, new THREE.Group(), video(), 240);
    expect(at120.length).toBe(at60.length);
    at60.forEach((x, i) => expect(at120[i]).toBeCloseTo(x, 9));
  });

  it('legacy keeps the shipped per-rig, per-frame filter (so it DOES depend on the display rate)', () => {
    eng.legacy = true;
    const at60 = runMotion(60, new THREE.Group(), video(), 120);
    const at120 = runMotion(120, new THREE.Group(), video(), 240);
    const differs = at60.some((x, i) => Math.abs(x - at120[i]) > 1e-6);
    expect(differs).toBe(true);
  });

  it('a piece mounted late shows exactly what its siblings show (one filter, not one per rig)', () => {
    const v = video();
    const first = new THREE.Group();
    for (let i = 0; i < 10; i++) {
      now = 1000 + i * 33;
      feed(now, i * 0.5, i * 0.02);
      rig.updateHeadPose(first, v, false);
    }
    const late = new THREE.Group();
    rig.updateHeadPose(late, v, false);
    expect(late.position.toArray()).toEqual(first.position.toArray());
    expect(late.quaternion.toArray()).toEqual(first.quaternion.toArray());
  });

  it('a mirrored rig is the exact reflection of an unmirrored one', () => {
    const v = video();
    const plain = new THREE.Group();
    const mirrored = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      now = 1000 + i * 33;
      feed(now, 1 + i, 0.1 * i);
      rig.updateHeadPose(plain, v, false);
      rig.updateHeadPose(mirrored, v, true);
    }
    expect(mirrored.position.x).toBe(-plain.position.x);
    expect(mirrored.position.y).toBe(plain.position.y);
    expect(mirrored.quaternion.y).toBe(-plain.quaternion.y);
    expect(mirrored.quaternion.z).toBe(-plain.quaternion.z);
    expect(mirrored.quaternion.w).toBe(plain.quaternion.w);
  });

  it('frame-locked + bypass: the rig shows the RAW sample (registered with its own frame)', () => {
    eng.locked = true;
    rig.setFrameLockFilterProfile('bypass');
    const g = new THREE.Group();
    const v = video();
    feed(1000, 0);
    rig.updateHeadPose(g, v, false);
    now = 1033;
    feed(1033, 3.25, 0.2);
    rig.updateHeadPose(g, v, false);
    expect(g.position.x).toBeCloseTo(3.25, 9);
    expect(g.quaternion.y).toBeCloseTo(Math.sin(0.1), 9);
  });

  it('frame-locked DEFAULT is steady: sideways motion of the face is shown raw, rotation is eased', () => {
    expect(rig.getFrameLockFilterProfile()).toBe('steady');
    eng.locked = true;
    const g = new THREE.Group();
    const v = video();
    feed(1000, 0);
    rig.updateHeadPose(g, v, false);
    now = 1033;
    feed(1033, 2.5); // pure translation at constant depth: nothing for steady to filter
    rig.updateHeadPose(g, v, false);
    expect(g.position.x).toBeCloseTo(2.5, 6);
    now = 1066;
    feed(1066, 2.5, 0.2); // a yaw step: the shown rotation trails the raw one
    rig.updateHeadPose(g, v, false);
    expect(g.quaternion.y).toBeGreaterThan(0);
    expect(g.quaternion.y).toBeLessThan(Math.sin(0.1));
  });

  it('frame-locked + light trails a moving face far less than the standard filter', () => {
    const lagOf = (locked: boolean): number => {
      eng.locked = locked;
      rig.resetFaceRig();
      const g = new THREE.Group();
      const v = video();
      let x = 0;
      for (let i = 0; i < 30; i++) {
        now = 1000 + i * 33;
        x = i * 0.66; // 20 cm/s
        feed(now, x);
        rig.updateHeadPose(g, v, false);
      }
      return x - g.position.x;
    };
    rig.setFrameLockFilterProfile('light');
    const standard = lagOf(false);
    const light = lagOf(true);
    expect(standard).toBeGreaterThan(0.5); // ~1cm of slip at 20cm/s, the audit's number
    expect(light).toBeLessThan(standard / 2);
  });

  it('a camera STREAM change drops the old pose at once (no stale pose over the new camera)', () => {
    const g = new THREE.Group();
    const v = video();
    feed(1000, 4);
    expect(rig.updateHeadPose(g, v, false)).toBe(true);
    now = 1100;
    expect(rig.updateHeadPose(g, v, false)).toBe(true); // held within HOLD_MS
    stream = { id: 'back' }; // flip
    now = 1110;
    expect(rig.updateHeadPose(g, v, false)).toBe(false);
    expect(rig.getLatestFaceKeypoints()).toBeNull();
    feed(1143, -2);
    now = 1143;
    expect(rig.updateHeadPose(g, v, false)).toBe(true);
    expect(g.position.x).toBeCloseTo(-2, 9); // snapped, not glided from the old camera's 4
  });
});

describe('extra faces (multi-face, platform)', () => {
  const extra = (id: number, slot: number, t: number, x: number, yaw = 0): ExtraFace => ({
    id, slot, t, matrix: new Float32Array(poseMatrix(x, 0, -60, yaw)),
  });

  it('an extra face gets its own pose, independent of the primary', () => {
    const v = video();
    const primary = new THREE.Group();
    const other = new THREE.Group();
    feed(1000, 3);
    eng.extras = [extra(7, 1, 1000, -10)];
    rig.updateHeadPose(primary, v, false);
    expect(rig.updateExtraHeadPose(other, 1, false)).toBe(true);
    expect(primary.position.x).toBeCloseTo(3, 9);
    expect(other.position.x).toBeCloseTo(-10, 9);
    expect(other.position.z).toBeCloseTo(-60, 9);
    expect(rig.updateExtraHeadPose(new THREE.Group(), 2, false)).toBe(false); // empty slot
  });

  it('mirrors exactly like the primary', () => {
    const v = video();
    feed(1000, 0);
    eng.extras = [extra(7, 1, 1000, 4, 0.3)];
    rig.updateHeadPose(new THREE.Group(), v, false);
    const plain = new THREE.Group();
    const mirrored = new THREE.Group();
    rig.updateExtraHeadPose(plain, 1, false);
    rig.updateExtraHeadPose(mirrored, 1, true);
    expect(mirrored.position.x).toBe(-plain.position.x);
    expect(mirrored.quaternion.y).toBe(-plain.quaternion.y);
    expect(mirrored.quaternion.w).toBe(plain.quaternion.w);
  });

  it('is smoothed per slot, and a new PERSON in the slot snaps instead of gliding', () => {
    const v = video();
    const g = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      now = 1000 + i * 33;
      feed(now, 0);
      eng.extras = [extra(7, 1, now, i * 2)];
      rig.updateHeadPose(new THREE.Group(), v, false);
    }
    rig.updateExtraHeadPose(g, 1, false);
    expect(g.position.x).toBeLessThan(8); // standard filter trails the 8cm raw position
    now = 1165;
    feed(now, 0);
    eng.extras = [extra(9, 1, now, -20)]; // somebody else took slot 1
    rig.updateHeadPose(new THREE.Group(), v, false);
    rig.updateExtraHeadPose(g, 1, false);
    expect(g.position.x).toBeCloseTo(-20, 9);
  });

  it('hides HOLD_MS after the face stops being handed over', () => {
    const v = video();
    const g = new THREE.Group();
    feed(1000, 0);
    eng.extras = [extra(7, 1, 1000, 5)];
    rig.updateHeadPose(new THREE.Group(), v, false);
    eng.extras = [];
    now = 1400;
    expect(rig.updateExtraHeadPose(g, 1, false)).toBe(true);
    now = 1600;
    expect(rig.updateExtraHeadPose(g, 1, false)).toBe(false);
  });

  it('legacy never shows an extra face', () => {
    eng.legacy = true;
    feed(1000, 0);
    eng.extras = [extra(7, 1, 1000, 5)];
    rig.updateHeadPose(new THREE.Group(), video(), false);
    expect(rig.updateExtraHeadPose(new THREE.Group(), 1, false)).toBe(false);
  });

  it('a promoted primary (subjectChanged) snaps the shared filter instead of gliding', () => {
    const v = video();
    const g = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      now = 1000 + i * 33;
      feed(now, 0);
      rig.updateHeadPose(g, v, false);
    }
    now = 1165;
    eng.next = { t: now, matrix: poseMatrix(15, 0, -40, 0), blendshapes: {}, keypoints: null, subjectChanged: true };
    rig.updateHeadPose(g, v, false);
    expect(g.position.x).toBeCloseTo(15, 9);
  });
});

perf.mockClear();
