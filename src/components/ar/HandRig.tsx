/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HandRig — FaceRig's sibling for hand-anchored gear (wand in the fist,
 * gauntlet on the wrist). Children render in a group positioned/oriented per
 * frame from the shared hand-rig stash via the pure handPose solver.
 *
 * Smoothing lives in ONE place — handPoseFilter.ts, stepped once per hand
 * inference by handRig.ts and read here via getSharedHandPose() — so every rig
 * and the occluder ride the same filtered, span-locked pose (depth gets its own
 * heavier filter; the palm span is median-locked; filters reset on
 * re-acquisition). Between inferences each render frame extrapolates along the
 * filtered velocity, capped at HAND_EXTRAPOLATE_MAX_MS.
 *
 * Also exports HandOccluder: a landmark-driven depth-only shell (spheres per
 * landmark + palm slab — ~500 tris, zero extra inference) using FaceOccluder's
 * exact material recipe, shrunk ~0.9× per the never-grow z-fight rule.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { detectHandsNow, getSharedHandPose } from '../../lib/handRig';
import { initializeHandLandmarker } from '../../lib/handTracking';
import {
  anchorPointFor,
  forearmAxis,
  FOREARM_REACH_MAX_CM,
  handAnchorDef,
} from '../../lib/handPose';
import { extrapolatePosition, HAND_HOLD_MS } from '../../lib/handPoseFilter';
import type { Vec3 } from '../../lib/smoothing';
import { HandMirrorContext, useHandMirror } from './handMirror';
import {
  canMirrorAsset,
  displayedHand,
  mirrorPlacement,
  type HandFit,
  type TrackedHand,
} from '../../lib/studio/handedness';
import type { AssetTemplate } from '../../lib/studio/assetTemplate';
import type { AnchorConfig } from '../../types';

/** Keep the last pose through brief misses; hands re-acquire constantly. */
const HOLD_MS = HAND_HOLD_MS;

/**
 * The camera <video>, looked up once and cached while it stays in the document
 * — not `getElementById` twice per render frame per rig. Re-queries only when
 * the element is gone (unmounted/replaced) or the id changes.
 */
function useVideoLookup(videoId: string): () => HTMLVideoElement | null {
  const ref = useRef<HTMLVideoElement | null>(null);
  return useCallback(() => {
    const cached = ref.current;
    if (cached !== null && cached.isConnected && cached.id === videoId) return cached;
    ref.current = document.getElementById(videoId) as HTMLVideoElement | null;
    return ref.current;
  }, [videoId]);
}

export interface HandRigProps {
  /** HAND_ANCHORS id — where the gear mounts on the hand. */
  anchor: string;
  videoId?: string;
  mirror?: boolean;
  /** Hold the RENDERED pose steady (a gizmo handle is being dragged) WITHOUT
   *  stopping tracking — FaceRig's contract, for the same reason: a piece that
   *  swims under the pointer cannot be placed, but freezing the feed makes the
   *  studio look crashed. Detection keeps running; only the write is skipped. */
  holdPose?: boolean;
  /** The host's authored hand pin for the piece in this rig ('auto' follows the
   *  tracker). Published to descendants so a hand-modelled asset can flip
   *  itself — see ./handMirror.ts. */
  fit?: HandFit;
  /** The piece's anchor calibration version (handPose HAND_ANCHORS_V2); absent
   *  = v1, every saved scene. */
  anchorVersion?: number;
  onVisibilityChange?: (visible: boolean) => void;
  children?: ReactNode;
}

export function HandRig({ anchor, videoId = 'booth-video', mirror = true, holdPose = false, fit = 'auto', anchorVersion, onVisibilityChange, children }: HandRigProps) {
  const groupRef = useRef<THREE.Group>(null);
  // Memoised so `anchorRotation` below is not rebuilt every render (the map
  // lookup it replaces returned a stable object; handAnchorDef does too).
  const def = useMemo(() => handAnchorDef(anchor, anchorVersion), [anchor, anchorVersion]);
  // Which hand is in frame, as STATE rather than a ref: descendants re-render on
  // it. Written only when it CHANGES (the ref below is the per-frame value), so
  // a guest holding one hand up costs zero renders — swapping hands costs one.
  const [tracked, setTracked] = useState<TrackedHand>(null);
  const trackedRef = useRef<TrackedHand>(null);

  const state = useRef({
    lastT: -1,
    visible: false,
    // The anchor point (RAW frame, cm) and the rendered orientation (mirror
    // and anchor rotation already applied) of the latest shared sample —
    // recomputed once per inference, not per render frame.
    anchor: [0, 0, 0] as Vec3,
    quat: new THREE.Quaternion(),
  });
  const anchorRotation = useMemo(
    () => new THREE.Quaternion().setFromEuler(new THREE.Euler(def.rotation[0], def.rotation[1], def.rotation[2])),
    [def],
  );
  const getVideo = useVideoLookup(videoId);

  const _pos: Vec3 = useMemo(() => [0, 0, 0], []);

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
    const vid = getVideo();
    if (vid) detectHandsNow(vid);
    if (holdPose) {
      // g.position / g.quaternion / g.visible stay exactly where the last
      // tracked frame left them, so the grabbed handle does not run away. The
      // filters are SHARED (handRig.ts) and keep stepping on real samples, so
      // release resumes from the current pose with no stale dt to snap across.
      return;
    }

    // ONE filtered pose, shared with the occluder and every other hand piece
    // (handPoseFilter.ts) — span lock, depth/rotation/landmark filters and the
    // velocity all live there.
    const shared = getSharedHandPose();
    if (shared !== null && shared.t !== s.lastT) {
      s.lastT = shared.t;
      // Publish the hand the guest SEES: in the selfie view the rendered pose
      // is the displayed (other) hand's frame, so the mesh mirror, placement
      // mirror and beam emitter must all be decided against it.
      const shown = displayedHand(shared.realHand, mirror);
      if (trackedRef.current !== shown) {
        trackedRef.current = shown;
        setTracked(shown);
      }
      const a = anchorPointFor(def, shared.landmarks, shared.pose, shared.aspect);
      s.anchor[0] = a[0]; s.anchor[1] = a[1]; s.anchor[2] = a[2];
      // mirrorHandPose's conjugation by diag(−1,1,1), inline (no allocation).
      const q = shared.pose.quaternion;
      s.quat.set(q[0], mirror ? -q[1] : q[1], mirror ? -q[2] : q[2], q[3]).multiply(anchorRotation);
    }

    const visible = shared !== null && now - shared.t < HOLD_MS;
    if (visible) {
      // Between ~15/s inferences, carry the piece along the filtered velocity
      // (capped) instead of holding it — a moving hand no longer steps.
      extrapolatePosition(s.anchor, shared.velocity, now - shared.t, _pos);
      g.position.set(mirror ? -_pos[0] : _pos[0], _pos[1], _pos[2]);
      g.quaternion.copy(s.quat);
    }
    if (visible !== s.visible) {
      s.visible = visible;
      onVisibilityChange?.(visible);
    }
    g.visible = visible;
  });

  const mirrorValue = useMemo(() => ({ tracked, fit }), [tracked, fit]);

  return (
    <group ref={groupRef} visible={false}>
      <HandMirrorContext.Provider value={mirrorValue}>{children}</HandMirrorContext.Provider>
    </group>
  );
}

/**
 * Applies a hand piece's authored placement, REFLECTED when this piece is being
 * mirrored onto the other hand.
 *
 * This exists because mirroring the mesh is only half the job. `mirrorGeometryX`
 * flips vertices about the model's own local plane; the offset and rotation the
 * host tuned are applied outside it and do not move. A gauntlet nudged
 * (-0.7, -1.9, 2.1) and rotated (-98°, -14°, -4°) therefore mirrored into a pose
 * sitting BESIDE the hand — visibly worse than not mirroring at all. Reflecting
 * the placement with the mesh is what makes "one asset, both hands" true.
 *
 * Mount it inside the mirror context (i.e. inside a HandRig, or the orbit view's
 * own provider) and it is self-deciding — no prop threading, so a new surface
 * cannot forget.
 */
export function HandPlacement({ template, config, children }: {
  /** The whole descriptor, not just its hand: whether the mesh CAN mirror
   *  decides whether the placement may, and that depends on its text slots. */
  template: AssetTemplate | null | undefined;
  config: AnchorConfig;
  children?: ReactNode;
}) {
  const wants = useHandMirror(template?.modelledHand);
  const flip = wants && canMirrorAsset((template?.textSlots.length ?? 0) > 0);
  const { offset, rotation } = flip ? mirrorPlacement(config) : config;
  return (
    <group
      position={[offset.x, offset.y, offset.z]}
      rotation={[rotation.x, rotation.y, rotation.z]}
      scale={config.scale}
    >
      {children}
    </group>
  );
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
 * Beads down the forearm, so a gauntlet cuff or a sleeve is occluded by the arm
 * it is supposed to be ON. Without these the hand shell stops dead at the wrist
 * and everything past it floats in front of the guest's arm — which is the only
 * part of "gear that covers more than the hand" that actually reads wrong.
 *
 * Every commercial WebAR stack solves wrist-worn items this way: 8th Wall pairs
 * its wrist anchor with a `wrist-occluder`, WebAR.rocks masks the inside of a
 * bracelet. It is the occluder, not a tracked forearm, that sells the shot.
 *
 * Count and reach are deliberately small: the forearm direction is INFERRED
 * from the palm (see handPose.forearmAxis), and its measured error reaches ~28°
 * on a gripping hand, which at 12cm is already off the edge of a real arm. So
 * the shell covers the span the inference can defend and stops.
 */
const FOREARM_BEADS = 4;
/** A forearm just past the wrist, cm. Widens toward the elbow. */
const FOREARM_R0 = 2.7;
const FOREARM_R1 = 3.6;

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
  const forearm = useMemo(() => {
    const arr: THREE.Mesh[] = [];
    for (let i = 0; i < FOREARM_BEADS; i++) {
      const m = new THREE.Mesh(SPHERE, OCCLUDER_MATERIAL);
      m.renderOrder = -2;
      m.raycast = () => {};
      arr.push(m);
    }
    return arr;
  }, []);
  const state = useRef({ lastT: -1 });
  const getVideo = useVideoLookup(videoId);
  const _off: Vec3 = useMemo(() => [0, 0, 0], []);
  const ZERO: Vec3 = useMemo(() => [0, 0, 0], []);

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    const s = state.current;
    const now = performance.now();
    // Self-driven detection, same rationale as HandRig above.
    const vid = getVideo();
    if (vid) detectHandsNow(vid);
    // The SAME filtered, span-locked pose the gear rides (handPoseFilter.ts).
    // This shell used to solve its own, unfiltered and without the span lock,
    // so it sat at a different depth and lag from the prop it wraps.
    const shared = getSharedHandPose();
    if (shared !== null && shared.t !== s.lastT) {
      s.lastT = shared.t;
      const pose = shared.pose;
      const hand = { landmarks: shared.landmarks, world: shared.world };
      {
        const halfH = Math.tan((63 * Math.PI) / 360) * pose.depthCm;
        const halfW = halfH * shared.aspect;
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
        // The slab's half-extents (3.6 across, 4.2 along, 1.6 thick) describe a
        // palm facing the camera with the fingers up — so it has to TURN with
        // the hand. It used to be reset to identity every frame, which left it
        // camera-aligned forever: roll the hand 90° to present a gauntlet across
        // frame and the slab overhung the real silhouette by ~1.1cm (a visible
        // gap between hand and prop), while edge-on it under-covered the palm's
        // depth by ~1.5cm and let a gripped prop poke through the fist.
        const q = pose.quaternion;
        palm.quaternion.set(q[0], mirror ? -q[1] : q[1], mirror ? -q[2] : q[2], q[3]);

        // Forearm beads, from the wrist elbow-ward. The axis comes from the
        // RAW pose and is mirrored here the same way the landmarks above are
        // (x only) — reusing the pose's own axis keeps this from drifting away
        // from where the gear is mounted.
        const [ax, ay, az] = forearmAxis(pose);
        const dirX = mirror ? -ax : ax;
        for (let i = 0; i < FOREARM_BEADS; i++) {
          // Start one bead PAST the wrist so the shell does not double up on
          // the wrist sphere, and stop at the reach the inference supports.
          const t = (i + 1) / FOREARM_BEADS;
          const d = FOREARM_REACH_MAX_CM * t;
          const m = forearm[i];
          m.position.set(w.x + dirX * d, w.y + ay * d, w.z + az * d);
          m.scale.setScalar((FOREARM_R0 + (FOREARM_R1 - FOREARM_R0) * t) * 0.9);
        }
      }
    }
    const visible = shared !== null && now - shared.t < HOLD_MS;
    if (visible) {
      // Carry the whole shell along the same extrapolation the gear uses, so
      // the two stay locked together between inferences.
      extrapolatePosition(ZERO, shared.velocity, now - shared.t, _off);
      g.position.set(mirror ? -_off[0] : _off[0], _off[1], _off[2]);
    }
    g.visible = visible;
  });

  return (
    <group ref={groupRef} visible={false}>
      {spheres.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
      {forearm.map((m, i) => (
        <primitive key={`f${i}`} object={m} />
      ))}
      <primitive object={palm} />
    </group>
  );
}
