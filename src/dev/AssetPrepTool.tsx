/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DEV-ONLY asset prep tool — a raw GLB in, an AssetTemplate descriptor out.
 *
 * Registered ONLY when `import.meta.env.DEV` is true (see App.tsx), exactly like
 * ./StudioHarness.tsx, so it never ships to production and never becomes a
 * surface anyone has to authorise.
 *
 * ## Why a human is in the loop, and why that is not a shortcoming
 *
 * The automatic pass cannot find the parts. Meshy's remesher emits ONE
 * watertight manifold: `connectedComponents` on this repo's own
 * `public/models/reference-head.glb` returns 1 (and 815 over the raw index
 * buffer, which is UV seams, not parts — the tool prints both numbers so nobody
 * mistakes the second for a result). There is nothing in the bytes that says
 * "this is the brim". So the automatic pass does the mechanical half — measure
 * the box, propose a real-world size, place a text anchor on the front face,
 * seed regions as bands — and the human paints the rest.
 *
 * `preparedBy` is therefore driven by an actual edit counter, not by intent:
 * 'auto' means literally nobody touched it, and a descriptor claiming that when
 * a person did (or the reverse) is a lie the next person has to discover.
 *
 * ## It drives the PRODUCTION path, not a lookalike
 *
 * The preview uses `applyRegionTint` from components/ar/FaceRig.tsx — the same
 * function the booth uses, exported there as a seam for exactly this. What you
 * paint here is drawn by the shader that will draw it in the guest's photo. A
 * tool that reimplemented the tint would agree with the booth right up until it
 * did not.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useReducedMotion } from 'motion/react';
import { Boxes, Brush, Check, Copy, Loader2, Upload } from 'lucide-react';
import SceneLighting from '../components/ar/SceneLighting';
import { applyRegionTint } from '../components/ar/FaceRig';
import { loadModelDisposable } from '../lib/glbCache';
import { largestMesh } from '../lib/studio/assetDecal';
import { buildRegionUniforms, linearLuminance, MAX_REGIONS } from '../lib/studio/regionTint';
import { TEMPLATE_BOUNDS, orthogonalUp, type Vec3 } from '../lib/studio/assetTemplate';
import { DEFAULT_LIGHTING } from '../lib/studio/lighting';
import {
  AXIS_IDS,
  AXIS_VECTORS,
  DEFAULT_FRONT_AXIS,
  bandRegionIds,
  boundsOfPositions,
  boundsSize,
  buildTemplateDescriptor,
  connectedComponents,
  descriptorJson,
  guessUpAxis,
  measureRegionLuminances,
  paintSphere,
  proposeDecalDepth,
  proposeFitCm,
  proposeTextAnchor,
  usedRegionIndices,
  type AxisId,
  type PrepBounds,
  type PrepRegionDraft,
} from '../lib/studio/assetPrep';

/**
 * Refine a box-face anchor onto the mesh surface along −normal.
 *
 * `proposeTextAnchor` deliberately anchors on the BOUNDING-BOX face — but on a
 * model whose front plane is mostly air (a cap: only the brim tip reaches the
 * box plane, the crown front sits half a model behind it) a box-face anchor
 * floats in space, and only an absurd projector depth ever reaches the surface.
 * Casting from just outside the box face along −normal and taking the FIRST hit
 * finds the near surface by definition; the concave-front trap the pure module
 * documents (a ray landing on the far wall) cannot happen to a first hit.
 * No hit at all — the anchor line misses the model — keeps the box-face
 * fallback, and the panel says so.
 */
function projectAnchorToSurface(mesh: THREE.Mesh, position: Vec3, normal: Vec3): Vec3 | null {
  mesh.updateWorldMatrix(true, false);
  const n = new THREE.Vector3(...normal);
  const originLocal = new THREE.Vector3(...position).addScaledVector(n, 1e-3);
  const origin = mesh.localToWorld(originLocal.clone());
  const direction = n
    .clone()
    .applyMatrix3(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld))
    .normalize()
    .negate();
  const caster = new THREE.Raycaster(origin, direction);
  const hit = caster.intersectObject(mesh, false)[0];
  if (!hit) return null;
  const local = mesh.worldToLocal(hit.point.clone());
  return [local.x, local.y, local.z];
}

/** Distinct, high-separation debug swatches so painted regions read at a glance. */
const REGION_PALETTE = ['#e8e2d6', '#3aa0ff', '#ff5c8a', '#5bff9a', '#ffd166', '#b06cff', '#ff8a3d', '#26d5c8'];

const REGION_DEFAULT_LABELS = ['Body', 'Part 2', 'Part 3', 'Part 4', 'Part 5', 'Part 6', 'Part 7', 'Part 8'];

interface Loaded {
  url: string;
  /** Object URL that this tool minted and therefore must revoke. */
  ownsObjectUrl: boolean;
  name: string;
  root: THREE.Group;
  mesh: THREE.Mesh;
  positions: Float32Array;
  bounds: PrepBounds;
  /** Components over welded positions / over the raw index buffer. */
  components: { count: number; rawCount: number };
  triangles: number;
  /**
   * Mean LINEAR luminance of the material's own base colour, for an UNTEXTURED
   * asset — where `diffuseColor` IS `material.color` and this is exactly the
   * right reference. Null when the material carries a map, because the honest
   * reference then has to come from the texels the region's UVs cover and this
   * tool does not sample them (see the note the panel prints).
   */
  baseLuminance: number | null;
}

const panelCls = 'rounded-xl border border-white/10 bg-white/[0.02] p-3 flex flex-col gap-2';
const labelCls = 'font-label uppercase tracking-widest text-[9px] text-accent-2';
const fieldCls = 'w-full bg-white/[0.04] border border-white/10 rounded-lg px-2 py-1.5 text-[11px] text-brand-fg focus:outline-none focus:border-accent/40';
const btnCls = 'px-2.5 py-1.5 rounded-lg text-[10px] font-label uppercase tracking-widest transition-colors';

/* ── the 3D half ──────────────────────────────────────────────────────────── */

function PreparedModel({
  loaded,
  regions,
  regionIds,
  version,
  onPaint,
}: {
  loaded: Loaded;
  regions: PrepRegionDraft[];
  regionIds: Uint8Array;
  version: number;
  onPaint: (localPoint: Vec3) => void;
}) {
  useEffect(() => {
    const overrides: Record<string, { hex: string }> = {};
    for (const r of regions) overrides[r.id] = { hex: r.defaultHex };
    const uniforms = buildRegionUniforms(
      regions.map((r) => ({ id: r.id, recolourable: true, refLuminance: r.refLuminance })),
      overrides,
    );
    if (!uniforms.active) return;
    // The key changes with every paint stroke, which is what lets
    // ensureRegionAttribute replace the attribute instead of short-circuiting on
    // its idempotence stamp.
    return applyRegionTint(loaded.root, uniforms, regionIds, `prep-${version}`, undefined, undefined, undefined);
  }, [loaded.root, regions, regionIds, version]);

  const handle = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const local = loaded.mesh.worldToLocal(e.point.clone());
    onPaint([local.x, local.y, local.z]);
  }, [loaded.mesh, onPaint]);

  return <primitive object={loaded.root} onPointerDown={handle} />;
}

/**
 * The anchor, drawn where the decal will actually be carved.
 *
 * `position`/`normal` are in the MESH's own space, and the mesh usually sits
 * under a transform — `reference-head.glb`'s node carries a +90 degree X
 * rotation. Rendering the marker as a sibling of the model root draws it in
 * UNROTATED space, which is how the first version of this tool put the anchor
 * on the mouth of a model whose slot was nowhere near it. So the marker is
 * pushed through the mesh's own world matrix, exactly like the decal will be.
 */
function AnchorMarker({ mesh, position, normal, scale }: { mesh: THREE.Mesh; position: Vec3; normal: Vec3; scale: number }) {
  const { worldPos, quaternion } = useMemo(() => {
    mesh.updateWorldMatrix(true, false);
    const p = new THREE.Vector3(...position).applyMatrix4(mesh.matrixWorld);
    const n = new THREE.Vector3(...normal)
      .applyMatrix3(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld))
      .normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    return { worldPos: [p.x, p.y, p.z] as Vec3, quaternion: q };
  }, [mesh, position, normal]);
  return (
    <group position={worldPos} quaternion={quaternion}>
      {/* A disc on the surface plus a stub along the normal: the two things that
          go wrong (wrong face, inverted normal) are both visible at a glance. */}
      <mesh>
        <circleGeometry args={[scale * 0.12, 24]} />
        <meshBasicMaterial color="#ff5c8a" transparent opacity={0.85} side={THREE.DoubleSide} depthTest={false} />
      </mesh>
      {/* cylinderGeometry is Y-aligned; the marker's local +Z is the normal. */}
      <mesh position={[0, 0, scale * 0.12]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[scale * 0.012, scale * 0.012, scale * 0.24, 8]} />
        <meshBasicMaterial color="#ff5c8a" depthTest={false} />
      </mesh>
    </group>
  );
}

/* ── the tool ─────────────────────────────────────────────────────────────── */

export default function AssetPrepTool() {
  const reduceMotion = useReducedMotion();
  const [urlInput, setUrlInput] = useState('/models/reference-head.glb');
  const [status, setStatus] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  // Descriptor fields
  const [assetId, setAssetId] = useState('');
  const [assetName, setAssetName] = useState('');
  const [glbUrl, setGlbUrl] = useState('');
  const [fitCm, setFitCm] = useState(20);
  const [fitReason, setFitReason] = useState('');
  const [frontAxis, setFrontAxis] = useState<AxisId>(DEFAULT_FRONT_AXIS);
  const [upAxis, setUpAxis] = useState<AxisId>(guessUpAxis(DEFAULT_FRONT_AXIS));
  const [heightFraction, setHeightFraction] = useState(0.5);
  const [maxWidthCm, setMaxWidthCm] = useState(6);
  const [decalDepth, setDecalDepth] = useState(0.5);
  const [withTextSlot, setWithTextSlot] = useState(true);
  const [regions, setRegions] = useState<PrepRegionDraft[]>([]);
  const [regionIds, setRegionIds] = useState<Uint8Array>(new Uint8Array(0));
  const [version, setVersion] = useState(0);

  // Painting
  const [activeRegion, setActiveRegion] = useState(0);
  const [brushCm, setBrushCm] = useState(4);
  const [paintStrokes, setPaintStrokes] = useState(0);
  const [manualEdits, setManualEdits] = useState(0);
  const [copied, setCopied] = useState(false);
  /** Set by "Measure from texture": the stroke count the measurement saw, plus
   *  per-region texel counts, so staleness and empty regions are both visible. */
  const [measured, setMeasured] = useState<{ strokes: number; texels: number[] } | null>(null);

  const humanEdited = paintStrokes > 0 || manualEdits > 0;
  const touch = useCallback(() => setManualEdits((n) => n + 1), []);

  const disposeRef = useRef<Loaded | null>(null);
  disposeRef.current = loaded;
  useEffect(() => () => {
    const l = disposeRef.current;
    if (l?.ownsObjectUrl) URL.revokeObjectURL(l.url);
  }, []);

  /* — load + the automatic pass — */
  const load = useCallback(async (url: string, name: string, ownsObjectUrl: boolean) => {
    setStatus({ busy: true, error: null });
    try {
      // Disposable, not the shared cache: this tool mutates the geometry's
      // region attribute and swaps materials, and the booth's cached master must
      // never carry a prep session's scratch state.
      const root = await loadModelDisposable(url);
      const mesh = largestMesh(root);
      const attr = mesh?.geometry?.attributes?.position;
      if (!mesh || !attr) throw new Error('That file has no mesh with positions.');

      const positions = new Float32Array(attr.array as ArrayLike<number>);
      const bounds = boundsOfPositions(positions);
      if (!bounds) throw new Error('That mesh has no measurable bounding box.');

      const index = mesh.geometry.getIndex();
      const components = connectedComponents(positions, index ? (index.array as ArrayLike<number>) : null);
      const triangles = (index ? index.count : attr.count) / 3;

      const material = mesh.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
      const first = Array.isArray(material) ? material[0] : material;
      const baseLuminance = first?.map
        ? null
        : first?.color
          ? linearLuminance(first.color.r, first.color.g, first.color.b)
          : null;

      const size = boundsSize(bounds);
      const largest = Math.max(size[0], size[1], size[2]);
      const fit = proposeFitCm(largest, 20);

      const ids = new Uint8Array(positions.length / 3);
      // If the mesh genuinely IS made of separate shells and there are few
      // enough to fit the uniform array, that is a real seed. On a Meshy
      // manifold it is 1, which is why the band control exists beside it.
      const useComponents = components.count > 1 && components.count <= MAX_REGIONS;
      if (useComponents) for (let i = 0; i < ids.length; i++) ids[i] = components.ids[i];

      const seeded = usedRegionIndices(ids);
      setRegions(seeded.map((index_) => ({
        index: index_,
        id: `region-${index_ + 1}`,
        label: REGION_DEFAULT_LABELS[index_] ?? `Part ${index_ + 1}`,
        recolourable: true,
        defaultHex: REGION_PALETTE[index_ % REGION_PALETTE.length],
        refLuminance: baseLuminance ?? 0.18,
      })));
      setRegionIds(ids);
      setVersion((v) => v + 1);

      const slug = name.replace(/\.(glb|gltf)$/i, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
      setAssetId(slug || 'new-asset');
      setAssetName(name.replace(/\.(glb|gltf)$/i, '') || 'New asset');
      setGlbUrl(ownsObjectUrl ? '' : url);
      setFitCm(fit.fitCm);
      setFitReason(fit.reason);
      setFrontAxis(DEFAULT_FRONT_AXIS);
      setUpAxis(guessUpAxis(DEFAULT_FRONT_AXIS));
      setHeightFraction(0.5);
      setDecalDepth(proposeDecalDepth(bounds, DEFAULT_FRONT_AXIS));
      setMaxWidthCm(Math.max(TEMPLATE_BOUNDS.maxWidthCm.min, Math.round(fit.fitCm * 0.4)));
      setPaintStrokes(0);
      setManualEdits(0);
      setActiveRegion(0);
      setMeasured(null);

      const previous = disposeRef.current;
      if (previous?.ownsObjectUrl) URL.revokeObjectURL(previous.url);
      setLoaded({ url, ownsObjectUrl, name, root, mesh, positions, bounds, components, triangles, baseLuminance });
      setStatus({ busy: false, error: null });
    } catch (e) {
      console.error('[AssetPrepTool] load failed', e);
      setStatus({ busy: false, error: e instanceof Error ? e.message : 'Could not load that file.' });
    }
  }, []);

  const onFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void load(URL.createObjectURL(file), file.name, true);
  }, [load]);

  /* — the human correction — */
  const modelUnitsPerCm = loaded
    ? Math.max(loaded.bounds.max[0] - loaded.bounds.min[0], loaded.bounds.max[1] - loaded.bounds.min[1], loaded.bounds.max[2] - loaded.bounds.min[2]) / Math.max(0.001, fitCm)
    : 1;

  const idsRef = useRef(regionIds);
  idsRef.current = regionIds;

  const paint = useCallback((point: Vec3) => {
    if (!loaded) return;
    // Computed OUTSIDE the state updater. Calling setState from inside another
    // setState's updater is unsupported and React drops it under the double
    // invoke — which is exactly how the stroke counter stayed at 0 while the
    // model visibly repainted, and `preparedBy` therefore depended on whether
    // the host had also touched some unrelated field.
    const next = new Uint8Array(idsRef.current);
    const changed = paintSphere(loaded.positions, next, point, brushCm * modelUnitsPerCm, activeRegion);
    // A click that reached nothing is NOT an edit.
    if (changed === 0) return;
    setRegionIds(next);
    setPaintStrokes((n) => n + 1);
    setVersion((v) => v + 1);
  }, [loaded, brushCm, modelUnitsPerCm, activeRegion]);

  const reseedBands = useCallback((bands: number) => {
    if (!loaded) return;
    const ids = bandRegionIds(loaded.positions, loaded.bounds, upAxis, bands);
    setRegionIds(ids);
    setVersion((v) => v + 1);
    setMeasured(null);
    touch();
    setRegions(usedRegionIndices(ids).map((i) => ({
      index: i,
      id: `region-${i + 1}`,
      label: REGION_DEFAULT_LABELS[i] ?? `Part ${i + 1}`,
      recolourable: true,
      defaultHex: REGION_PALETTE[i % REGION_PALETTE.length],
      refLuminance: loaded.baseLuminance ?? 0.18,
    })));
    setActiveRegion(0);
  }, [loaded, upAxis, touch]);

  const patchRegion = useCallback((index: number, patch: Partial<PrepRegionDraft>) => {
    setRegions((prev) => prev.map((r) => (r.index === index ? { ...r, ...patch } : r)));
    touch();
  }, [touch]);

  /**
   * The step that used to be manual: refLuminance from the texels each region's
   * UVs cover. The canvas turns the texture into flat RGBA; the rasterising is
   * the tested pure function. Re-run it after painting — the staleness note
   * below the button tracks that.
   */
  const measureFromTexture = useCallback(() => {
    if (!loaded) return;
    const material = loaded.mesh.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
    const first = Array.isArray(material) ? material[0] : material;
    const image = first?.map?.image as CanvasImageSource & { width: number; height: number } | undefined;
    const uv = loaded.mesh.geometry.attributes.uv;
    if (!image || !image.width || !image.height || !uv) return;
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(image, 0, 0);
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const index = loaded.mesh.geometry.getIndex();
    const results = measureRegionLuminances(
      rgba,
      canvas.width,
      canvas.height,
      uv.array as ArrayLike<number>,
      index ? (index.array as ArrayLike<number>) : null,
      idsRef.current,
    );
    setRegions((prev) => prev.map((r) => ({ ...r, refLuminance: results[r.index].luminance })));
    setMeasured({ strokes: paintStrokes, texels: results.map((r) => r.texels) });
    touch();
  }, [loaded, paintStrokes, touch]);

  const hasTextureMap = loaded !== null && loaded.baseLuminance === null;

  /* — the descriptor — */
  const anchor = useMemo(() => {
    if (!loaded) return null;
    const proposed = proposeTextAnchor(loaded.bounds, frontAxis, heightFraction, upAxis);
    const surface = projectAnchorToSurface(loaded.mesh, proposed.position, proposed.normal);
    return surface
      ? { ...proposed, position: surface, onSurface: true }
      : { ...proposed, onSurface: false };
  }, [loaded, frontAxis, heightFraction, upAxis]);

  const descriptor = useMemo(() => {
    if (!loaded || !anchor) return null;
    return buildTemplateDescriptor({
      id: assetId,
      name: assetName,
      glbUrl,
      fitCm,
      regions,
      regionIds,
      textSlots: withTextSlot
        ? [{
            id: 'front',
            position: anchor.position,
            normal: anchor.normal,
            up: orthogonalUp(anchor.up, anchor.normal),
            maxWidthCm,
            decalDepth,
          }]
        : [],
      humanEdited,
    });
  }, [loaded, anchor, assetId, assetName, glbUrl, fitCm, regions, regionIds, withTextSlot, maxWidthCm, decalDepth, humanEdited]);

  const json = descriptor ? descriptorJson(descriptor) : '';
  const copy = useCallback(() => {
    if (!json) return;
    void navigator.clipboard?.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => { /* the textarea below is always selectable */ });
  }, [json]);

  const radius = loaded ? Math.max(...boundsSize(loaded.bounds)) : 1;

  return (
    <div className="h-dvh w-full app-bg text-brand-fg flex flex-col lg:flex-row overflow-hidden">
      {/* ── viewport ── */}
      <div className="relative flex-1 min-h-[45dvh]">
        {loaded ? (
          <Canvas camera={{ position: [0, radius * 0.4, radius * 2.2], fov: 40 }} dpr={[1, 2]}>
            <Suspense fallback={null}>
              <SceneLighting preset={DEFAULT_LIGHTING} />
              <PreparedModel
                loaded={loaded}
                regions={regions}
                regionIds={regionIds}
                version={version}
                onPaint={paint}
              />
              {withTextSlot && anchor && (
                <AnchorMarker mesh={loaded.mesh} position={anchor.position} normal={anchor.normal} scale={radius} />
              )}
              {/* autoRotate is opt-out under prefers-reduced-motion; the tool is
                  a measuring instrument and a spinning subject is worse anyway. */}
              <OrbitControls makeDefault enableDamping={!reduceMotion} autoRotate={false} />
            </Suspense>
          </Canvas>
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center gap-3 text-center px-6">
            <Boxes className="w-8 h-8 text-brand-muted/30" />
            <p className="font-sans text-xs text-brand-muted/50 max-w-sm">
              Load a .glb to prepare it. The automatic pass measures the box, proposes a real-world
              size and places a text anchor — then you paint the regions, because nothing in the file
              says which part is which.
            </p>
          </div>
        )}
        {loaded && (
          <div className="absolute top-3 left-3 glass rounded-lg px-2.5 py-1.5 font-mono text-[10px] text-brand-muted/70 leading-relaxed pointer-events-none">
            {loaded.triangles.toLocaleString()} tris · {(loaded.positions.length / 3).toLocaleString()} verts
            <br />
            shells (welded): <span className="text-brand-fg">{loaded.components.count}</span>
            {' · '}raw index islands: {loaded.components.rawCount}
          </div>
        )}
      </div>

      {/* ── controls ── */}
      <div className="w-full lg:w-[380px] shrink-0 border-t lg:border-t-0 lg:border-l border-white/10 overflow-y-auto p-3 flex flex-col gap-3">
        <div>
          <h1 className="font-display text-lg">Asset prep</h1>
          <p className="font-sans text-[10px] text-brand-muted/50 leading-relaxed">
            DEV only. GLB in, AssetTemplate descriptor out — paste the result into
            <span className="font-mono"> src/lib/studio/assetLibrary.ts</span>.
          </p>
        </div>

        {/* SOURCE */}
        <div className={panelCls}>
          <span className={labelCls}>1 · Model</span>
          <div className="flex gap-1.5">
            <input
              className={fieldCls}
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="/models/your-asset.glb"
              aria-label="Model URL"
            />
            <button
              onClick={() => void load(urlInput.trim(), urlInput.trim().split('/').pop() || 'asset.glb', false)}
              disabled={status.busy || !urlInput.trim()}
              className={`${btnCls} shrink-0 bg-accent/20 text-accent-2 hover:bg-accent/30 disabled:opacity-30`}
            >
              {status.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Load'}
            </button>
          </div>
          <label className={`${btnCls} inline-flex items-center gap-1.5 self-start cursor-pointer bg-white/[0.06] hover:bg-white/[0.1] text-brand-muted`}>
            <Upload className="w-3 h-3" /> Pick a file
            <input type="file" accept=".glb,.gltf,model/gltf-binary" onChange={onFile} className="hidden" />
          </label>
          {status.error && <p className="font-sans text-[10px] text-red-300">{status.error}</p>}
        </div>

        {loaded && (
          <>
            {/* AUTOMATIC PASS */}
            <div className={panelCls}>
              <span className={labelCls}>2 · Automatic pass</span>
              <p className="font-sans text-[10px] text-brand-muted/60 leading-relaxed">{fitReason}</p>
              {loaded.components.count <= 1 && (
                <p className="font-sans text-[10px] text-amber-300/80 leading-relaxed">
                  One welded shell — segmentation has nothing to find here, which is normal for a
                  generated asset. Seed bands below, then paint.
                </p>
              )}
              {hasTextureMap && !measured && (
                <p className="font-sans text-[10px] text-amber-300/80 leading-relaxed">
                  This material has a texture map, so each region{'’'}s reference luminance starts as
                  a placeholder (0.18). Paint the regions, then press{' '}
                  <span className="text-brand-fg">Measure from texture</span> in the regions panel —
                  a wrong reference renders the part blown out, not merely off-colour.
                </p>
              )}
              <label className="font-sans text-[10px] text-brand-muted/60">Real-world size (cm)</label>
              <input
                type="number" className={fieldCls} value={fitCm} min={TEMPLATE_BOUNDS.fitCm.min} max={TEMPLATE_BOUNDS.fitCm.max}
                onChange={(e) => { setFitCm(Number(e.target.value) || 0); touch(); }}
              />
              <label className="font-sans text-[10px] text-brand-muted/60">Which way it faces</label>
              <div className="flex flex-wrap gap-1">
                {AXIS_IDS.map((id) => (
                  <button
                    key={id}
                    onClick={() => { setFrontAxis(id); setUpAxis(guessUpAxis(id)); setDecalDepth(proposeDecalDepth(loaded.bounds, id)); touch(); }}
                    aria-pressed={frontAxis === id}
                    className={`${btnCls} font-mono ${frontAxis === id ? 'bg-accent/25 text-accent-2' : 'bg-white/[0.05] text-brand-muted/60 hover:bg-white/10'}`}
                  >{id}</button>
                ))}
              </div>
              <label className="font-sans text-[10px] text-brand-muted/60">Which way is up (in the MESH{'’'}s own space)</label>
              <div className="flex flex-wrap gap-1">
                {AXIS_IDS.map((id) => (
                  <button
                    key={id}
                    onClick={() => { setUpAxis(id); touch(); }}
                    aria-pressed={upAxis === id}
                    disabled={id[1] === frontAxis[1]}
                    className={`${btnCls} font-mono disabled:opacity-20 ${upAxis === id ? 'bg-accent/25 text-accent-2' : 'bg-white/[0.05] text-brand-muted/60 hover:bg-white/10'}`}
                  >{id}</button>
                ))}
              </div>
              <p className="font-sans text-[9px] text-brand-muted/40 leading-relaxed">
                glTF fixes +Y as up for the SCENE, but a node transform can leave the mesh data in a
                different orientation — this repo{'’'}s own reference-head.glb is +90{'°'} about X, so
                its mesh-local front is {AXIS_VECTORS['+y'].join(',')} and its up is {AXIS_VECTORS['-z'].join(',')}.
                A bounding box cannot tell you that. Check both against the marker in the viewport.
              </p>
            </div>

            {/* REGIONS */}
            <div className={panelCls}>
              <span className={labelCls}>3 · Regions — click the model to paint</span>
              <div className="flex items-center gap-1.5">
                <span className="font-sans text-[10px] text-brand-muted/60">Seed bands</span>
                {[1, 2, 3, 4].map((n) => (
                  <button key={n} onClick={() => reseedBands(n)} className={`${btnCls} bg-white/[0.05] text-brand-muted/60 hover:bg-white/10`}>{n}</button>
                ))}
              </div>
              <label className="font-sans text-[10px] text-brand-muted/60">Brush ({brushCm.toFixed(1)} cm)</label>
              <input
                type="range" min={0.5} max={Math.max(2, fitCm)} step={0.5} value={brushCm}
                onChange={(e) => setBrushCm(Number(e.target.value))}
                className="w-full accent-[color:var(--color-accent)]"
                aria-label="Brush radius"
              />
              <div className="flex flex-col gap-1.5">
                {regions.map((r) => (
                  <div key={r.index} className={`flex items-center gap-1.5 rounded-lg p-1 ${activeRegion === r.index ? 'bg-accent/10 ring-1 ring-accent/30' : ''}`}>
                    <button
                      onClick={() => setActiveRegion(r.index)}
                      aria-pressed={activeRegion === r.index}
                      title={`Paint with ${r.label}`}
                      className="shrink-0 w-6 h-6 rounded-md ring-1 ring-white/15 flex items-center justify-center"
                      style={{ backgroundColor: r.defaultHex }}
                    >
                      {activeRegion === r.index && <Brush className="w-3 h-3 text-black/70" />}
                    </button>
                    {/* basis-0 + grow, NOT flex-1 beside fieldCls's `w-full`:
                        two width utilities in one class list resolve by stylesheet
                        order, not attribute order, so the label field collapsed to
                        a sliver while the id field kept its 92px. */}
                    <input
                      className={`${fieldCls} basis-0 grow shrink min-w-[64px]`} value={r.label}
                      onChange={(e) => patchRegion(r.index, { label: e.target.value })}
                      aria-label={`Label for region ${r.index + 1}`}
                    />
                    <input
                      className={`${fieldCls} basis-[88px] grow-0 shrink-0 font-mono`} value={r.id}
                      onChange={(e) => patchRegion(r.index, { id: e.target.value })}
                      aria-label={`Id for region ${r.index + 1}`}
                    />
                    <label className="shrink-0 flex items-center gap-1 font-sans text-[9px] text-brand-muted/50" title="Uncheck for a part the host must not repaint">
                      <input
                        type="checkbox" checked={r.recolourable}
                        onChange={(e) => patchRegion(r.index, { recolourable: e.target.checked })}
                      />
                      edit
                    </label>
                  </div>
                ))}
              </div>
              <p className="font-sans text-[9px] text-brand-muted/40">
                {paintStrokes} paint {paintStrokes === 1 ? 'stroke' : 'strokes'} · {usedRegionIndices(regionIds).length} region(s) in use
              </p>
              {hasTextureMap && (
                <>
                  <button
                    onClick={measureFromTexture}
                    className={`${btnCls} self-start bg-accent/20 text-accent-2 hover:bg-accent/30`}
                  >
                    Measure from texture
                  </button>
                  {measured && (
                    <p className="font-mono text-[9px] text-brand-muted/60 leading-relaxed">
                      {regions.map((r) => `${r.label} ${r.refLuminance.toFixed(3)} (${(measured.texels[r.index] ?? 0).toLocaleString()} px)`).join(' · ')}
                    </p>
                  )}
                  {measured && measured.strokes !== paintStrokes && (
                    <p className="font-sans text-[10px] text-amber-300/80">
                      Painted since the last measure — press Measure from texture again so every
                      reference matches the regions as they now stand.
                    </p>
                  )}
                </>
              )}
            </div>

            {/* TEXT SLOT */}
            <div className={panelCls}>
              <span className={labelCls}>4 · Engraving anchor</span>
              <label className="flex items-center gap-2 font-sans text-[11px] text-brand-fg">
                <input type="checkbox" checked={withTextSlot} onChange={(e) => { setWithTextSlot(e.target.checked); touch(); }} />
                This asset can carry a name
              </label>
              {withTextSlot && (
                <>
                  {anchor && (
                    <p className={`font-sans text-[10px] leading-relaxed ${anchor.onSurface ? 'text-brand-muted/50' : 'text-amber-300/80'}`}>
                      {anchor.onSurface
                        ? 'Anchor is projected onto the mesh surface along the facing axis.'
                        : 'The anchor line misses the model — the marker is floating on the bounding-box face. Slide the height until it lands on the surface.'}
                    </p>
                  )}
                  <label className="font-sans text-[10px] text-brand-muted/60">Height on the front face ({Math.round(heightFraction * 100)}%)</label>
                  <input
                    type="range" min={0} max={1} step={0.01} value={heightFraction}
                    onChange={(e) => { setHeightFraction(Number(e.target.value)); touch(); }}
                    className="w-full accent-[color:var(--color-accent)]" aria-label="Anchor height"
                  />
                  <label className="font-sans text-[10px] text-brand-muted/60">Widest the name may be (cm)</label>
                  <input
                    type="number" className={fieldCls} value={maxWidthCm} step={0.5}
                    min={TEMPLATE_BOUNDS.maxWidthCm.min} max={TEMPLATE_BOUNDS.maxWidthCm.max}
                    onChange={(e) => { setMaxWidthCm(Number(e.target.value) || 0); touch(); }}
                  />
                  <label className="font-sans text-[10px] text-brand-muted/60">Projector depth (model units)</label>
                  <input
                    type="number" className={fieldCls} value={decalDepth} step={0.01}
                    min={TEMPLATE_BOUNDS.decalDepth.min} max={TEMPLATE_BOUNDS.decalDepth.max}
                    onChange={(e) => { setDecalDepth(Number(e.target.value) || 0); touch(); }}
                  />
                  <p className="font-sans text-[9px] text-brand-muted/40 leading-relaxed">
                    Depth is the ONLY thing stopping the name from cutting into the part behind it —
                    a decal clips by box, not by surface.
                  </p>
                </>
              )}
            </div>

            {/* EXPORT */}
            <div className={panelCls}>
              <div className="flex items-center gap-2">
                <span className={labelCls}>5 · Descriptor</span>
                <span className={`ml-auto font-mono text-[9px] px-1.5 py-0.5 rounded-full ${humanEdited ? 'text-emerald-300 bg-emerald-400/10' : 'text-amber-300 bg-amber-400/10'}`}>
                  preparedBy: {humanEdited ? 'human' : 'auto'}
                </span>
              </div>
              <div className="flex gap-1.5">
                <input className={fieldCls} value={assetId} onChange={(e) => { setAssetId(e.target.value); touch(); }} aria-label="Descriptor id" placeholder="id" />
                <input className={fieldCls} value={assetName} onChange={(e) => { setAssetName(e.target.value); touch(); }} aria-label="Descriptor name" placeholder="name" />
              </div>
              <input
                className={fieldCls} value={glbUrl} onChange={(e) => { setGlbUrl(e.target.value); touch(); }}
                aria-label="Published GLB url" placeholder="/models/your-asset.glb (where it will be SERVED from)"
              />
              {!glbUrl && (
                <p className="font-sans text-[10px] text-amber-300/80">
                  A file picked from disk has a blob: URL that dies with this tab. Type the path the
                  asset will actually be served from before exporting.
                </p>
              )}
              <button
                onClick={copy}
                disabled={!json}
                className={`${btnCls} inline-flex items-center gap-1.5 self-start bg-accent/20 text-accent-2 hover:bg-accent/30 disabled:opacity-30`}
              >
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Copied' : 'Copy JSON'}
              </button>
              <textarea
                readOnly value={json} rows={12} aria-label="Descriptor JSON"
                className="w-full bg-black/30 border border-white/10 rounded-lg p-2 font-mono text-[9px] leading-relaxed text-brand-muted/80"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
