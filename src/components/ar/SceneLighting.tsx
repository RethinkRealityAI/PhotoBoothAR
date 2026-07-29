/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The R3F half of the shared lighting definition (lib/studio/lighting.ts).
 *
 * Drop `<SceneLighting preset={id} />` inside any <Canvas> and that surface is
 * lit EXACTLY like every other one. No surface declares an <ambientLight> of
 * its own any more, which is the only way the booth and the four studio
 * previews can be stopped from drifting apart again.
 *
 * WHAT MAKES METAL LOOK LIKE METAL: a metalness-1 material has no diffuse
 * term at all — it is a pure mirror, so it renders whatever the environment
 * map contains. With no environment map (the old rig) that is BLACK, which is
 * why the jewelry builder shipped a warning telling hosts their chrome preset
 * would "look darker on camera". The environment below is generated on the GPU
 * from a handful of emissive panels: no HDR file, no fetch, one cube render.
 */
import { Environment, ContactShadows } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { lightingFor, type LightformerSpec, type LightingPresetId } from '../../lib/studio/lighting';

/** Applies the preset's renderer exposure and puts it back on unmount, so a
 *  surface that stops rendering never leaves the next one over-exposed. */
function Exposure({ value }: { value: number }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const prev = gl.toneMappingExposure;
    gl.toneMappingExposure = value;
    return () => { gl.toneMappingExposure = prev; };
  }, [gl, value]);
  return null;
}

/**
 * One emissive panel inside the generated environment.
 *
 * This is drei's `<Lightformer>` written out by hand, and deliberately so: that
 * component's props type is `Omit<ThreeElements['mesh'],'ref'> & {...}`, so its
 * `scale` and `args` INTERSECT with the mesh element's own — `scale` resolves to
 * `number & [number, number]` and `args` to the mesh's
 * `[geometry?, material?]`, which makes a non-uniform panel size unexpressible
 * without an `as unknown as` cast. Plain R3F elements type cleanly and this is
 * exactly what Lightformer renders internally (colour pre-multiplied by
 * intensity into an unlit, tone-mapping-exempt material).
 */
function Panel({ spec }: { spec: LightformerSpec }) {
  const ref = useRef<THREE.Mesh>(null);
  // Colour × intensity: a basic material has no lighting response, so the
  // "brightness" of an environment panel IS its colour value, which may exceed 1.
  const color = useMemo(() => new THREE.Color(spec.color).multiplyScalar(spec.intensity), [spec.color, spec.intensity]);
  // Face the scene origin unless the spec pinned an explicit rotation — a panel
  // pointing away contributes nothing to the cube capture.
  useLayoutEffect(() => {
    if (!spec.rotation && ref.current) ref.current.lookAt(0, 0, 0);
  }, [spec.rotation, spec.position]);

  const [w, h] = spec.scale;
  return (
    <mesh
      ref={ref}
      position={spec.position as [number, number, number]}
      rotation={spec.rotation as [number, number, number] | undefined}
    >
      {spec.form === 'rect' ? (
        <planeGeometry args={[w, h]} />
      ) : spec.form === 'circle' ? (
        <ringGeometry args={[0, w / 2, 48]} />
      ) : (
        <ringGeometry args={[w / 4, w / 2, 48]} />
      )}
      <meshBasicMaterial color={color} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

export interface SceneLightingProps {
  preset: LightingPresetId;
  /**
   * Render the preset's soft ground shadow. OFF by default and deliberately so:
   * the booth's 3D canvas is composited over the guest's camera feed, where a
   * shadow catcher has no ground to fall on and would paint a grey ellipse
   * across their face. Only surfaces with a real floor (the studio's orbit
   * bust, the jewelry preview) pass true.
   */
  contactShadows?: boolean;
  /** Y of the shadow plane in THIS surface's units (the studio orbit view works
   *  in centimetres, the jewelry preview in a unit box). */
  shadowY?: number;
  /** Ground-plane extent in this surface's units. */
  shadowScale?: number;
}

export default function SceneLighting({
  preset,
  contactShadows = false,
  shadowY,
  shadowScale,
}: SceneLightingProps) {
  const p = lightingFor(preset);
  const cs = p.contactShadow;

  return (
    <>
      <Exposure value={p.exposure} />
      <ambientLight color={p.ambient.color} intensity={p.ambient.intensity} />
      {p.directionals.map((d, i) => (
        <directionalLight key={`d${i}`} color={d.color} intensity={d.intensity} position={d.position as [number, number, number]} />
      ))}
      {p.points.map((l, i) => (
        <pointLight key={`p${i}`} color={l.color} intensity={l.intensity} position={l.position as [number, number, number]} />
      ))}

      {/* CHILDREN, never `preset=` — drei 10.7's named presets fetch a 1–2 MB
          .hdr from raw.githack.com (useEnvironment.js:8). Passing children takes
          the EnvironmentPortal path instead: these panels are rendered into a
          64px cube render-target ONCE (frames=1) and never touch the network. */}
      {p.environment && (
        <Environment
          resolution={p.environment.resolution}
          frames={1}
          environmentIntensity={p.environment.intensity}
        >
          {p.environment.lightformers.map((lf, i) => (
            <Panel key={`lf${i}`} spec={lf} />
          ))}
        </Environment>
      )}

      {contactShadows && cs && (
        <ContactShadows
          position={[0, shadowY ?? cs.y, 0]}
          scale={shadowScale ?? cs.scale}
          opacity={cs.opacity}
          blur={cs.blur}
          far={shadowScale ? shadowScale / 2 : cs.far}
          color={cs.color}
          // drei's default `frames` (Infinity) is kept on purpose: the host
          // DRAGS the selected piece around, and a one-shot shadow would freeze
          // under the position it had when the pass ran. 256 keeps the extra
          // depth render cheap — and this only ever mounts on studio surfaces
          // that have a floor, never in the guest booth.
          resolution={256}
        />
      )}
    </>
  );
}
