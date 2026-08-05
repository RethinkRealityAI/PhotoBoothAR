import { describe, expect, it } from 'vitest';
import {
  FOREARM_REACH_MAX_CM,
  HAND_ANCHOR_MAP,
  HAND_ANCHORS,
  anchorPointFor,
  forearmAxis,
  forearmReachCm,
  isHandAnchorId,
  mirrorHandPose,
  solveHandPose,
} from './handPose';
import type { HandPoint } from './handGestures';

const F_OVER_H = 0.5 / Math.tan((63 * Math.PI) / 360);
const ASPECT = 9 / 16;

/** A flat right hand facing the camera, palm-centred metres. */
function worldHand(): HandPoint[] {
  const w: HandPoint[] = new Array(21).fill(null).map(() => ({ x: 0, y: 0, z: 0 }));
  w[0] = { x: 0, y: 0.05, z: 0 }; // wrist (world y is DOWN → wrist below)
  w[5] = { x: 0.03, y: -0.04, z: 0 };
  w[9] = { x: 0.01, y: -0.048, z: 0 };
  w[13] = { x: -0.012, y: -0.045, z: 0 };
  w[17] = { x: -0.032, y: -0.035, z: 0 };
  return w;
}

/** Project the world hand at `depthCm` into normalized screen coords, exactly
 *  the weak-perspective model the solver inverts. */
function projectAt(world: HandPoint[], depthCm: number, cx = 0.5, cy = 0.5): HandPoint[] {
  const s = F_OVER_H / depthCm; // height units per cm
  return world.map((p) => ({
    x: (cx * ASPECT + p.x * 100 * s) / ASPECT / 1, // width-normalized
    y: cy + p.y * 100 * s,
    z: 0,
  }));
}

describe('solveHandPose', () => {
  it('recovers depth and position from a projected hand', () => {
    const world = worldHand();
    const screen = projectAt(world, 60);
    const pose = solveHandPose(screen, world, 'Right', ASPECT, null);
    expect(pose).not.toBeNull();
    if (pose === null) return;
    expect(pose.depthCm).toBeCloseTo(60, 0);
    expect(pose.position[2]).toBeCloseTo(-60, 0);
    // Centered hand → near the optical axis.
    expect(Math.abs(pose.position[0])).toBeLessThan(3);
    expect(pose.palmSpanCm).toBeCloseTo(Math.hypot(1, 9.8), 1);
  });

  it('depth scales with apparent size (same hand, twice as far)', () => {
    const world = worldHand();
    const near = solveHandPose(projectAt(world, 45), world, 'Right', ASPECT, null);
    const far = solveHandPose(projectAt(world, 90), world, 'Right', ASPECT, null);
    expect(near?.depthCm ?? 0).toBeCloseTo(45, 0);
    expect(far?.depthCm ?? 0).toBeCloseTo(90, 0);
  });

  it('palm normal faces the camera for a right hand, away for a left', () => {
    const world = worldHand();
    const screen = projectAt(world, 60);
    const right = solveHandPose(screen, world, 'Right', ASPECT, null);
    const left = solveHandPose(screen, world, 'Left', ASPECT, null);
    if (right === null || left === null) throw new Error('degenerate');
    // +Z axis of the frame = rotate (0,0,1) by quaternion; z component sign:
    const zAxisZ = (q: [number, number, number, number]) => 1 - 2 * (q[0] * q[0] + q[1] * q[1]);
    expect(zAxisZ(right.quaternion)).toBeGreaterThan(0.9);
    expect(zAxisZ(left.quaternion)).toBeLessThan(-0.9);
  });

  it('a locked span twice the frame span doubles the depth estimate', () => {
    const world = worldHand();
    const screen = projectAt(world, 60);
    const frameSpan = Math.hypot(1, 9.8);
    const locked = solveHandPose(screen, world, 'Right', ASPECT, frameSpan * 2);
    expect(locked?.depthCm ?? 0).toBeCloseTo(120, 0);
  });

  it('returns null on degenerate frames', () => {
    const flat: HandPoint[] = new Array(21).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0 }));
    expect(solveHandPose(flat, flat, 'Right', ASPECT, null)).toBeNull();
    expect(solveHandPose([], [], 'Right', ASPECT, null)).toBeNull();
    const world = worldHand();
    const nan = projectAt(world, 60);
    nan[9] = { x: NaN, y: 0.5, z: 0 };
    expect(solveHandPose(nan, world, 'Right', ASPECT, null)).toBeNull();
  });
});

describe('mirrorHandPose', () => {
  it('negates x and conjugates by diag(-1,1,1)', () => {
    const world = worldHand();
    const pose = solveHandPose(projectAt(world, 60, 0.3), world, 'Right', ASPECT, null);
    if (pose === null) throw new Error('degenerate');
    const m = mirrorHandPose(pose);
    expect(m.position[0]).toBeCloseTo(-pose.position[0], 6);
    expect(m.position[1]).toBe(pose.position[1]);
    expect(m.quaternion[1]).toBeCloseTo(-pose.quaternion[1], 6);
    expect(m.quaternion[2]).toBeCloseTo(-pose.quaternion[2], 6);
    expect(m.quaternion[3]).toBe(pose.quaternion[3]);
  });
});

describe('anchors', () => {
  it('registry is well-formed and guarded', () => {
    expect(HAND_ANCHORS.length).toBeGreaterThan(0);
    expect(isHandAnchorId('grip')).toBe(true);
    expect(isHandAnchorId('crown')).toBe(false);
    expect(isHandAnchorId(null)).toBe(false);
  });

  it('grip anchor sits behind the knuckles (into the fist)', () => {
    const world = worldHand();
    const screen = projectAt(world, 60);
    const pose = solveHandPose(screen, world, 'Right', ASPECT, null);
    if (pose === null) throw new Error('degenerate');
    const p = anchorPointFor(HAND_ANCHOR_MAP.grip, screen, pose, ASPECT);
    // Palm faces the camera (+Z normal), grip offset is negative → further
    // from the camera than the hand plane.
    expect(p[2]).toBeLessThan(-60);
  });
});

describe('the forearm', () => {
  const posed = () => {
    const world = worldHand();
    const screen = projectAt(world, 60);
    const pose = solveHandPose(screen, world, 'Right', ASPECT, null);
    if (pose === null) throw new Error('degenerate');
    return { world, screen, pose };
  };

  it('points away from the fingers — it is the hand frame\'s −Y, nothing more', () => {
    const { pose } = posed();
    const [x, y, z] = forearmAxis(pose);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
    // The fixture hand points up the screen (wrist below the knuckles), so the
    // forearm must run DOWN. A sign slip here puts a sleeve on the fingers.
    expect(y).toBeLessThan(-0.9);
  });

  it('is exactly the negated up column of the pose quaternion', () => {
    // Reading the axis off the same quaternion the mount points use is what
    // stops the sleeve and the gear it continues from drifting apart.
    const { pose } = posed();
    const [qx, qy, qz, qw] = pose.quaternion;
    const up: [number, number, number] = [
      2 * (qx * qy - qw * qz),
      1 - 2 * (qx * qx + qz * qz),
      2 * (qy * qz + qw * qx),
    ];
    const f = forearmAxis(pose);
    for (let i = 0; i < 3; i++) expect(f[i]).toBeCloseTo(-up[i], 9);
  });

  it('clamps reach to what an INFERRED axis can defend', () => {
    // The axis is derived from the palm, not tracked. Measured error reaches
    // ~28° on a gripping hand; at 12cm that is already ~5.7cm of drift, which
    // is the radius of a real forearm. Past the cap the gear is not on the arm.
    expect(forearmReachCm(5)).toBe(5);
    expect(forearmReachCm(FOREARM_REACH_MAX_CM)).toBe(FOREARM_REACH_MAX_CM);
    expect(forearmReachCm(1000)).toBe(FOREARM_REACH_MAX_CM);
    // Absent/degenerate = a hand-worn anchor, which must not move at all.
    expect(forearmReachCm(undefined)).toBe(0);
    expect(forearmReachCm(0)).toBe(0);
    expect(forearmReachCm(-4)).toBe(0);
    // Every non-finite value takes the SAME exit as absent: don't move the gear.
    // Infinity could plausibly have meant "as far as allowed", but treating it
    // as the cap while NaN means zero is two policies for one class of corrupt
    // input, and the quiet one is the one that cannot put a sleeve mid-air.
    expect(forearmReachCm(NaN)).toBe(0);
    expect(forearmReachCm(Infinity)).toBe(0);
    expect(forearmReachCm(-Infinity)).toBe(0);
  });

  it('moves a forearm mount down the arm, and leaves hand mounts untouched', () => {
    const { screen, pose } = posed();
    const wrist = anchorPointFor(HAND_ANCHOR_MAP.wristBack, screen, pose, ASPECT);
    const arm = anchorPointFor(HAND_ANCHOR_MAP.forearm, screen, pose, ASPECT);
    const reach = forearmReachCm(HAND_ANCHOR_MAP.forearm.alongForearmCm);
    expect(reach).toBeGreaterThan(0);
    // The sleeve sits `reach` cm along the forearm axis from the wrist. Compare
    // against the axis rather than a literal so the assertion survives tuning.
    const f = forearmAxis(pose);
    // Both mounts start at landmark 0; wristBack additionally lifts 1.2cm off
    // the back of the hand, so remove that before comparing.
    const [nx, ny, nz] = [
      2 * (pose.quaternion[0] * pose.quaternion[2] + pose.quaternion[3] * pose.quaternion[1]),
      2 * (pose.quaternion[1] * pose.quaternion[2] - pose.quaternion[3] * pose.quaternion[0]),
      1 - 2 * (pose.quaternion[0] ** 2 + pose.quaternion[1] ** 2),
    ];
    const base = [
      wrist[0] - nx * HAND_ANCHOR_MAP.wristBack.normalOffsetCm,
      wrist[1] - ny * HAND_ANCHOR_MAP.wristBack.normalOffsetCm,
      wrist[2] - nz * HAND_ANCHOR_MAP.wristBack.normalOffsetCm,
    ];
    for (let i = 0; i < 3; i++) expect(arm[i]).toBeCloseTo(base[i] + f[i] * reach, 4);
  });

  it('every hand-worn anchor stays exactly where it was', () => {
    // The legacy guarantee: adding the forearm mount must not shift grip, wrist
    // or palm by a millimetre, or every scene saved before it moves.
    const { screen, pose } = posed();
    for (const id of ['grip', 'wristBack', 'palm'] as const) {
      const def = HAND_ANCHOR_MAP[id];
      expect(def.alongForearmCm).toBeUndefined();
      const p = anchorPointFor(def, screen, pose, ASPECT);
      const noReach = anchorPointFor({ ...def, alongForearmCm: undefined }, screen, pose, ASPECT);
      expect(p).toEqual(noReach);
    }
  });
});
