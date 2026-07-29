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
import { initializeFaceLandmarker } from '../../lib/faceTracking';
import { updateHeadPose, detectFaceNow, scaledAnchorBase, ANCHOR_MAP } from '../../lib/faceRig';
import { loadModel } from '../../lib/glbCache';
import { describeGlbError } from '../../lib/glbErrors';
import { resolveFinish, type FinishOverride } from '../../lib/studio/finish';
import { AnchorConfig, HeadAnchor } from '../../types';
import AssetGizmo from './AssetGizmo';
import FaceOccluder from './FaceOccluder';

/**
 * Repaint a CLONED scene graph with a resolved finish.
 *
 * `Object3D.clone(true)` copies the node tree but SHARES geometries and
 * materials with the cached master, so mutating `mesh.material` in place would
 * restyle every other copy of that model in the app — including the one the
 * guest is wearing. Every material touched here is therefore cloned first, and
 * the clones are handed back so the caller can dispose exactly them (never the
 * shared originals) when the piece unmounts.
 */
function applyFinish(
  root: THREE.Object3D,
  finish: unknown,
  tint: unknown,
  tintStrength: unknown,
): THREE.Material[] {
  const created: THREE.Material[] = [];
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const next = mats.map((m) => {
      const std = m as THREE.MeshStandardMaterial;
      const baseHex = std.color ? `#${std.color.getHexString()}` : '#ffffff';
      const o: FinishOverride | null = resolveFinish(finish, tint, tintStrength, baseHex);
      if (!o) return m; // nothing to change — keep the shared original untouched
      // Glass needs transmission/ior/thickness, which only exist on
      // MeshPhysicalMaterial. It extends MeshStandardMaterial, so .copy()
      // carries every map, uv transform and alpha setting across intact.
      const clone = o.physical
        ? new THREE.MeshPhysicalMaterial().copy(std)
        : (m.clone() as THREE.MeshStandardMaterial);
      if (o.color && clone.color) clone.color.set(o.color);
      clone.metalness = o.metalness;
      clone.roughness = o.roughness;
      if (o.emissive && clone.emissive) {
        clone.emissive.set(o.emissive);
        clone.emissiveIntensity = o.emissiveIntensity;
      }
      clone.transparent = o.transparent;
      clone.opacity = o.opacity;
      if (o.physical) {
        const phys = clone as THREE.MeshPhysicalMaterial;
        phys.transmission = o.transmission;
        phys.ior = o.ior;
        phys.thickness = o.thickness;
      }
      clone.needsUpdate = true;
      created.push(clone);
      return clone;
    });
    obj.material = Array.isArray(obj.material) ? next : next[0];
  });
  return created;
}

export function Model({
  url,
  onReady,
  onError,
  finish,
  tint,
  tintStrength,
}: {
  url: string;
  /**
   * Fires ONCE per successful load, after the bytes are downloaded AND parsed
   * AND cloned — i.e. on the frame this component can actually draw geometry.
   *
   * The booth used to approximate this by fetching the .glb itself and calling
   * it ready when the response ended (Booth.warmAsset), which excludes parse
   * time entirely: on a phone a 12 MB Meshy model parses for hundreds of ms
   * AFTER the last byte, so the "it's here!" reveal animation played over an
   * empty frame. Omitting this prop is byte-identical to not having it.
   */
  onReady?: () => void;
  /** Fires with host-readable copy when the model cannot be loaded at all. */
  onError?: (message: string) => void;
  /** lib/studio/finish.ts — undefined/'original' leaves the material alone. */
  finish?: string | null;
  tint?: string | null;
  tintStrength?: number | null;
}) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  // Callbacks live in refs, not in the effect's deps: a caller passing an inline
  // arrow (every caller does) would otherwise re-download and re-clone the whole
  // model on every render of its parent.
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  onReadyRef.current = onReady;
  onErrorRef.current = onError;

  useEffect(() => {
    let alive = true;
    let owned: THREE.Material[] = [];
    loadModel(url)
      .then((s) => {
        if (!alive) return;
        const clone = s.clone(true);
        owned = applyFinish(clone, finish, tint, tintStrength);
        setScene(clone);
        // AFTER the state that will render it, so a consumer that reveals on
        // this callback can never beat the geometry to the screen.
        onReadyRef.current?.();
      })
      .catch((e) => {
        const { message } = describeGlbError(e);
        console.error('[Model] load failed', url, message, e);
        if (alive) onErrorRef.current?.(message);
      });
    return () => {
      alive = false;
      // Only the materials THIS clone created — the geometries and the original
      // materials belong to the shared cache and outlive every clone.
      for (const m of owned) m.dispose();
      owned = [];
    };
  }, [url, finish, tint, tintStrength]);
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
