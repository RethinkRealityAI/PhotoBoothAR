/**
 * Stylised reference head built from R3F primitives, sized to the SAME
 * centimetre head-space the tracker uses (faceRig.ts):
 *   crown y≈+8.3   ears x≈±7.6   chin y≈−9.4   nose-tip z≈+7.4
 * So an anchor dot / asset placed here lands on the same feature on a real
 * tracked face. Matte ivory so gold assets pop against it.
 */
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const IVORY   = new THREE.MeshStandardMaterial({ color: '#F2ECE1', roughness: 0.82, metalness: 0.05 });
const IVORY_D = new THREE.MeshStandardMaterial({ color: '#D8D2C6', roughness: 0.9,  metalness: 0.02 });
const DARK    = new THREE.MeshStandardMaterial({ color: '#4A4339', roughness: 0.6,  metalness: 0.1 });

export default function ReferenceHead() {
  // gentle idle turn so the head reads as 3D
  const rootRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (rootRef.current) {
      rootRef.current.rotation.y = Math.sin(clock.getElapsedTime() * 0.35) * 0.12;
    }
  });

  return (
    <group ref={rootRef}>
      {/* ── cranium ── slightly egg-shaped sphere, top ≈ y+8.5 */}
      <mesh position={[0, 2.0, -0.4]} scale={[1, 1.12, 1.05]} material={IVORY}>
        <sphereGeometry args={[6.6, 32, 28]} />
      </mesh>

      {/* ── face front / mid-face ── pushed forward so nose region reads */}
      <mesh position={[0, 0.4, 1.4]} scale={[0.94, 1.05, 0.95]} material={IVORY}>
        <sphereGeometry args={[6.2, 32, 26]} />
      </mesh>

      {/* ── jaw ── tapered to the chin (chin tip ≈ y−9) */}
      <mesh position={[0, -4.4, 1.0]} rotation={[0.14, 0, 0]} scale={[0.82, 1, 0.86]} material={IVORY}>
        <sphereGeometry args={[5.4, 28, 24]} />
      </mesh>
      <mesh position={[0, -7.6, 2.2]} scale={[0.78, 0.9, 0.82]} material={IVORY}>
        <sphereGeometry args={[3.0, 20, 16]} />
      </mesh>

      {/* ── nose ── bridge + tip (tip ≈ z+7.4) */}
      <mesh position={[0, 2.2, 5.6]} rotation={[0.34, 0, 0]} material={IVORY_D}>
        <cylinderGeometry args={[0.5, 0.95, 4.4, 10]} />
      </mesh>
      <mesh position={[0, -0.2, 7.0]} material={IVORY_D}>
        <sphereGeometry args={[1.15, 14, 12]} />
      </mesh>

      {/* ── ears (x ≈ ±7.4) ── */}
      {([-1, 1] as const).map((side) => (
        <group key={side} position={[side * 7.0, 1.4, -1.2]} rotation={[0, side * 0.3, 0]}>
          <mesh scale={[0.5, 1, 0.9]} material={IVORY_D}>
            <sphereGeometry args={[1.7, 16, 14]} />
          </mesh>
        </group>
      ))}

      {/* ── eyes (≈ ±4.3, +3.4, +4) ── */}
      {([-1, 1] as const).map((side) => (
        <group key={side} position={[side * 4.3, 3.3, 4.3]}>
          <mesh scale={[1.25, 0.8, 0.6]} material={IVORY}>
            <sphereGeometry args={[1.5, 18, 14]} />
          </mesh>
          <mesh position={[0, 0, 0.7]} material={DARK}>
            <sphereGeometry args={[0.62, 16, 14]} />
          </mesh>
        </group>
      ))}

      {/* ── brows ── */}
      {([-1, 1] as const).map((side) => (
        <mesh key={side} position={[side * 4.3, 4.9, 5.0]} rotation={[0, 0, side * -0.12]} material={IVORY_D}>
          <boxGeometry args={[2.7, 0.5, 0.9]} />
        </mesh>
      ))}

      {/* ── cheeks (≈ ±3.6, −2, +5) ── */}
      {([-1, 1] as const).map((side) => (
        <mesh key={side} position={[side * 3.6, -1.6, 4.6]} scale={[1.1, 1, 0.7]} material={IVORY_D}>
          <sphereGeometry args={[1.7, 16, 14]} />
        </mesh>
      ))}

      {/* ── lips (≈ y−4, z+5.6) ── */}
      <mesh position={[0, -4.2, 5.6]} scale={[1.6, 0.5, 0.7]} material={IVORY_D}>
        <sphereGeometry args={[1.5, 18, 12]} />
      </mesh>

      {/* ── neck ── */}
      <mesh position={[0, -10.2, -1.2]} material={IVORY_D}>
        <cylinderGeometry args={[2.6, 3.2, 5.5, 16]} />
      </mesh>

      {/* ── lighting that makes the head easy to read ── */}
      <ambientLight intensity={0.5} />
      <directionalLight position={[8, 14, 12]}  intensity={1.25} color="#FBF3D9" />
      <directionalLight position={[-9, 5, -7]}  intensity={0.4}  color="#6070A0" />
    </group>
  );
}
