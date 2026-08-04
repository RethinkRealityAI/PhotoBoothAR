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
import { resolveFinish, resolveFinishForRegionTint, type FinishOverride } from '../../lib/studio/finish';
import {
  REGION_ATTRIBUTE,
  REGION_TINT_CACHE_KEY,
  buildRegionUniforms,
  regionOverridesKey,
  regionTintFragmentPatch,
  regionTintVertexPatch,
  type RegionUniforms,
} from '../../lib/studio/regionTint';
import { configuratorKey, regionIdsSource, type AssetTemplate } from '../../lib/studio/assetTemplate';
import { attachLabelDecal, type BuiltLabelDecal } from '../../lib/studio/assetDecal';
import { mirrorGeometryX } from '../../lib/studio/mirrorGeometry';
import { useHandMirror } from './handMirror';
import { AnchorConfig, AssetCustomization, HeadAnchor } from '../../types';
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

/**
 * Write the per-vertex region ids onto a geometry, once.
 *
 * The geometry is SHARED with the glbCache master (`Object3D.clone(true)` copies
 * the node tree but shares geometries), and that is deliberate here rather than
 * accidental: the ids come from the TEMPLATE, the template is keyed to the GLB
 * url, so every instance of that url wants the identical attribute. Uploading it
 * once for all instances is both correct and much cheaper than a per-instance
 * 30k-vertex copy. The `beamwallRegionKey` stamp makes it idempotent and lets a
 * genuinely different id set (same GLB, re-authored template) replace it.
 *
 * NO ids is a supported state, not a failure: with no attribute the shader reads
 * 0 for every vertex, which means the whole asset is region 0 — a single-region
 * recolour that still preserves the bake's shading. That is exactly the useful
 * behaviour for the un-segmented manifolds Meshy actually produces.
 */
export function ensureRegionAttribute(
  geometry: THREE.BufferGeometry | undefined,
  bytes: Uint8Array | null,
  key: string,
) {
  const position = geometry?.attributes?.position;
  if (!geometry || !position) return;
  if (!bytes) return;
  if (geometry.userData.beamwallRegionKey === key && geometry.getAttribute(REGION_ATTRIBUTE)) return;
  if (bytes.length !== position.count) {
    // A mismatch means the ids were packed against a DIFFERENT mesh. Painting
    // them anyway would map crown ids onto brim vertices — a scrambled asset
    // with no error. Fall back to "everything is region 0".
    console.warn(
      `[FaceRig] region ids length ${bytes.length} != vertex count ${position.count}; ignoring them`,
    );
    return;
  }
  const values = new Float32Array(position.count);
  for (let i = 0; i < position.count; i++) values[i] = bytes[i];
  geometry.setAttribute(REGION_ATTRIBUTE, new THREE.BufferAttribute(values, 1));
  geometry.userData.beamwallRegionKey = key;
}

/**
 * Install the region-tint shader patch on a CLONE of every material in the tree,
 * returning the teardown that restores and frees exactly what it created.
 *
 * Cloning again — on top of applyFinish's clone — is not redundant. When
 * `resolveFinish` returns null (finish `original`, no tint: the overwhelmingly
 * common case) applyFinish deliberately leaves the SHARED cache-owned material
 * in place. Assigning `onBeforeCompile` to that shared material would recompile
 * and recolour every other copy of the model in the app, including the one the
 * guest is currently wearing.
 *
 * The colour multiplier is reset to white on every patched material: the region
 * patch runs after `<map_fragment>`, so anything left in `material.color` is
 * multiplied INTO the baked albedo before the ratio maths ever sees it, and the
 * result is the muddy tint this whole feature exists to avoid. Per-region colour
 * therefore SUPERSEDES the whole-object tint; `resolveFinishForRegionTint` hands
 * back the rest of the finish (metalness, roughness, emissive) unchanged, which
 * is the half that does not conflict.
 *
 * EXPORTED as a seam, not as API: it takes a plain Object3D and no React, so a
 * dev harness can drive the REAL production path and screenshot real pixels
 * instead of screenshotting a reimplementation that happens to agree.
 */
export function applyRegionTint(
  root: THREE.Object3D,
  uniforms: RegionUniforms,
  regionBytes: Uint8Array | null,
  regionKey: string,
  finish: unknown,
  tint: unknown,
  tintStrength: unknown,
): () => void {
  // ONE uniform object shared by every patched material: three keeps a
  // reference, so writing into these typed arrays later updates the draw
  // without a recompile.
  const shared = {
    uRegionTint: { value: uniforms.tint },
    uRegionAmount: { value: uniforms.amount },
    uRegionRef: { value: uniforms.ref },
    uRegionRough: { value: uniforms.roughness },
    uRegionMetal: { value: uniforms.metalness },
    uRegionMatAmount: { value: uniforms.matAmount },
    uRegionEmissive: { value: uniforms.emissive },
    uRegionEmissiveAmount: { value: uniforms.emissiveAmount },
  };

  const created: THREE.Material[] = [];
  const restore: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[] = [];

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    ensureRegionAttribute(obj.geometry, regionBytes, regionKey);
    const previous = obj.material;
    const mats = Array.isArray(previous) ? previous : [previous];
    const next = mats.map((m) => {
      const std = m as THREE.MeshStandardMaterial;
      const baseHex = std.color ? `#${std.color.getHexString()}` : '#ffffff';
      const clone = m.clone() as THREE.MeshStandardMaterial;
      // Neutralise the colour multiplier ONLY when there is a texture under it.
      //
      // With a map, `diffuseColor = color * texel`, so anything left in `color`
      // is multiplied into the bake before the ratio maths sees it and the
      // result is exactly the muddy tint this feature exists to avoid — white
      // is the identity that lets the texel through untouched.
      //
      // WITHOUT a map, `diffuseColor` IS `color`: the material's own colour is
      // the entire "bake". Whitening it there does not neutralise anything, it
      // REPLACES the bake with 1.0 — so a region whose refLuminance was
      // measured from the exporter's albedo now divides a luminance of 1 by,
      // say, 0.38 and lands 2.6x past the requested swatch, clipping to a flat
      // over-saturated slab. (Caught in the Stage A harness on
      // public/models/reference-head.glb, which ships 0 textures.)
      if (clone.color && clone.map) clone.color.set('#ffffff');
      const o: FinishOverride | null = resolveFinishForRegionTint(finish, tint, tintStrength, baseHex);
      if (o) {
        clone.metalness = o.metalness;
        clone.roughness = o.roughness;
        if (o.emissive && clone.emissive) {
          clone.emissive.set(o.emissive);
          clone.emissiveIntensity = o.emissiveIntensity;
        }
      }
      clone.onBeforeCompile = (shader) => {
        const vert = regionTintVertexPatch(shader.vertexShader);
        const frag = regionTintFragmentPatch(shader.fragmentShader);
        // Both halves or neither: a vertex stage declaring a varying the
        // fragment stage does not consume (or vice versa) is a link error, and
        // a partial patch would tint the whole mesh as region 0.
        if (!vert.patched || !frag.patched) {
          console.warn('[FaceRig] region tint anchors missing in this three build; skipping patch');
          return;
        }
        shader.vertexShader = vert.source;
        shader.fragmentShader = frag.source;
        Object.assign(shader.uniforms, shared);
      };
      // Without this three treats the patched and unpatched programs as the
      // same cache entry — and recompiles from scratch on every material.
      clone.customProgramCacheKey = () => REGION_TINT_CACHE_KEY;
      clone.needsUpdate = true;
      created.push(clone);
      return clone;
    });
    restore.push({ mesh: obj, material: previous });
    obj.material = Array.isArray(previous) ? next : next[0];
  });

  return () => {
    // Put back whatever was there first, THEN free only our own clones. The
    // originals belong to the shared cache and outlive every instance.
    for (const r of restore) r.mesh.material = r.material;
    for (const m of created) m.dispose();
  };
}

export function Model({
  url,
  onReady,
  onError,
  finish,
  tint,
  tintStrength,
  template,
  customization,
  guestName,
  onDecalBuilt,
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
  /**
   * lib/studio/assetTemplate.ts — the descriptor that says which parts of this
   * GLB may be recoloured and where a name may be engraved.
   *
   * ABSENT (the default, and every legacy coded event) means the asset is not
   * configurable: neither of the two effects below does anything at all, no
   * material is re-cloned, no shader is patched, and the model renders through
   * the identical stock program it used before this feature existed.
   */
  template?: AssetTemplate | null;
  /** types.AssetCustomization — what the host actually picked. */
  customization?: AssetCustomization | null;
  /** Resolved at booth time for a `guestName` label; '' draws nothing. */
  guestName?: string;
  /** Reports the decal carve's real cost — O(mesh triangles), so callers can
   *  see whether they need to debounce rather than assuming. */
  onDecalBuilt?: (info: { buildMs: number; triangles: number }) => void;
}) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  // BOTH HANDS FROM ONE ASSET. Inside a HandRig this asks the rig which hand it
  // is on; everywhere else (head pieces, the studio's orbit view, the landing
  // demo) it is a constant false and nothing below runs.
  //
  // The text-slot guard is a fail-safe, not a limitation we chose: a decal is
  // carved against the surface it was built for, and mirroring the body under
  // it would leave the engraving on the wrong side of the asset. No shipped
  // hand asset has a slot, so this costs nothing today — and if one gains a
  // slot, it renders un-mirrored (today's behaviour) and says so, instead of
  // silently engraving a name into thin air.
  const wantsMirror = useHandMirror(template?.modelledHand ?? undefined);
  const engravable = template !== null && template !== undefined && template.textSlots.length > 0;
  const mirrorX = wantsMirror && !engravable;
  useEffect(() => {
    if (wantsMirror && engravable) {
      console.warn('[Model] template has text slots; not mirroring for the other hand', template?.id);
    }
  }, [wantsMirror, engravable, template?.id]);
  // Callbacks live in refs, not in the effect's deps: a caller passing an inline
  // arrow (every caller does) would otherwise re-download and re-clone the whole
  // model on every render of its parent.
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const onDecalBuiltRef = useRef(onDecalBuilt);
  onReadyRef.current = onReady;
  onErrorRef.current = onError;
  onDecalBuiltRef.current = onDecalBuilt;

  // SERIALIZED dependency keys, never the objects themselves. The load effect
  // below re-downloads and re-clones the entire model when its deps change, and
  // every caller passes `customization` as a fresh object literal — keying on
  // identity would re-parse a 12 MB Meshy GLB on every parent render.
  const partsKey = template ? `${template.id}#${regionOverridesKey(customization?.parts)}` : '';
  const decalKey = configuratorKey(template, customization, guestName ?? '');

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

  // MIRROR — declared BEFORE the tint effect so that on mount the geometry is
  // already flipped when `ensureRegionAttribute` paints region ids onto it.
  // Swapping geometry rather than re-cloning the model means switching hands
  // costs a WeakMap lookup, not a 12 MB re-parse, and the guest sees no reload.
  useEffect(() => {
    if (!scene || !mirrorX) return;
    const restore: { mesh: THREE.Mesh; geometry: THREE.BufferGeometry }[] = [];
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.geometry) {
        restore.push({ mesh: obj, geometry: obj.geometry });
        obj.geometry = mirrorGeometryX(obj.geometry);
      }
    });
    // Put the originals back on teardown: they belong to the shared model cache
    // and outlive this instance, and the mirrored copies are cached separately.
    return () => {
      for (const r of restore) r.mesh.geometry = r.geometry;
    };
  }, [scene, mirrorX]);

  // REGION TINT — a separate effect, deliberately, rather than more work inside
  // the load effect: a host dragging a colour swatch must not re-download and
  // re-parse the GLB on every frame of the drag. This one only re-patches
  // materials on the scene that is already there.
  useEffect(() => {
    if (!scene || !template) return;
    const uniforms = buildRegionUniforms(template.regions, customization?.parts);
    // THE LEGACY GUARANTEE. Nothing overridden -> no clone, no patch, no
    // teardown: the model keeps the cache's own materials and the stock shader.
    if (!uniforms.active) return;
    const source = template.regionIds ? regionIdsSource(template.regionIds) : null;
    // A sidecar URL is not fetched here — that is a network call on the booth's
    // critical path, and this repo vendors assets precisely to avoid those. Only
    // inline packed ids are honoured; a URL degrades to "one region".
    const bytes = source?.kind === 'packed' ? source.bytes : null;
    return applyRegionTint(
      scene, uniforms, bytes, template.regionIds ?? template.id, finish, tint, tintStrength,
    );
    // `template`/`customization` are read through the serialized partsKey; see
    // the note where it is computed. `mirrorX` is a dep because the mirrored
    // mesh is a DIFFERENT BufferGeometry: without it, flipping hands would drop
    // the region attribute and repaint the whole asset as region 0.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, partsKey, finish, tint, tintStrength, mirrorX]);

  // ENGRAVED NAME — async only because the webfont must be loaded before the
  // artwork is baked into a texture; the carve itself is synchronous.
  useEffect(() => {
    if (!scene || !template) return;
    let alive = true;
    let built: BuiltLabelDecal | null = null;
    attachLabelDecal(scene, template, customization, guestName ?? '')
      .then((result) => {
        // The effect may already have been torn down while the font resolved.
        // Disposing here rather than leaking is the whole point of the flag.
        if (!alive) { result?.dispose(); return; }
        built = result;
        if (result) onDecalBuiltRef.current?.({ buildMs: result.buildMs, triangles: result.triangles });
      })
      .catch((e) => console.warn('[Model] label decal failed', e));
    return () => {
      alive = false;
      built?.dispose();
      built = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, decalKey]);

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
