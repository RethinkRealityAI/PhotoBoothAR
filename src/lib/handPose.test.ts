import { describe, expect, it } from 'vitest';
import {
  FOREARM_REACH_MAX_CM,
  HAND_ANCHOR_MAP,
  HAND_ANCHORS,
  anchorLocalOffset,
  anchorLocalPoint,
  anchorPointFor,
  forearmAxis,
  landmarkLocalPositions,
  rotateByQuat,
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

  it('grip anchor sits IN the fist: palm side of the knuckles, wrist-ward of them', () => {
    // 2026-09-22: it used to sit 2.2cm BEHIND the knuckles (p.z < -60 here),
    // which the orbit view showed as a wand running up the back of the fist.
    // +Z is out of the palm — the side a fist closes onto.
    const world = worldHand();
    const screen = projectAt(world, 60);
    const pose = solveHandPose(screen, world, 'Right', ASPECT, null);
    if (pose === null) throw new Error('degenerate');
    const p = anchorPointFor(HAND_ANCHOR_MAP.grip, screen, pose, ASPECT);
    // Palm faces the camera (+Z normal): the grip is NEARER the camera than the
    // hand plane, by its normal offset.
    expect(p[2]).toBeGreaterThan(-60);
    expect(p[2]).toBeCloseTo(-60 + HAND_ANCHOR_MAP.grip.normalOffsetCm, 0);
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

  it('only the forearm and the grip carry a -Y push, and it is clamped the same way', () => {
    // Was: "every hand-worn anchor stays exactly where it was" (no anchor but the
    // forearm had a reach). The grip now carries one on purpose — the fist's
    // tube is wrist-ward of the knuckles — so the invariant is that wrist and
    // palm still do not, and every reach goes through the one clamp.
    const { screen, pose } = posed();
    for (const id of ['wristBack', 'palm'] as const) {
      const def = HAND_ANCHOR_MAP[id];
      expect(def.alongForearmCm).toBeUndefined();
      const p = anchorPointFor(def, screen, pose, ASPECT);
      const noReach = anchorPointFor({ ...def, alongForearmCm: undefined }, screen, pose, ASPECT);
      expect(p).toEqual(noReach);
    }
    expect(forearmReachCm(HAND_ANCHOR_MAP.grip.alongForearmCm)).toBe(HAND_ANCHOR_MAP.grip.alongForearmCm);
    expect(HAND_ANCHOR_MAP.grip.alongForearmCm!).toBeLessThan(FOREARM_REACH_MAX_CM);
  });
});

describe('palm-local landmark cloud (the one frame gear and occluder share)', () => {
  const setup = () => {
    const world = worldHand();
    const screen = projectAt(world, 60);
    const pose = solveHandPose(screen, world, 'Right', ASPECT, null);
    if (pose === null) throw new Error('degenerate');
    return { world, screen, pose };
  };

  it('reproduces the metric hand: wrist→middle-MCP is the frame\'s +Y at the palm span', () => {
    const { world, screen, pose } = setup();
    const local = landmarkLocalPositions(screen, world, pose, ASPECT, new Float32Array(63));
    const dx = local[27] - local[0];
    const dy = local[28] - local[1];
    const dz = local[29] - local[2];
    expect(Math.abs(dx)).toBeLessThan(0.3);
    expect(dy).toBeCloseTo(pose.palmSpanCm, 0);
    expect(Math.abs(dz)).toBeLessThan(0.3);
  });

  it('centres the rigid palm on the origin and keeps a flat palm at z≈0', () => {
    const { world, screen, pose } = setup();
    const local = landmarkLocalPositions(screen, world, pose, ASPECT, new Float32Array(63));
    let cx = 0, cy = 0, cz = 0;
    for (const i of [0, 5, 9, 13, 17]) { cx += local[i * 3]; cy += local[i * 3 + 1]; cz += local[i * 3 + 2]; }
    expect(Math.abs(cx / 5)).toBeLessThan(0.3);
    expect(Math.abs(cy / 5)).toBeLessThan(0.3);
    expect(Math.abs(cz / 5)).toBeLessThan(0.3);
    for (const i of [0, 5, 9, 13, 17]) expect(Math.abs(local[i * 3 + 2])).toBeLessThan(0.3);
  });

  it('a landmark nearer the camera than the palm lands at +z (toward the viewer)', () => {
    const { world, screen, pose } = setup();
    const w = world.map((p) => ({ ...p }));
    w[8] = { x: 0.01, y: -0.09, z: -0.03 }; // index tip 3cm TOWARD the camera (world z away is +)
    const local = landmarkLocalPositions(screen, w, pose, ASPECT, new Float32Array(63));
    expect(local[8 * 3 + 2]).toBeGreaterThan(2.5);
    expect(local[8 * 3 + 2]).toBeLessThan(3.5);
  });

  it('anchorLocalPoint agrees with the world-space anchorPointFor for every anchor', () => {
    const { world, screen, pose } = setup();
    const local = landmarkLocalPositions(screen, world, pose, ASPECT, new Float32Array(63));
    for (const def of HAND_ANCHORS) {
      const l = anchorLocalPoint(def, local);
      const r = rotateByQuat(pose.quaternion, l);
      const viaLocal = [r[0] + pose.position[0], r[1] + pose.position[1], r[2] + pose.position[2]];
      const viaWorld = anchorPointFor(def, screen, pose, ASPECT, world);
      for (let k = 0; k < 3; k++) expect(viaLocal[k]).toBeCloseTo(viaWorld[k], 1);
    }
  });

  it('anchorLocalOffset is the local form of normal offset + clamped forearm reach', () => {
    expect(anchorLocalOffset(HAND_ANCHOR_MAP.grip)).toEqual([0, -2, 2.5]);
    expect(anchorLocalOffset(HAND_ANCHOR_MAP.wristBack)).toEqual([0, 0, -1.2]);
    expect(anchorLocalOffset(HAND_ANCHOR_MAP.forearm)).toEqual([0, -5, 0]);
    expect(anchorLocalOffset({ ...HAND_ANCHOR_MAP.forearm, alongForearmCm: 99 })).toEqual([0, -FOREARM_REACH_MAX_CM, 0]);
  });

  it('rotateByQuat matches the axis-angle it encodes', () => {
    const q: [number, number, number, number] = [0, Math.SQRT1_2, 0, Math.SQRT1_2]; // +90° about Y
    const v = rotateByQuat(q, [1, 0, 0]);
    expect(v[0]).toBeCloseTo(0, 9);
    expect(v[1]).toBeCloseTo(0, 9);
    expect(v[2]).toBeCloseTo(-1, 9);
  });
});

describe('curlHandedness — the fingers decide which hand, not the label', () => {
  /** The flat fixture with its fingers curled toward the RIGHT hand's palm
   *  (toward the camera: MediaPipe world z is AWAY, so negative). */
  function curledRight(): HandPoint[] {
    const w = worldHand();
    for (const [i, z] of [[4, -0.02], [6, -0.02], [8, -0.035], [10, -0.02], [12, -0.035], [14, -0.02], [16, -0.035], [18, -0.02], [20, -0.03]] as const) {
      w[i] = { x: w[i].x, y: w[i].y, z };
    }
    return w;
  }

  it('a curled right hand labelled LEFT still solves as a right hand, palm to the camera', () => {
    const world = curledRight();
    const pose = solveHandPose(projectAt(world, 60), world, 'Left', ASPECT, null)!;
    expect(pose.hand).toBe('Right');
    const zAxisZ = 1 - 2 * (pose.quaternion[0] ** 2 + pose.quaternion[1] ** 2);
    expect(zAxisZ).toBeGreaterThan(0.9);
  });

  it('a flat hand has no vote — the label decides, as before', () => {
    const world = worldHand();
    expect(solveHandPose(projectAt(world, 60), world, 'Left', ASPECT, null)!.hand).toBe('Left');
    expect(solveHandPose(projectAt(world, 60), world, 'Right', ASPECT, null)!.hand).toBe('Right');
  });

  it('the mirror image of a curled right hand votes left', () => {
    const w = curledRight().map((p) => ({ x: -p.x, y: p.y, z: p.z }));
    // Mirror in x: the index/pinky order flips, so this is a left hand.
    expect(solveHandPose(projectAt(w, 60), w, 'Right', ASPECT, null)!.hand).toBe('Left');
  });

  it('RECORDED: a fist gripping a staff that MediaPipe labelled Left solves as Right, palm toward the staff', () => {
    // Landmarks captured from the studio harness (wizard-duel frame, 720×1080):
    // the fingers wrap to the RIGHT of the knuckles in the raw image, around
    // the staff. With the label's normal the wand mounted outside the fist.
    const WAND_FIST_SCREEN = [[0.18354, 0.93915, 0.0], [0.22992, 0.87795, 0.01441], [0.24577, 0.82646, 0.00287], [0.2605, 0.79063, -0.01668], [0.27931, 0.76492, -0.03439], [0.19002, 0.78511, -0.03622], [0.20825, 0.72431, -0.07249], [0.26466, 0.7085, -0.08567], [0.3112, 0.71241, -0.08793], [0.17546, 0.80181, -0.05951], [0.27502, 0.77148, -0.09999], [0.32152, 0.79475, -0.09866], [0.33186, 0.81967, -0.08805], [0.18077, 0.82821, -0.08116], [0.29596, 0.81844, -0.11395], [0.32493, 0.84577, -0.09863], [0.32302, 0.86654, -0.07852], [0.19587, 0.85747, -0.1019], [0.29489, 0.85382, -0.1149], [0.32461, 0.86445, -0.09978], [0.32988, 0.87384, -0.08154]];
const WAND_FIST_WORLD = [[-0.00205, 0.07947, 0.05306], [0.00814, 0.04176, 0.05551], [0.0193, 0.01449, 0.05185], [0.02729, -0.00885, 0.03053], [0.02768, -0.02154, 0.00706], [-0.00336, -0.01463, 0.02132], [0.00717, -0.03986, 0.01032], [0.02271, -0.05203, 0.01086], [0.04251, -0.05183, 0.01224], [-0.00468, -0.00327, 0.00235], [0.02421, -0.01975, -0.00464], [0.04218, -0.00727, 0.01756], [0.04257, 0.00794, 0.04245], [0.0017, 0.00869, -0.01475], [0.03109, 0.00567, -0.01294], [0.04354, 0.01617, 0.00998], [0.041, 0.03286, 0.03322], [0.00411, 0.02998, -0.02036], [0.03015, 0.02382, -0.01723], [0.04232, 0.02526, 0.00289], [0.04082, 0.03393, 0.02116]];
    const lm = WAND_FIST_SCREEN.map(([x, y, z]) => ({ x, y, z }));
    const w = WAND_FIST_WORLD.map(([x, y, z]) => ({ x, y, z }));
    const pose = solveHandPose(lm, w, 'Left', 720 / 1080, null)!;
    expect(pose.hand).toBe('Right');
    const [qx, qy, qz, qw] = pose.quaternion;
    const zAxisX = 2 * (qx * qz + qw * qy);
    expect(zAxisX).toBeGreaterThan(0.8); // out of the palm = toward the fingertips (+x raw)
  });
});
