/**
 * Anchor (attachment point) picker for the studio's 3D orbit view.
 *
 * Two rules make this readable, and both matter:
 *
 * 1. DOTS DRAW OVER THE HEAD. Every dot renders with depthTest off and a high
 *    renderOrder, so a picker can never be swallowed by the reference bust. The
 *    fit in lib/studio/bustFit.ts already keeps all 12 anchors outside the mesh,
 *    but that depends on whichever bust CI has vendored — this makes visibility
 *    unconditional rather than a property of the current asset. Raycasting is
 *    unaffected by depthTest, so the dots stay clickable.
 * 2. ONE LABEL AT A TIME. Labels show for the ACTIVE anchor and whatever the
 *    pointer is over. Twelve permanent floating captions around a head is noise,
 *    and they collide with each other at the eyes/cheeks/mouth cluster.
 */
import { Suspense, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import { ANCHOR_PRESETS, ANCHOR_MAP, scaledAnchorBase } from '../../../lib/faceRig';
import { HeadAnchor } from '../../../types';

// Beam-accent dots so the anchor picker matches the platform theme.
const IDLE   = '#5B8CFF';
const ACTIVE = '#A9C4FF';

/** Radius of the invisible sphere that catches clicks — comfortably bigger than
 *  the visible dot so the picker is not a pixel hunt on a rotating head. */
const HIT_RADIUS = 1.7;

interface Props {
  activeAnchor: HeadAnchor;
  onSelect: (a: HeadAnchor) => void;
  /** Head-size calibration — the dots must ride the same scaled anchor base the
   *  live rig uses, or they drift off a calibrated reference head. 1 = default. */
  headScale?: number;
}

/** Single dot: world-position is the anchor's base offset (no user config yet). */
function AnchorDot({
  preset,
  active,
  onSelect,
  headScale = 1,
}: {
  preset: typeof ANCHOR_PRESETS[0];
  active: boolean;
  onSelect: () => void;
  headScale?: number;
}) {
  const ringRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  useFrame(({ clock }) => {
    if (ringRef.current && active) {
      const s = 1 + 0.25 * Math.sin(clock.getElapsedTime() * 3.5);
      ringRef.current.scale.setScalar(s);
    }
  });

  const [bx, by, bz] = scaledAnchorBase(ANCHOR_MAP[preset.id].offset, headScale);
  const lit = active || hovered;
  const radius = active ? 0.72 : hovered ? 0.64 : 0.5;

  return (
    <group position={[bx, by, bz]}>
      {/* Generous invisible hit target. `visible={false}` would remove it from
          raycasting entirely, so this is a fully transparent material instead. */}
      <mesh
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
        onPointerOut={() => setHovered(false)}
      >
        <sphereGeometry args={[HIT_RADIUS, 8, 6]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Visible dot — always drawn over the bust (see file header). */}
      <mesh renderOrder={20} raycast={() => null}>
        <sphereGeometry args={[radius, 16, 12]} />
        <meshStandardMaterial
          color={lit ? ACTIVE : IDLE}
          emissive={lit ? ACTIVE : IDLE}
          emissiveIntensity={active ? 1.8 : hovered ? 1.4 : 0.85}
          roughness={0.15}
          metalness={0.8}
          toneMapped={false}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>

      {/* Soft halo so a dot still reads against a light patch of the bust. */}
      <mesh renderOrder={19} raycast={() => null}>
        <sphereGeometry args={[radius * 1.9, 16, 12]} />
        <meshBasicMaterial
          color={lit ? ACTIVE : IDLE}
          transparent
          opacity={lit ? 0.22 : 0.1}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* pulsing halo ring when active */}
      {active && (
        <mesh ref={ringRef} renderOrder={21} raycast={() => null}>
          <torusGeometry args={[1.05, 0.1, 8, 28]} />
          <meshStandardMaterial
            color={ACTIVE}
            emissive={ACTIVE}
            emissiveIntensity={2.2}
            transparent
            opacity={0.65}
            toneMapped={false}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>
      )}

      {/* Label for the active/hovered anchor only. drei <Text> SUSPENDS while
          troika fetches its font (a CDN request) — the Suspense keeps that
          contained to the label, so a slow/blocked font network never suspends
          the canvas (and, through it, the app's route boundary: that rendered a
          black page). */}
      {lit && (
        <Billboard>
          <Suspense fallback={null}>
            <Text
              position={[0, 1.7, 0]}
              fontSize={1.05}
              color={ACTIVE}
              anchorX="center"
              anchorY="bottom"
              outlineWidth={0.08}
              outlineColor="#05060B"
              renderOrder={22}
              raycast={() => null}
            >
              {preset.label}
            </Text>
          </Suspense>
        </Billboard>
      )}
    </group>
  );
}

export default function AnchorDots({ activeAnchor, onSelect, headScale = 1 }: Props) {
  return (
    <group>
      {ANCHOR_PRESETS.map((p) => (
        <AnchorDot
          key={p.id}
          preset={p}
          active={p.id === activeAnchor}
          onSelect={() => onSelect(p.id)}
          headScale={headScale}
        />
      ))}
    </group>
  );
}
