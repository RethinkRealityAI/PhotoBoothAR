/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HandRig — FaceRig's sibling for hand-anchored gear (wand in the fist,
 * gauntlet on the wrist). Children render in a group driven per frame from the
 * ONE smoothed, predicted palm pose that lib/handRig.ts steps for every
 * consumer (`stepHandPose`), so the gear here and the depth shell below cannot
 * disagree by a filter's lag: they are the same pose.
 *
 * Structure (RAW pose, reflected for a mirrored feed):
 *   <palm pose>                 position + quaternion from the driver
 *     <mount>                   the anchor's palm-LOCAL point, rotated by the
 *                               anchor's own rotation IN THE DRAWN HAND'S FRAME
 *       <scale>                 per-guest hand size (locked palm span)
 *         children              AnimatedPiece → HandPlacement → Model
 *
 * Which hand a piece is drawn on is published through HandMirrorContext as the
 * APPARENT hand (lib/studio/handedness.ts): in a mirrored selfie a real right
 * hand is drawn as a left one, and every chiral decision — mesh mirror,
 * placement reflection, the anchor's own rotation — keys on what is drawn.
 *
 * Also exports HandOccluder: a landmark-driven depth-only shell (spheres per
 * landmark + palm slab + forearm beads — ~600 tris, zero extra inference)
 * using FaceOccluder's exact material recipe, shrunk ~0.9× per the never-grow
 * z-fight rule, riding the SAME smoothed pose as the gear.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { detectHandsNow, stepHandPose, type HandPick } from '../../lib/handRig';
import { initializeHandLandmarker } from '../../lib/handTracking';
import { anchorLocalPoint, FOREARM_REACH_MAX_CM, HAND_ANCHOR_MAP } from '../../lib/handPose';
import { HandMirrorContext, useHandRender } from './handMirror';
import {
  anchorFrameRotation,
  apparentHand,
  mirrorPlacement,
  resolveHandRender,
  type HandFit,
  type ModelledHand,
  type TrackedHand,
} from '../../lib/studio/handedness';
import type { AssetTemplate } from '../../lib/studio/assetTemplate';
import type { AnchorConfig } from '../../types';

export interface HandRigProps {
  /** HAND_ANCHORS id — where the gear mounts on the hand. */
  anchor: string;
  videoId?: string;
  mirror?: boolean;
  /** Hold the RENDERED pose steady (a gizmo handle is being dragged) WITHOUT
   *  stopping tracking — FaceRig's contract, for the same reason: a piece that
   *  swims under the pointer cannot be placed, but freezing the feed makes the
   *  studio look crashed. Detection AND the filters keep running; only the
   *  write is skipped, so on release the piece glides to the live pose instead
   *  of snapping across the frame. */
  holdPose?: boolean;
  /** The host's authored hand pin for the piece in this rig ('auto' follows the
   *  tracker). Published to descendants so a hand-modelled asset can flip
   *  itself — see ./handMirror.ts. */
  fit?: HandFit;
  /** The template's declared hand for the piece in this rig, when it has one.
   *  With `fit` it decides which hand's frame the anchor rotation is in. */
  modelledHand?: ModelledHand;
  /** Which tracked hand to follow: a specific REAL hand, or whichever was seen
   *  last. Two rigs (Left + Right) for one 'auto' piece put it on both hands. */
  which?: HandPick;
  onVisibilityChange?: (visible: boolean) => void;
  children?: ReactNode;
}

/** The `<video>` for a rig, re-queried only when missing or detached. */
function useVideoElement(videoId: string) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => { ref.current = null; }, [videoId]);
  return (): HTMLVideoElement | null => {
    let v = ref.current;
    if (v === null || !v.isConnected) {
      v = document.getElementById(videoId) as HTMLVideoElement | null;
      ref.current = v;
    }
    return v;
  };
}

export function HandRig({
  anchor,
  videoId = 'booth-video',
  mirror = true,
  holdPose = false,
  fit = 'auto',
  modelledHand,
  which = 'any',
  onVisibilityChange,
  children,
}: HandRigProps) {
  const groupRef = useRef<THREE.Group>(null);
  const mountRef = useRef<THREE.Group>(null);
  const scaleRef = useRef<THREE.Group>(null);
  const def = HAND_ANCHOR_MAP[anchor] ?? HAND_ANCHOR_MAP.grip;
  // Which hand is being DRAWN, as STATE rather than a ref: descendants
  // re-render on it. Written only when it CHANGES (the ref below is the
  // per-frame value), so a guest holding one hand up costs zero renders —
  // swapping hands costs one.
  const [tracked, setTracked] = useState<TrackedHand>(null);
  const trackedRef = useRef<TrackedHand>(null);
  const visibleRef = useRef(false);
  const getVideo = useVideoElement(videoId);

  // The anchor's own rotation (HAND_ANCHORS, authored for the right hand) in
  // the frame this piece renders in: a pin decides it outright; 'auto' follows
  // the drawn hand, and holds the right-hand form until one is seen.
  const frameHand = resolveHandRender(modelledHand, fit, tracked).hand ?? 'right';
  const anchorEuler = useMemo(() => {
    const r = anchorFrameRotation(def.rotation, frameHand);
    return new THREE.Euler(r[0], r[1], r[2]);
  }, [def, frameHand]);

  // SELF-INITIALIZING tracking, exactly like FaceRig: the component that NEEDS
  // the landmarker owns starting it (idempotent — handTracking caches the init
  // promise). Without this, a hand-anchored wand in a scene with NO hand
  // trigger sources mounted a rig that never received a single frame: the only
  // detectHandsNow callers were the trigger loops, and both are gated on
  // triggers existing.
  useEffect(() => {
    initializeHandLandmarker().catch((e) => console.warn('[HandRig] hand tracker init failed', e));
  }, []);

  useFrame((state) => {
    const g = groupRef.current;
    const mount = mountRef.current;
    const sc = scaleRef.current;
    if (!g || !mount || !sc) return;
    const now = performance.now();
    // Self-driven detection (the FaceRig idiom): detectHandsNow self-throttles
    // (66ms gate, face-inference lockout, idle back-off), so extra callers in
    // the same tick are near-free no-ops.
    const vid = getVideo();
    if (vid) detectHandsNow(vid);
    // Stepped even while holding, so the filters never see a drag-long gap.
    const p = stepHandPose(which, state.clock.elapsedTime, now);
    const visible = p !== null && p.visible;
    if (holdPose) return; // g.position / quaternion / visible stay put
    if (visible) {
      const pos = p.position;
      const q = p.quaternion;
      // The mirrored feed: negate x, conjugate by diag(−1,1,1) — faceRig's
      // reflection — and the palm-local cloud reflects with it (x only).
      g.position.set(mirror ? -pos[0] : pos[0], pos[1], pos[2]);
      g.quaternion.set(q[0], mirror ? -q[1] : q[1], mirror ? -q[2] : q[2], q[3]);
      const a = anchorLocalPoint(def, p.local);
      mount.position.set(mirror ? -a[0] : a[0], a[1], a[2]);
      sc.scale.setScalar(p.scale);
      const drawn = apparentHand(p.hand, mirror);
      if (trackedRef.current !== drawn) {
        trackedRef.current = drawn;
        setTracked(drawn);
      }
    }
    g.visible = visible;
    if (visible !== visibleRef.current) {
      visibleRef.current = visible;
      onVisibilityChange?.(visible);
    }
  });

  const mirrorValue = useMemo(() => ({ tracked, fit }), [tracked, fit]);

  return (
    <group ref={groupRef} visible={false}>
      <group ref={mountRef} rotation={anchorEuler}>
        <group ref={scaleRef}>
          <HandMirrorContext.Provider value={mirrorValue}>{children}</HandMirrorContext.Provider>
        </group>
      </group>
    </group>
  );
}

/**
 * Applies a hand piece's authored placement, REFLECTED when this piece is
 * being drawn in the other hand's frame.
 *
 * This exists because mirroring the mesh is only half the job. `mirrorGeometryX`
 * flips vertices about the model's own local plane; the offset and rotation the
 * host tuned are applied outside it and do not move. A gauntlet nudged
 * (-0.7, -1.9, 2.1) and rotated (-98°, -14°, -4°) therefore mirrored into a pose
 * sitting BESIDE the hand — visibly worse than not mirroring at all. Reflecting
 * the placement with the mesh is what makes "one asset, both hands" true — and
 * for a hand-AGNOSTIC asset the placement reflects on its own, because a wand
 * tuned to exit the thumb side of a right fist must exit the thumb side of a
 * left one too.
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
  const { reflectPlacement } = useHandRender(template?.modelledHand, (template?.textSlots.length ?? 0) > 0);
  const { offset, rotation } = reflectPlacement ? mirrorPlacement(config) : config;
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
/** Unit capsule body: radius 1, height 1 along +Y, open-ended (the joint
 *  spheres cap it). One geometry, 21 meshes. */
const BONE = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
const SHRINK = 0.9;

/**
 * The bones a capsule spans, as landmark pairs: every finger segment plus the
 * palm's edges. Beads alone left a GAP between each pair of joints — a
 * fingertip sphere and a knuckle sphere 3cm apart with nothing between them —
 * and a held wand showed straight through every gap, which reads as "the hand
 * occluder does nothing". A capsule per bone closes the silhouette.
 */
const HAND_BONES: readonly [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [5, 6], [6, 7], [7, 8],
  [9, 10], [10, 11], [11, 12],
  [13, 14], [14, 15], [15, 16],
  [17, 18], [18, 19], [19, 20],
  [0, 5], [0, 17], [5, 9], [9, 13], [13, 17],
];
const Y_UP = new THREE.Vector3(0, 1, 0);
const _boneDir = new THREE.Vector3();

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
export const FOREARM_R0 = 2.7;
export const FOREARM_R1 = 3.6;

function occluderMesh(geometry: THREE.BufferGeometry = SPHERE): THREE.Mesh {
  const m = new THREE.Mesh(geometry, OCCLUDER_MATERIAL);
  m.renderOrder = -2;
  m.raycast = () => {};
  return m;
}

/**
 * Depth-only shell over the tracked hand so real fingers occlude held gear.
 * Mount INSIDE the same Canvas as the gear. Its beads are the palm-local
 * landmark cloud under the SAME smoothed pose the gear rides, refreshed each
 * detection, sized by the same per-guest hand scale.
 */
export function HandOccluder({ videoId = 'booth-video', mirror = true, which = 'any' }: { videoId?: string; mirror?: boolean; which?: HandPick }) {
  const groupRef = useRef<THREE.Group>(null);
  const getVideo = useVideoElement(videoId);
  // Same self-init as HandRig — an occluder mounted alone must also track.
  useEffect(() => {
    initializeHandLandmarker().catch((e) => console.warn('[HandOccluder] hand tracker init failed', e));
  }, []);
  const spheres = useMemo(() => Array.from({ length: 21 }, () => occluderMesh()), []);
  const bones = useMemo(() => HAND_BONES.map(() => occluderMesh(BONE)), []);
  const palm = useMemo(() => occluderMesh(), []);
  const forearm = useMemo(() => Array.from({ length: FOREARM_BEADS }, () => occluderMesh()), []);

  useFrame((state) => {
    const g = groupRef.current;
    if (!g) return;
    const now = performance.now();
    const vid = getVideo();
    if (vid) detectHandsNow(vid);
    const p = stepHandPose(which, state.clock.elapsedTime, now);
    const visible = p !== null && p.visible;
    g.visible = visible;
    if (!visible) return;
    const pos = p.position;
    const q = p.quaternion;
    g.position.set(mirror ? -pos[0] : pos[0], pos[1], pos[2]);
    g.quaternion.set(q[0], mirror ? -q[1] : q[1], mirror ? -q[2] : q[2], q[3]);
    const sx = mirror ? -1 : 1;
    const k = p.scale * SHRINK;
    const local = p.local;
    for (let i = 0; i < 21; i++) {
      const m = spheres[i];
      m.position.set(sx * local[i * 3], local[i * 3 + 1], local[i * 3 + 2]);
      m.scale.setScalar(landmarkRadiusCm(i) * k);
    }
    // Capsule bodies between the joints (radius = the thinner joint's, so a
    // knuckle-to-tip bone never bulges past its own fingertip).
    for (let b = 0; b < HAND_BONES.length; b++) {
      const [i, j] = HAND_BONES[b];
      const pa = spheres[i].position;
      const pb = spheres[j].position;
      _boneDir.subVectors(pb, pa);
      const len = _boneDir.length();
      const m = bones[b];
      if (!(len > 1e-4)) { m.visible = false; continue; }
      m.visible = true;
      m.position.addVectors(pa, pb).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(Y_UP, _boneDir.multiplyScalar(1 / len));
      const r = Math.min(landmarkRadiusCm(i), landmarkRadiusCm(j)) * k;
      m.scale.set(r, len, r);
    }
    // Palm slab: centred between wrist and middle MCP, flattened along the
    // palm normal. In the hand frame that is an axis-aligned ellipsoid, so it
    // turns with the hand for free (it used to be re-oriented per frame).
    palm.position.set(
      sx * (local[0] + local[27]) / 2,
      (local[1] + local[28]) / 2,
      (local[2] + local[29]) / 2,
    );
    palm.scale.set(3.6 * k, 4.2 * k, 1.6 * k);
    // Forearm beads, from the wrist elbow-ward: the hand frame's −Y, the SAME
    // axis the forearm anchor mounts along, so the shell cannot drift from
    // where a sleeve is mounted.
    for (let i = 0; i < FOREARM_BEADS; i++) {
      // Start one bead PAST the wrist so the shell does not double up on the
      // wrist sphere, and stop at the reach the inference supports.
      const t = (i + 1) / FOREARM_BEADS;
      const m = forearm[i];
      m.position.set(sx * local[0], local[1] - FOREARM_REACH_MAX_CM * t, local[2]);
      m.scale.setScalar((FOREARM_R0 + (FOREARM_R1 - FOREARM_R0) * t) * k);
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      {spheres.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
      {bones.map((m, i) => (
        <primitive key={`b${i}`} object={m} />
      ))}
      {forearm.map((m, i) => (
        <primitive key={`f${i}`} object={m} />
      ))}
      <primitive object={palm} />
    </group>
  );
}
