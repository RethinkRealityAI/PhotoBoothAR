import { describe, expect, it } from 'vitest';
import {
  eulerXYZFromMat,
  fitGearToHand,
  fitPlacementFor,
  handFrameBasis,
  matFromEulerXYZ,
  placeOnHand,
  placementDegrees,
} from './gearFit';
import { HAND_ANCHOR_MAP, HAND_ANCHORS } from '../handPose';
import { CANONICAL_PALM_LEN_CM } from './handRefAnchors';
import type { AssetHandFrame } from './assetTemplate';

/** A glove lying along +Z with its palm facing −Y, wrist off-origin, 0.5 units
 *  palm — the shape the power gauntlet actually has. */
const GLOVE: AssetHandFrame = { wrist: [0.1, 0.02, -0.2], knuckle: [0.1, 0.02, 0.3], palm: [0, -1, 0] };

const close = (a: number[], b: number[], eps = 1e-3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], -Math.log10(eps)));

describe('handFrameBasis', () => {
  it('is orthonormal and right-handed, with +Y along the palm and +Z out of it', () => {
    const b = handFrameBasis(GLOVE)!;
    close(b.up, [0, 0, 1]);
    close(b.palm, [0, -1, 0]);
    // right = up × palm
    close(b.right, [1, 0, 0]);
    expect(b.palmLen).toBeCloseTo(0.5, 9);
  });
  it('orthogonalises a palm direction that leans along the fingers', () => {
    const b = handFrameBasis({ ...GLOVE, palm: [0, -1, 0.3] })!;
    expect(Math.abs(b.palm[0] * b.up[0] + b.palm[1] * b.up[1] + b.palm[2] * b.up[2])).toBeLessThan(1e-9);
  });
  it('refuses a zero-length palm', () => {
    expect(handFrameBasis({ ...GLOVE, knuckle: GLOVE.wrist })).toBeNull();
  });
});

describe('Euler round trip (three.js XYZ)', () => {
  it('matFromEulerXYZ ∘ eulerXYZFromMat is the identity away from gimbal lock', () => {
    for (const e of [[0.3, -0.7, 1.1], [-1.2, 0.4, -2.5], [0, 0, 0], [2.9, 1.2, -0.1]] as const) {
      const back = eulerXYZFromMat(matFromEulerXYZ(e[0], e[1], e[2]));
      const m1 = matFromEulerXYZ(e[0], e[1], e[2]);
      const m2 = matFromEulerXYZ(back[0], back[1], back[2]);
      for (let r = 0; r < 3; r++) close(m1[r], m2[r], 1e-9);
    }
  });
});

describe('fitGearToHand — the glove lands ON the hand frame', () => {
  for (const hand of ['left', 'right'] as const) {
    for (const def of HAND_ANCHORS) {
      it(`${def.id} · ${hand}: wrist on the wrist landmark, knuckle on the knuckle row, palm out of the palm`, () => {
        const p = fitGearToHand(GLOVE, def, hand)!;
        expect(p).not.toBeNull();
        close(placeOnHand(GLOVE.wrist, p, def, hand), [0, 0, 0], 1e-3);
        close(placeOnHand(GLOVE.knuckle, p, def, hand), [0, CANONICAL_PALM_LEN_CM, 0], 1e-3);
        const a = placeOnHand(GLOVE.wrist, p, def, hand);
        const tip: [number, number, number] = [GLOVE.wrist[0] + GLOVE.palm[0], GLOVE.wrist[1] + GLOVE.palm[1], GLOVE.wrist[2] + GLOVE.palm[2]];
        const b = placeOnHand(tip, p, def, hand);
        // The palm direction maps to +Z (out of the palm).
        expect(b[2] - a[2]).toBeGreaterThan(0);
        expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeLessThan(1e-2);
      });
    }
  }

  it('scales the glove so its palm is the canonical palm, whatever the GLB units', () => {
    expect(fitGearToHand(GLOVE, HAND_ANCHOR_MAP.wristBack, 'left')!.scale).toBeCloseTo(CANONICAL_PALM_LEN_CM / 0.5, 3);
    const big: AssetHandFrame = { wrist: [0, 0, 0], knuckle: [0, 0, 50], palm: [0, -1, 0] };
    expect(fitGearToHand(big, HAND_ANCHOR_MAP.wristBack, 'left')!.scale).toBeCloseTo(CANONICAL_PALM_LEN_CM / 50, 4);
  });

  it('degrees for the add action mirror the stored radians', () => {
    const p = fitGearToHand(GLOVE, HAND_ANCHOR_MAP.wristBack, 'left')!;
    const d = placementDegrees(p);
    expect(d.x).toBeCloseTo((p.rotation.x * 180) / Math.PI, 2);
    expect(d.z).toBeCloseTo((p.rotation.z * 180) / Math.PI, 2);
  });

  it('never stores -0', () => {
    const p = fitGearToHand({ wrist: [0, 0, 0], knuckle: [0, 1, 0], palm: [0, 0, 1] }, HAND_ANCHOR_MAP.wristBack, 'right')!;
    for (const v of [p.offset.x, p.offset.y, p.rotation.x, p.rotation.y, p.rotation.z]) expect(Object.is(v, -0)).toBe(false);
  });
});

describe('fitPlacementFor — "Fit to hand" on a piece already in the scene', () => {
  it('seats from the stored template when it carries a hand frame', () => {
    expect(fitPlacementFor({ handFrame: GLOVE }, null, 'wristBack', 'auto')).toEqual(fitGearToHand(GLOVE, HAND_ANCHOR_MAP.wristBack, 'right'));
  });
  it('falls back to the library descriptor for a frozen template that predates hand frames', () => {
    const lib = { handFrame: GLOVE, modelledHand: 'left' as const };
    expect(fitPlacementFor({}, lib, 'grip', 'auto')).toEqual(fitGearToHand(GLOVE, HAND_ANCHOR_MAP.grip, 'left'));
  });
  it('authors an agnostic piece in the hand the host pinned', () => {
    expect(fitPlacementFor({ handFrame: GLOVE }, null, 'palm', 'left')).toEqual(fitGearToHand(GLOVE, HAND_ANCHOR_MAP.palm, 'left'));
  });
  it('has nothing to seat for a head piece, an unknown mount, or no frame anywhere', () => {
    expect(fitPlacementFor({ handFrame: GLOVE }, null, undefined, 'auto')).toBeNull();
    expect(fitPlacementFor({ handFrame: GLOVE }, null, 'elbow', 'auto')).toBeNull();
    expect(fitPlacementFor({}, {}, 'grip', 'auto')).toBeNull();
    expect(fitPlacementFor(null, null, 'grip', 'auto')).toBeNull();
  });
});
