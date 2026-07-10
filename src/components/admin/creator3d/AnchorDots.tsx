/**
 * Renders anchor positions as glowing gold dots with text labels.
 * The active anchor gets a bigger halo + pulsing ring.
 */
import { Suspense, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import { ANCHOR_PRESETS, ANCHOR_MAP } from '../../../lib/faceRig';
import { HeadAnchor } from '../../../types';

// Beam-accent dots so the anchor picker matches the platform theme.
const GOLD   = '#5B8CFF';
const ACTIVE = '#A9C4FF';

interface Props {
  activeAnchor: HeadAnchor;
  onSelect: (a: HeadAnchor) => void;
}

/** Single dot: world-position is the anchor's base offset (no user config yet). */
function AnchorDot({
  preset,
  active,
  onSelect,
}: {
  preset: typeof ANCHOR_PRESETS[0];
  active: boolean;
  onSelect: () => void;
}) {
  const ringRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (ringRef.current && active) {
      const s = 1 + 0.25 * Math.sin(clock.getElapsedTime() * 3.5);
      ringRef.current.scale.setScalar(s);
    }
  });

  const [bx, by, bz] = ANCHOR_MAP[preset.id].offset;

  return (
    <group position={[bx, by, bz]}>
      {/* clickable sphere */}
      <mesh onClick={() => onSelect()} renderOrder={1}>
        <sphereGeometry args={[active ? 0.72 : 0.52, 12, 10]} />
        <meshStandardMaterial
          color={active ? ACTIVE : GOLD}
          emissive={active ? ACTIVE : GOLD}
          emissiveIntensity={active ? 1.8 : 0.9}
          roughness={0.15}
          metalness={0.8}
          toneMapped={false}
        />
      </mesh>

      {/* pulsing halo ring when active */}
      {active && (
        <mesh ref={ringRef} renderOrder={0}>
          <torusGeometry args={[1.05, 0.12, 8, 28]} />
          <meshStandardMaterial
            color={ACTIVE}
            emissive={ACTIVE}
            emissiveIntensity={2.2}
            transparent
            opacity={0.65}
            toneMapped={false}
          />
        </mesh>
      )}

      {/* label always faces camera. drei <Text> SUSPENDS while troika fetches
          its font (a CDN request) — the Suspense keeps that contained to the
          label, so a slow/blocked font network never suspends the canvas (and,
          through it, the app's route boundary: that rendered a black page). */}
      <Billboard>
        <Suspense fallback={null}>
        <Text
          position={[0, active ? 1.6 : 1.25, 0]}
          fontSize={active ? 1.05 : 0.85}
          color={active ? ACTIVE : '#9DB6E8'}
          anchorX="center"
          anchorY="bottom"
          fillOpacity={active ? 1 : 0.75}
          outlineWidth={0.07}
          outlineColor="#05060B"
          renderOrder={2}
        >
          {preset.label}
        </Text>
        </Suspense>
      </Billboard>
    </group>
  );
}

export default function AnchorDots({ activeAnchor, onSelect }: Props) {
  return (
    <group>
      {ANCHOR_PRESETS.map((p) => (
        <AnchorDot
          key={p.id}
          preset={p}
          active={p.id === activeAnchor}
          onSelect={() => onSelect(p.id)}
        />
      ))}
    </group>
  );
}
