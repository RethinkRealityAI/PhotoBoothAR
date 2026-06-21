/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Procedural gold AR head pieces (crowns, tiara, cheek gems) authored in a
 * compact local space, then scaled to head CENTIMETRES by HEAD_PIECE_UNIT so
 * they sit on the real anchors. Rendered by both the booth and the studio (no
 * external GLB needed).
 *
 * Anchor reference (faceRig.ts ANCHOR_PRESETS, centimetres): crown ≈ y+8.3,
 * forehead ≈ y+5.5, ears ≈ x±7.7, cheeks ≈ (±3.6,-2,5). Each piece's geometry
 * is authored at roughly half-cm scale and multiplied up by HEAD_PIECE_UNIT.
 */
import { useMemo, type ReactNode } from 'react';
import * as THREE from 'three';

/** Converts the pieces' compact authoring units to head centimetres. */
const HEAD_PIECE_UNIT = 1.9;

const GOLD = '#D4AF37';
const GOLD_LIGHT = '#F0DC9A';
const RUBY = '#9C1B33';
const SAPPHIRE = '#1E4D8C';
const EMERALD = '#1E7A4D';

function GoldMat({ color = GOLD, emissive = 0.18 }: { color?: string; emissive?: number }) {
  return (
    <meshStandardMaterial
      color={color}
      metalness={0.95}
      roughness={0.22}
      emissive={color}
      emissiveIntensity={emissive}
    />
  );
}

function JewelMat({ color }: { color: string }) {
  return <meshStandardMaterial color={color} metalness={0.3} roughness={0.1} emissive={color} emissiveIntensity={0.35} />;
}

/** Flat 4-point sparkle star geometry (extruded), reused for gems/stars. */
function useStarGeometry(points = 4, outer = 0.5, inner = 0.18, depth = 0.12) {
  return useMemo(() => {
    const shape = new THREE.Shape();
    const n = points * 2;
    for (let i = 0; i < n; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2 });
    geo.center();
    return geo;
  }, [points, outer, inner, depth]);
}

function SparkleStar({ position, scale = 1, color = GOLD_LIGHT }: { position: [number, number, number]; scale?: number; color?: string }) {
  const geo = useStarGeometry(4, 0.5, 0.16, 0.1);
  return (
    <mesh geometry={geo} position={position} scale={scale}>
      <meshStandardMaterial color={color} metalness={0.9} roughness={0.15} emissive={color} emissiveIntensity={0.5} />
    </mesh>
  );
}

/* ---------------------------------------------------------------- */
/* Royal Crown                                                       */
/* ---------------------------------------------------------------- */
function RoyalCrown() {
  const points = 8;
  const bandR = 3.5;
  return (
    <group>
      {/* Band */}
      <mesh position={[0, 0, 0]}>
        <cylinderGeometry args={[bandR, bandR, 1.5, 48, 1, true]} />
        <GoldMat />
      </mesh>
      {/* Rims */}
      <mesh position={[0, 0.75, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[bandR, 0.12, 12, 48]} />
        <GoldMat color={GOLD_LIGHT} />
      </mesh>
      <mesh position={[0, -0.75, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[bandR, 0.12, 12, 48]} />
        <GoldMat color={GOLD_LIGHT} />
      </mesh>
      {/* Points (cones) + jewel tips */}
      {Array.from({ length: points }).map((_, i) => {
        const a = (i / points) * Math.PI * 2;
        const x = Math.cos(a) * bandR;
        const z = Math.sin(a) * bandR;
        return (
          <group key={i} position={[x, 0.75, z]} rotation={[0, -a, 0]}>
            <mesh position={[0, 1.0, 0]}>
              <coneGeometry args={[0.5, 2.0, 4]} />
              <GoldMat />
            </mesh>
            <mesh position={[0, 2.1, 0]}>
              <sphereGeometry args={[0.22, 16, 16]} />
              <JewelMat color={i % 3 === 0 ? RUBY : i % 3 === 1 ? SAPPHIRE : EMERALD} />
            </mesh>
          </group>
        );
      })}
      {/* Band jewels */}
      {Array.from({ length: points }).map((_, i) => {
        const a = ((i + 0.5) / points) * Math.PI * 2;
        const x = Math.cos(a) * (bandR + 0.05);
        const z = Math.sin(a) * (bandR + 0.05);
        return (
          <mesh key={`j${i}`} position={[x, 0, z]}>
            <sphereGeometry args={[0.2, 16, 16]} />
            <JewelMat color={i % 2 === 0 ? RUBY : EMERALD} />
          </mesh>
        );
      })}
    </group>
  );
}

/* ---------------------------------------------------------------- */
/* Queen's Tiara (delicate front arc)                                */
/* ---------------------------------------------------------------- */
function QueenTiara() {
  const r = 3.2;
  return (
    <group>
      {/* Front arc band (about 140°) */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[r, 0.1, 12, 48, Math.PI * 0.8]} />
        <GoldMat color={GOLD_LIGHT} />
      </mesh>
      {/* Central teardrop gem */}
      <group position={[0, 0.9, r]}>
        <mesh>
          <octahedronGeometry args={[0.42, 0]} />
          <JewelMat color={SAPPHIRE} />
        </mesh>
        <mesh position={[0, 0.5, 0]}>
          <sphereGeometry args={[0.16, 12, 12]} />
          <GoldMat color={GOLD_LIGHT} />
        </mesh>
      </group>
      {/* Small graduated gems along the arc */}
      {Array.from({ length: 6 }).map((_, i) => {
        const t = (i - 2.5) / 6;
        const a = Math.PI / 2 + t * Math.PI * 0.8;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const yy = 0.25 + (1 - Math.abs(t) * 2) * 0.3;
        return (
          <mesh key={i} position={[x, yy, z]}>
            <octahedronGeometry args={[0.16, 0]} />
            <JewelMat color={i % 2 === 0 ? RUBY : EMERALD} />
          </mesh>
        );
      })}
    </group>
  );
}

/* ---------------------------------------------------------------- */
/* Cheek Stars (two gold sparkles on the cheeks)                     */
/* anchored at noseBridge; gems offset to left/right cheeks           */
/* ---------------------------------------------------------------- */
function CheekStars() {
  // anchored at noseBridge; positions (× HEAD_PIECE_UNIT) land on the cheeks.
  return (
    <group>
      <SparkleStar position={[-1.7, -2.2, -0.4]} scale={1.1} />
      <SparkleStar position={[-1.15, -1.5, -0.3]} scale={0.5} color={GOLD} />
      <SparkleStar position={[1.7, -2.2, -0.4]} scale={1.1} />
      <SparkleStar position={[1.15, -1.5, -0.3]} scale={0.5} color={GOLD} />
    </group>
  );
}

/* ---------------------------------------------------------------- */
/* Halo of Hope (floating golden ring above the head)               */
/* ---------------------------------------------------------------- */
function HopeHalo() {
  return (
    <group>
      <mesh rotation={[Math.PI / 2.1, 0, 0]}>
        <torusGeometry args={[2.6, 0.16, 16, 64]} />
        <meshStandardMaterial color={GOLD_LIGHT} metalness={0.6} roughness={0.1} emissive={GOLD_LIGHT} emissiveIntensity={0.9} />
      </mesh>
      {Array.from({ length: 12 }).map((_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return <SparkleStar key={i} position={[Math.cos(a) * 2.6, 0.1, Math.sin(a) * 2.6]} scale={0.4} />;
      })}
    </group>
  );
}

/* ---------------------------------------------------------------- */
/* Registry                                                          */
/* ---------------------------------------------------------------- */
const COMPONENTS: Record<string, () => ReactNode> = {
  'royal-crown': RoyalCrown,
  'queen-tiara': QueenTiara,
  'cheek-stars': CheekStars,
  'hope-halo': HopeHalo,
};

/** True when a procedural head piece exists for this id. */
export function isHeadPiece(id?: string | null): boolean {
  return !!id && id in COMPONENTS;
}

/** Renders the procedural head piece for the given id (or null), scaled to cm. */
export function HeadPiece({ id }: { id: string }) {
  const Comp = COMPONENTS[id];
  if (!Comp) return null;
  return (
    <group scale={HEAD_PIECE_UNIT}>
      <Comp />
    </group>
  );
}
