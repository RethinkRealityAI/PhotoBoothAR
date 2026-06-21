/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Jenna & Jake ambient background — drifting neon "shader orbs" rendered with
 * R3F (drei MeshDistortMaterial) over a midnight gradient. A CSS blur melts the
 * spheres into soft bloom so they read as festival light, not hard geometry.
 *
 * pointer-events-none, absolute inset-0 — never blocks UI. density caps low to
 * protect the camera/MediaPipe frame rate in the booth.
 */
import { Canvas, useFrame } from '@react-three/fiber';
import { MeshDistortMaterial } from '@react-three/drei';
import { useMemo, useRef } from 'react';
import type { Mesh } from 'three';

const ORB_COLORS = ['#FF2D9B', '#19E3FF', '#7A2BFF', '#C6FF1A', '#FF6FD6'];

function Orb({ seed, color }: { seed: number; color: string }) {
  const ref = useRef<Mesh>(null);
  const base = useMemo(() => {
    // Deterministic placement from the seed (no Math.random at module scope).
    const a = Math.sin(seed * 12.9898) * 43758.5453;
    const b = Math.sin(seed * 78.233) * 12543.987;
    const r1 = a - Math.floor(a);
    const r2 = b - Math.floor(b);
    return {
      x: (r1 * 2 - 1) * 3.6,
      y: (r2 * 2 - 1) * 2.4,
      z: -2 - (seed % 3),
      speed: 0.12 + (seed % 5) * 0.04,
      scale: 1.1 + (seed % 4) * 0.45,
    };
  }, [seed]);

  useFrame((state) => {
    const t = state.clock.elapsedTime * base.speed + seed;
    const m = ref.current;
    if (m) {
      m.position.set(base.x + Math.sin(t) * 1.3, base.y + Math.cos(t * 0.8) * 1.1, base.z);
    }
  });

  return (
    <mesh ref={ref} scale={base.scale}>
      <sphereGeometry args={[1, 40, 40]} />
      <MeshDistortMaterial
        color={color}
        emissive={color}
        emissiveIntensity={1.25}
        distort={0.42}
        speed={1.8}
        roughness={0.25}
        metalness={0.1}
        toneMapped={false}
      />
    </mesh>
  );
}

export default function FestivalBackground({ density = 6, className = '' }: { density?: number; className?: string }) {
  const orbs = useMemo(
    () =>
      Array.from({ length: Math.max(1, Math.min(density, 8)) }, (_, i) => ({
        seed: i * 1.6180339 + 1,
        color: ORB_COLORS[i % ORB_COLORS.length],
      })),
    [density],
  );

  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      aria-hidden
      style={{ background: 'radial-gradient(130% 100% at 50% 0%, #1B0A45 0%, #0B0220 62%)' }}
    >
      <div className="absolute inset-0" style={{ filter: 'blur(36px) saturate(150%)' }}>
        <Canvas
          camera={{ position: [0, 0, 6], fov: 58 }}
          gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
          dpr={[1, 1.5]}
        >
          <ambientLight intensity={0.9} />
          {orbs.map((o, i) => (
            <Orb key={i} seed={o.seed} color={o.color} />
          ))}
        </Canvas>
      </div>
    </div>
  );
}
