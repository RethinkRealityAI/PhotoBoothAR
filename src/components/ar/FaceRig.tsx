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
import { updateHeadPose, ANCHOR_MAP } from '../../lib/faceRig';
import { AnchorConfig, HeadAnchor } from '../../types';
import AssetGizmo from './AssetGizmo';

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
  paused = false,
  mirror = false,
  editable = false,
  onVisibilityChange,
  onTransformChange,
  onGizmoDragStart,
  onGizmoDragEnd,
  children,
}: {
  videoId: string;
  anchor: HeadAnchor;
  config?: Partial<AnchorConfig>;
  paused?: boolean;
  mirror?: boolean;
  editable?: boolean;
  onVisibilityChange?: (visible: boolean) => void;
  onTransformChange?: (patch: Partial<AnchorConfig>) => void;
  onGizmoDragStart?: () => void;
  onGizmoDragEnd?: () => void;
  children: ReactNode;
}) {
  const head = useRef<THREE.Group>(null);
  const visibleRef = useRef(false);

  useFrame(() => {
    const group = head.current;
    if (!group) return;
    if (paused) return;
    const video = document.getElementById(videoId) as HTMLVideoElement | null;
    const visible = video ? updateHeadPose(group, video, mirror) : false;
    group.visible = visible;
    if (visible !== visibleRef.current) {
      visibleRef.current = visible;
      onVisibilityChange?.(visible);
    }
  });

  const base = ANCHOR_MAP[anchor]?.offset ?? ([0, 0, 0] as [number, number, number]);

  return (
    <group ref={head} visible={false}>
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
