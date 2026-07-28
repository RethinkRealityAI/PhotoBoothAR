/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared R3F components for face-anchored AR. Used identically by the booth and
 * the studio 3D editor so placement is true WYSIWYG.
 */
import { useRef, useEffect, useState, ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three-stdlib';
import { initializeFaceLandmarker } from '../../lib/faceTracking';
import { updateHeadPose, detectFaceNow, scaledAnchorBase, ANCHOR_MAP } from '../../lib/faceRig';
import { AnchorConfig, HeadAnchor } from '../../types';
import AssetGizmo from './AssetGizmo';
import FaceOccluder from './FaceOccluder';

/** Loads + caches a GLB/GLTF model from a url. */
const _cache = new Map<string, Promise<THREE.Group>>();
function loadModel(url: string): Promise<THREE.Group> {
  if (!_cache.has(url)) {
    const loader = new GLTFLoader();
    _cache.set(
      url,
      new Promise((resolve, reject) => loader.load(url, (g) => resolve(g.scene), undefined, reject)),
    );
  }
  return _cache.get(url)!;
}

export function Model({ url }: { url: string }) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  useEffect(() => {
    let alive = true;
    loadModel(url)
      .then((s) => alive && setScene(s.clone(true)))
      .catch((e) => console.error('[Model] load failed', url, e));
    return () => {
      alive = false;
    };
  }, [url]);
  if (!scene) return null;
  return <primitive object={scene} />;
}

/**
 * Tracks the head each frame and parents `children` at the chosen anchor with a
 * fine offset/rotation/scale. `videoId` is the DOM id of the source <video>.
 *
 * `mirror` must be true whenever the preview is shown mirrored (front camera).
 * When `editable`, an all-in-one transform gizmo is shown on the asset and edits
 * are reported via `onTransformChange` (used by the studio live editor).
 */
export function FaceRig({
  videoId,
  anchor,
  config,
  holdPose = false,
  mirror = false,
  editable = false,
  occlude = false,
  headScale = 1,
  debugOcclusion = false,
  matrixRef,
  onVisibilityChange,
  onTransformChange,
  onGizmoDragStart,
  onGizmoDragEnd,
  children,
}: {
  videoId: string;
  anchor: HeadAnchor;
  config?: Partial<AnchorConfig>;
  /** Hold the RENDERED pose steady (used while a gizmo is being dragged, so the
   *  asset does not swim under the pointer) WITHOUT stopping tracking: detection,
   *  blendshapes and the trigger engine keep running throughout. */
  holdPose?: boolean;
  mirror?: boolean;
  editable?: boolean;
  /** Render the invisible depth-only head so props behind it are hidden. */
  occlude?: boolean;
  /** Head-size calibration multiplier for the occluder (studio headScale). */
  headScale?: number;
  /** Show the occluder faintly for tuning. */
  debugOcclusion?: boolean;
  /** Written each visible frame with the tracked head's world matrix (16
   *  column-major floats) so DOM-level drag-and-drop can project anchors. */
  matrixRef?: React.MutableRefObject<number[] | null>;
  onVisibilityChange?: (visible: boolean) => void;
  onTransformChange?: (patch: Partial<AnchorConfig>) => void;
  onGizmoDragStart?: () => void;
  onGizmoDragEnd?: () => void;
  children: ReactNode;
}) {
  const head = useRef<THREE.Group>(null);
  // null = not yet reported: the FIRST frame always fires onVisibilityChange,
  // so a consumer mounting mid-track gets the true state immediately instead
  // of waiting for the next visibility flip.
  const visibleRef = useRef<boolean | null>(null);

  // SELF-INITIALIZING tracking: the component that NEEDS the landmarker owns
  // starting it. Idempotent (faceTracking caches the init promise), so hosts
  // that pre-warm it (Booth, DemoBooth) pay nothing extra — and no future
  // surface can silently ship a FaceRig that never tracks because its shell
  // forgot the init call (exactly the regression that broke the studio's
  // live 3D view when LiveCanvas, which used to init, was retired).
  useEffect(() => {
    initializeFaceLandmarker().catch((e) => console.warn('[FaceRig] face tracker init failed', e));
  }, []);

  // A stale matrix is worse than none: drag-and-drop projects anchors through
  // this ref, so leaving the last pose behind after this rig stops driving it
  // snaps drops to where the head WAS. Clear on unmount.
  useEffect(() => () => { if (matrixRef) matrixRef.current = null; }, [matrixRef]);

  useFrame(() => {
    const group = head.current;
    if (!group) return;
    const video = document.getElementById(videoId) as HTMLVideoElement | null;
    if (holdPose) {
      // Keep DETECTING — blendshapes, the trigger engine and the head-fit
      // estimator all read the shared detection, and the host should never see
      // the feed freeze just because they grabbed a handle. Only the rendered
      // pose is held, so the piece stays put under the pointer.
      if (video) detectFaceNow(video);
      return;
    }
    const visible = video ? updateHeadPose(group, video, mirror) : false;
    group.visible = visible;
    if (matrixRef) {
      if (visible) {
        group.updateWorldMatrix(true, false);
        matrixRef.current = group.matrixWorld.elements.slice();
      } else {
        matrixRef.current = null;
      }
    }
    if (visible !== visibleRef.current) {
      visibleRef.current = visible;
      onVisibilityChange?.(visible);
    }
  });

  // Anchors scale WITH the calibrated head — otherwise raising headScale grows
  // the occluder around a prop that stayed put, and the head eats it.
  const base = scaledAnchorBase(ANCHOR_MAP[anchor]?.offset ?? [0, 0, 0], headScale);

  return (
    <group ref={head} visible={false}>
      {/* Depth-only head: a sibling of the asset (NOT inside the gizmo) so the
          real head occludes props regardless of the prop's placement. */}
      {occlude && <FaceOccluder scale={headScale} debug={debugOcclusion} />}
      <AssetGizmo
        base={base}
        config={config ?? {}}
        enabled={editable}
        onChange={onTransformChange}
        onDragStart={onGizmoDragStart}
        onDragEnd={onGizmoDragEnd}
      >
        {children}
      </AssetGizmo>
    </group>
  );
}
