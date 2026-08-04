/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HandRig — FaceRig's sibling for hand-anchored gear (wand in the fist,
 * gauntlet on the wrist). Children render in a group positioned/oriented per
 * frame from the shared hand-rig stash via the pure handPose solver.
 *
 * Smoothing (research-tuned): FOUR One-Euro filters, not three — depth is
 * ~5× noisier than X/Y (∂Z/∂px ≈ 0.8cm at 60cm) and the least visually
 * sensitive channel, so it gets its own much heavier filter. The per-user
 * palm span is MEDIAN-locked over the first confident frames (the
 * getHeadFitEstimate idiom) and thereafter drives depth, so world-landmark
 * scale noise leaves the depth channel entirely. Filters reset on
 * re-acquisition — hands leave frame constantly; that path is hot.
 *
 * Also exports HandOccluder: a landmark-driven depth-only shell (spheres per
 * landmark + palm slab — ~500 tris, zero extra inference) using FaceOccluder's
 * exact material recipe, shrunk ~0.9× per the never-grow z-fight rule.
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { detectHandsNow, getLatestHandFrame } from '../../lib/handRig';
import { initializeHandLandmarker } from '../../lib/handTracking';
import {
  anchorPointFor,
  HAND_ANCHOR_MAP,
  mirrorHandPose,
  solveHandPose,
  type HandPose,
} from '../../lib/handPose';
import { OneEuroQuat, OneEuroVec3, type OneEuroConfig, type Quat, type Vec3 } from '../../lib/smoothing';
import { medianOf } from '../../lib/faceRig';

const POS_XY: OneEuroConfig = { minCutoff: 1.5, beta: 0.5, dCutoff: 1.0 };
const POS_Z: OneEuroConfig = { minCutoff: 0.6, beta: 0.15, dCutoff: 1.0 };
const ROT: OneEuroConfig = { minCutoff: 2.0, beta: 1.2, dCutoff: 1.0 };

/** Keep the last pose through brief misses; hands re-acquire constantly. */
const HOLD_MS = 400;
/** Frames of confident tracking before the palm span freezes. */
const SPAN_LOCK_SAMPLES = 30;

export interface HandRigProps {
  /** HAND_ANCHORS id — where the gear mounts on the hand. */
  anchor: string;
  videoId?: string;
  mirror?: boolean;
  onVisibilityChange?: (visible: boolean) => void;
  children?: ReactNode;
}

export function HandRig({ anchor, videoId = 'booth-video', mirror = true, onVisibilityChange, children }: HandRigProps) {
  const groupRef = useRef<THREE.Group>(null);
  const def = HAND_ANCHOR_MAP[anchor] ?? HAND_ANCHOR_MAP.grip;

  const state = useRef({
    posXY: new OneEuroVec3(POS_XY),
    posZ: new OneEuroVec3(POS_Z),
    rot: new OneEuroQuat(ROT),
    lastMs: 0,
    lastSeen: -Infinity,
    lastT: -1,
    tracking: false,
    visible: false,
    // Palm-span lock ring (medianOf reuses faceRig's zero-alloc helper).
    spanRing: new Float32Array(SPAN_LOCK_SAMPLES),
    spanScratch: new Float32Array(SPAN_LOCK_SAMPLES),
    spanCount: 0,
    lockedSpan: null as number | null,
    aspect: 9 / 16,
  });
  const anchorRotation = useMemo(
    () => new THREE.Quaternion().setFromEuler(new THREE.Euler(def.rotation[0], def.rotation[1], def.rotation[2])),
    [def],
  );

  const _pos: Vec3 = useMemo(() => [0, 0, 0], []);
  const _quat: Quat = useMemo(() => [0, 0, 0, 1], []);
  const _q = useMemo(() => new THREE.Quaternion(), []);

  // SELF-INITIALIZING tracking, exactly like FaceRig: the component that NEEDS
  // the landmarker owns starting it (idempotent — handTracking caches the init
  // promise). Without this, a hand-anchored wand in a scene with NO hand
  // trigger sources mounted a rig that never received a single frame: the only
  // detectHandsNow callers were the trigger loops, and both are gated on
  // triggers existing.
  useEffect(() => {
    initializeHandLandmarker().catch((e) => console.warn('[HandRig] hand tracker init failed', e));
  }, []);

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    const s = state.current;
    const now = performance.now();
    // Self-driven detection (the FaceRig idiom): detectHandsNow self-throttles
    // (66ms gate, face-inference lockout, idle back-off), so extra callers in
    // the same tick are near-free no-ops.
    const vid = document.getElementById(videoId) as HTMLVideoElement | null;
    if (vid) detectHandsNow(vid);
    const frame = getLatestHandFrame();

    let pose: HandPose | null = null;
    if (frame !== null && frame.t !== s.lastT && frame.hands.length > 0) {
      s.lastT = frame.t;
      const video = document.getElementById(videoId) as HTMLVideoElement | null;
      if (video && video.videoWidth > 0 && video.videoHeight > 0) {
        s.aspect = video.videoWidth / video.videoHeight;
      }
      const hand = frame.hands[0];
      const realHand = frame.handedness[0] ?? 'Right';
      pose = solveHandPose(hand.landmarks, hand.world, realHand, s.aspect, s.lockedSpan);
      if (pose !== null) {
        // Feed the span lock until it freezes.
        if (s.lockedSpan === null && pose.palmSpanCm > 1) {
          s.spanRing[s.spanCount % SPAN_LOCK_SAMPLES] = pose.palmSpanCm;
          s.spanCount++;
          if (s.spanCount >= SPAN_LOCK_SAMPLES) {
            s.lockedSpan = medianOf(s.spanRing, SPAN_LOCK_SAMPLES, s.spanScratch);
          }
        }
        const raw = mirror ? mirrorHandPose(pose) : pose;
        const anchorPt = anchorPointFor(def, frame.hands[0].landmarks, pose, s.aspect);
        const target: Vec3 = mirror ? [-anchorPt[0], anchorPt[1], anchorPt[2]] : anchorPt;
        const dt = s.tracking ? Math.min(0.25, (now - s.lastMs) / 1000) : 0;
        if (!s.tracking) {
          s.posXY.reset();
          s.posZ.reset();
          s.rot.reset();
        }
        const xy = s.posXY.filter([target[0], target[1], 0], dt, _pos);
        const z = s.posZ.filter([target[2], 0, 0], dt);
        const q = s.rot.filter(raw.quaternion, dt, _quat);
        g.position.set(xy[0], xy[1], z[0]);
        _q.set(q[0], q[1], q[2], q[3]).multiply(anchorRotation);
        g.quaternion.copy(_q);
        s.lastMs = now;
        s.lastSeen = now;
        s.tracking = true;
      }
    }

    const visible = s.tracking && now - s.lastSeen < HOLD_MS;
    if (!visible && now - s.lastSeen >= HOLD_MS) s.tracking = false;
    if (visible !== s.visible) {
      s.visible = visible;
      onVisibilityChange?.(visible);
    }
    g.visible = visible;
  });

  return <group ref={groupRef} visible={false}>{children}</group>;
}

/* ── Hand occluder ─────────────────────────────────────────────────────── */

/** FaceOccluder's recipe: depth-only, drawn first, never raycast. Shrunk to
 *  0.9× (occluders shrink, props pull forward — the z-fight rule). */
const OCCLUDER_MATERIAL = new THREE.MeshBasicMaterial({
  colorWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});
const SPHERE = new THREE.SphereGeometry(1, 10, 8);

/** Landmark radii, cm — knuckles thicker than tips, wrist thickest. */
function landmarkRadiusCm(i: number): number {
  if (i === 0) return 2.6;
  if (i === 1 || i === 5 || i === 9 || i === 13 || i === 17) return 1.15;
  return 0.85;
}

/**
 * Depth-only shell over the tracked hand so real fingers occlude held gear.
 * Mount INSIDE the same Canvas as the gear (not inside HandRig — landmarks are
 * placed in world space each frame). ~21 spheres + a palm slab.
 */
export function HandOccluder({ videoId = 'booth-video', mirror = true }: { videoId?: string; mirror?: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  // Same self-init as HandRig — an occluder mounted alone must also track.
  useEffect(() => {
    initializeHandLandmarker().catch((e) => console.warn('[HandOccluder] hand tracker init failed', e));
  }, []);
  const spheres = useMemo(() => {
    const arr: THREE.Mesh[] = [];
    for (let i = 0; i < 21; i++) {
      const m = new THREE.Mesh(SPHERE, OCCLUDER_MATERIAL);
      m.renderOrder = -2;
      m.raycast = () => {};
      arr.push(m);
    }
    return arr;
  }, []);
  const palm = useMemo(() => {
    const m = new THREE.Mesh(SPHERE, OCCLUDER_MATERIAL);
    m.renderOrder = -2;
    m.raycast = () => {};
    return m;
  }, []);
  const state = useRef({ lastT: -1, lastSeen: -Infinity, aspect: 9 / 16 });

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    const s = state.current;
    const now = performance.now();
    // Self-driven detection, same rationale as HandRig above.
    const vid = document.getElementById(videoId) as HTMLVideoElement | null;
    if (vid) detectHandsNow(vid);
    const frame = getLatestHandFrame();
    if (frame !== null && frame.t !== s.lastT && frame.hands.length > 0) {
      s.lastT = frame.t;
      const video = document.getElementById(videoId) as HTMLVideoElement | null;
      if (video && video.videoWidth > 0 && video.videoHeight > 0) {
        s.aspect = video.videoWidth / video.videoHeight;
      }
      const hand = frame.hands[0];
      const realHand = frame.handedness[0] ?? 'Right';
      const pose = solveHandPose(hand.landmarks, hand.world, realHand, s.aspect, null);
      if (pose !== null) {
        s.lastSeen = now;
        const halfH = Math.tan((63 * Math.PI) / 360) * pose.depthCm;
        const halfW = halfH * s.aspect;
        for (let i = 0; i < 21; i++) {
          const l = hand.landmarks[i];
          const nx = mirror ? 1 - l.x : l.x;
          const m = spheres[i];
          // Per-landmark depth: hand plane + the world landmark's own z (cm,
          // toward-viewer positive after the axis flip).
          const z = -pose.depthCm + -hand.world[i].z * 100;
          m.position.set((nx * 2 - 1) * halfW, (1 - l.y * 2) * halfH, z);
          const r = landmarkRadiusCm(i) * 0.9;
          m.scale.setScalar(r);
        }
        // Palm slab: centred between wrist and middle MCP, flattened along the
        // palm normal.
        const w = spheres[0].position;
        const k = spheres[9].position;
        palm.position.set((w.x + k.x) / 2, (w.y + k.y) / 2, (w.z + k.z) / 2);
        palm.scale.set(3.6, 4.2, 1.6);
        palm.quaternion.copy(new THREE.Quaternion());
      }
    }
    g.visible = now - s.lastSeen < HOLD_MS;
  });

  return (
    <group ref={groupRef} visible={false}>
      {spheres.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
      <primitive object={palm} />
    </group>
  );
}
