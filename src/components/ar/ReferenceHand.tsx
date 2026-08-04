/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ReferenceHand — the orbit editor's hand mannequin, the analogue of
 * ReferenceBust for hand-anchored gear. A stylized half-open right hand
 * (palm facing the camera, fingers up, ~15cm wrist→fingertip) built from
 * primitives in the bust's matte language: enough anatomy to judge a wand's
 * grip or a gauntlet's cuff against, nothing that upstages the gear.
 *
 * HAND_REF_ANCHORS maps each HAND_ANCHORS id (lib/handPose) to where that
 * mount point sits on THIS mannequin, in its local cm space — the orbit view
 * passes it to AssetGizmo as the base, so fine-tuning offsets drag against a
 * visible hand exactly like head gear drags against the bust.
 */
import * as THREE from 'three';

/** Matches ReferenceBust's neutral matte so the two mannequins read as a set. */
const SKIN = new THREE.MeshStandardMaterial({ color: '#8a8f9d', metalness: 0.05, roughness: 0.85 });

/** Mount points on the mannequin, local cm. Ids = lib/handPose HAND_ANCHORS. */
export const HAND_REF_ANCHORS: Record<string, [number, number, number]> = {
  grip: [0, 5.2, 1.6],
  wristBack: [0, 0.6, -1.6],
  palm: [0, 5.2, 1.8],
};

/** One finger: 3 slightly-curled capsule segments from `root`, pointing +Y. */
function Finger({ root, length, curl = 0.35 }: { root: [number, number, number]; length: number; curl?: number }) {
  const seg = length / 3;
  return (
    <group position={root}>
      <group rotation={[-curl * 0.4, 0, 0]}>
        <mesh position={[0, seg / 2, 0]}>
          <capsuleGeometry args={[0.55, seg, 3, 8]} />
          <primitive object={SKIN} attach="material" />
        </mesh>
        <group position={[0, seg, 0]} rotation={[-curl, 0, 0]}>
          <mesh position={[0, seg / 2, 0]}>
            <capsuleGeometry args={[0.5, seg, 3, 8]} />
            <primitive object={SKIN} attach="material" />
          </mesh>
          <group position={[0, seg, 0]} rotation={[-curl, 0, 0]}>
            <mesh position={[0, seg * 0.4, 0]}>
              <capsuleGeometry args={[0.45, seg * 0.8, 3, 8]} />
              <primitive object={SKIN} attach="material" />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
}

export default function ReferenceHand() {
  return (
    <group>
      {/* Wrist stub */}
      <mesh position={[0, -0.8, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[2.1, 2.3, 2.4, 12]} />
        <primitive object={SKIN} attach="material" />
      </mesh>
      {/* Palm slab — rounded box, slightly cupped toward the camera. */}
      <mesh position={[0, 3.4, 0]} rotation={[-0.12, 0, 0]}>
        <boxGeometry args={[7.4, 6.4, 2.4]} />
        <primitive object={SKIN} attach="material" />
      </mesh>
      {/* Four fingers from the knuckle line (index → pinky, right hand). */}
      <Finger root={[-2.7, 6.4, 0.2]} length={7.0} />
      <Finger root={[-0.9, 6.6, 0.2]} length={7.8} />
      <Finger root={[0.9, 6.5, 0.2]} length={7.2} />
      <Finger root={[2.7, 6.2, 0.2]} length={5.8} />
      {/* Thumb, angled out from the palm's index side. */}
      <group position={[-3.6, 1.6, 0.7]} rotation={[0, 0, 0.85]}>
        <Finger root={[0, 0, 0]} length={5.2} curl={0.25} />
      </group>
    </group>
  );
}
