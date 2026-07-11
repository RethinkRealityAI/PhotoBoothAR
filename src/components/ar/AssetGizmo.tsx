/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AssetGizmo — wraps an attached asset in an ALL-IN-ONE transform gizmo
 * (translate arrows + rotate rings + scale sliders, simultaneously) so the
 * author never switches tools. Used by BOTH the model editor and the live
 * face-tracked editor, so calibration is identical in either preview.
 *
 * The gizmo's parent group sits at the anchor BASE (centimetres); the pivot's
 * local matrix therefore IS the fine transform we persist (offset/rotation/
 * scale relative to the anchor). When `enabled` is false it renders the asset
 * statically at the saved transform (booth / non-editing).
 */
import { useMemo, type ReactNode } from 'react';
import { PivotControls } from '@react-three/drei';
import * as THREE from 'three';
import { composeAnchorMatrix, decomposeAnchorMatrix } from '../../lib/faceRig';
import { AnchorConfig } from '../../types';

const ZERO: [number, number, number] = [0, 0, 0];

interface Props {
  base: readonly [number, number, number];
  config: Partial<AnchorConfig>;
  enabled?: boolean;
  onChange?: (patch: Partial<AnchorConfig>) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  children: ReactNode;
}

export default function AssetGizmo({
  base,
  config,
  enabled = false,
  onChange,
  onDragStart,
  onDragEnd,
  children,
}: Props) {
  const off = config.offset ?? { x: 0, y: 0, z: 0 };
  const rot = config.rotation ?? { x: 0, y: 0, z: 0 };
  const scale = config.scale ?? 1;

  // matrix is in the pivot's LOCAL frame (parent already at base), so no base here
  const matrix = useMemo(
    () => composeAnchorMatrix(ZERO, off, rot, scale, new THREE.Matrix4()),
    [off.x, off.y, off.z, rot.x, rot.y, rot.z, scale],
  );

  if (!enabled) {
    return (
      <group
        position={[base[0] + off.x, base[1] + off.y, base[2] + off.z]}
        rotation={[rot.x, rot.y, rot.z]}
        scale={[scale, scale, scale]}
      >
        {children}
      </group>
    );
  }

  return (
    <group position={[base[0], base[1], base[2]]}>
      <PivotControls
        matrix={matrix}
        autoTransform
        depthTest={false}
        // Screen-fixed sizing (px). The old world-space scale={11} also DIVIDED
        // drei's scale-sphere drag sensitivity by 11 (translate/rotate stay 1:1)
        // — the scale handles read as dead. `fixed` uses the raw drag offset.
        fixed
        scale={90}
        // Match the properties-panel slider range so a drag can't zero/blow up.
        scaleLimits={[[0.05, 15], [0.05, 15], [0.05, 15]]}
        lineWidth={3}
        axisColors={['#E25563', '#7CC36B', '#5B8BE0']}
        hoveredColor="#F5C842"
        onDragStart={() => onDragStart?.()}
        onDragEnd={() => onDragEnd?.()}
        onDrag={(l) => onChange?.(decomposeAnchorMatrix(ZERO, l))}
      >
        <group>{children}</group>
      </PivotControls>
    </group>
  );
}
