/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Procedural 3D name jewelry — the THREE half: typeface loading, geometry
 * assembly and GLB export. Browser-only (fetch + WebGL-bound classes); the
 * arithmetic it is built on lives in ./text3d.ts, which stays pure so it can be
 * tested under vitest's node env. Never import THIS file from a test.
 *
 * Everything is authored in CENTIMETRES (MediaPipe head space — see
 * faceRig.ts). The caller dispatches SET_MODEL_ASSET with an explicit
 * `scale: 1`, so no auto-fit pass ever rescales a piece that is already
 * life-size.
 */
import * as THREE from 'three';
import { FontLoader, GLTFExporter, TextGeometry, mergeBufferGeometries, type Font } from 'three-stdlib';
// `?url` (typed by vite/client) hands back an asset URL instead of parsing the
// JSON at build time — a bare JSON import needs resolveJsonModule, which this
// project does not enable. The typefaces ship inside the installed `three`
// package, so this adds no dependency and no network font.
import helvetikerRegularUrl from 'three/examples/fonts/helvetiker_regular.typeface.json?url';
import helvetikerBoldUrl from 'three/examples/fonts/helvetiker_bold.typeface.json?url';
import optimerBoldUrl from 'three/examples/fonts/optimer_bold.typeface.json?url';
import {
  KIND_DIMS,
  MATERIAL_MAP,
  catenaryPoints,
  fitScaleToWidth,
  linkFrames,
  linkRadii,
  validateSpec,
  type CatPoint,
  type FontId,
  type Text3DSpec,
} from './text3d';

const FONT_URLS: Record<FontId, string> = {
  helvetiker: helvetikerRegularUrl,
  helvetikerBold: helvetikerBoldUrl,
  optimerBold: optimerBoldUrl,
};

/** Parsed typefaces, keyed by id. The PROMISE is cached (not the resolved
 *  Font), so two panels opening at once share one fetch instead of racing. */
const fontCache = new Map<FontId, Promise<Font>>();

/**
 * Fetch + parse one of the three shipped typefaces. Rejects with a readable
 * message on an unknown id, a failed fetch or unparseable JSON; a rejected
 * promise is evicted from the cache so the next attempt actually retries
 * instead of replaying the failure forever.
 */
export function loadFont(fontId: FontId): Promise<Font> {
  const cached = fontCache.get(fontId);
  if (cached) return cached;
  const url = FONT_URLS[fontId];
  if (!url) return Promise.reject(new Error(`Unknown font "${fontId}".`));

  const pending = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Font fetch failed (${res.status}).`);
    const json = (await res.json()) as Parameters<FontLoader['parse']>[0];
    return new FontLoader().parse(json);
  })();
  pending.catch(() => {
    if (fontCache.get(fontId) === pending) fontCache.delete(fontId);
  });
  fontCache.set(fontId, pending);
  return pending;
}

/** The typeface's own glyph table — what clampName tests membership against. */
export function glyphsOf(font: Font): Record<string, unknown> {
  return font.data.glyphs as Record<string, unknown>;
}

export interface BuiltText3D {
  group: THREE.Group;
  /** Frees every geometry and material this build created. Call it when the
   *  group is swapped out or the editor unmounts — nothing else owns them. */
  dispose: () => void;
}

/** Bevel profile, cm. Small enough to survive the 0.4cm nose-ring charm and
 *  still read as a chamfered edge on a 3cm floating word. */
const BEVEL_THICKNESS_CM = 0.04;
const BEVEL_SIZE_CM = 0.03;

/** Torus tessellation. A chain is many links, so the per-link budget stays low;
 *  the single open nose ring can afford a smoother sweep. */
const LINK_RADIAL_SEGMENTS = 8;
const LINK_TUBULAR_SEGMENTS = 16;
const RING_RADIAL_SEGMENTS = 12;
const RING_TUBULAR_SEGMENTS = 48;

interface TextPart {
  mesh: THREE.Mesh;
  /** Half the mesh's WORLD-space height after the fit scale, cm. */
  halfHeight: number;
}

/**
 * The extruded name, centred on its own origin and shrunk (never grown) to fit
 * `maxWidthCm`.
 *
 * `height` is deliberate: three-stdlib's TextGeometry names the extrusion depth
 * `height` and has no `depth` parameter at all — passing `depth` is silently
 * ignored and leaves the default 50-unit slab, which in centimetre head space
 * is half a metre of text.
 */
function buildTextPart(
  spec: Text3DSpec,
  font: Font,
  material: THREE.Material,
  maxWidthCm: number,
  track: (g: THREE.BufferGeometry) => void,
): TextPart {
  const geo = new TextGeometry(spec.text, {
    font,
    size: spec.textHeightCm,
    height: spec.depthCm,
    curveSegments: 6,
    bevelEnabled: spec.bevel,
    bevelThickness: BEVEL_THICKNESS_CM,
    bevelSize: BEVEL_SIZE_CM,
  });
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  if (!bb || !Number.isFinite(bb.min.x) || !Number.isFinite(bb.max.x)) {
    geo.dispose();
    throw new Error('That name produced no geometry — try different characters.');
  }
  const width = bb.max.x - bb.min.x;
  const height = bb.max.y - bb.min.y;
  // TextGeometry lays glyphs out from a baseline at the origin; centring is
  // what lets every kind position the text by its middle instead of guessing
  // at the baseline offset for each font.
  geo.center();
  track(geo);

  const fit = fitScaleToWidth(width, maxWidthCm);
  const mesh = new THREE.Mesh(geo, material);
  mesh.scale.setScalar(fit);
  return { mesh, halfHeight: (height * fit) / 2 };
}

/** Mean centre-to-centre distance along a polyline — the spacing the link size
 *  is derived from. */
function meanSpacing(points: CatPoint[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total / (points.length - 1);
}

interface ChainPart {
  mesh: THREE.Mesh | null;
  radius: number;
  tube: number;
}

/**
 * One merged mesh for the whole chain: a torus per link, transformed into place
 * and merged with three-stdlib's mergeBufferGeometries (all inputs are tori
 * built from the same constructor, so their attribute sets match exactly).
 *
 * Merging matters — 28 separate meshes would be 28 draw calls per frame in the
 * booth and 28 nodes in the exported GLB.
 */
function buildChainPart(
  points: CatPoint[],
  material: THREE.Material,
  track: (g: THREE.BufferGeometry) => void,
): ChainPart {
  const spacing = meanSpacing(points);
  const { radius, tube } = linkRadii(spacing);
  if (points.length < 2) return { mesh: null, radius, tube };

  const base = new THREE.TorusGeometry(radius, tube, LINK_RADIAL_SEGMENTS, LINK_TUBULAR_SEGMENTS);
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const rz = new THREE.Matrix4();
  const rx = new THREE.Matrix4();

  for (const f of linkFrames(points, 2 * (radius + tube))) {
    // A torus is born in the XY plane with its axis along +Z. RotX(roll) tips
    // every other link into the perpendicular plane; RotZ(angle) then turns +X
    // onto the chain tangent, so each link's plane contains the direction the
    // chain is running and neighbours read as interlocked.
    rz.makeRotationZ(f.angle);
    rx.makeRotationX(f.roll);
    m.multiplyMatrices(rz, rx);
    m.setPosition(f.x, f.y, 0);
    parts.push(base.clone().applyMatrix4(m));
  }

  const merged = mergeBufferGeometries(parts, false);
  for (const p of parts) p.dispose();
  base.dispose();
  if (!merged) return { mesh: null, radius, tube };
  track(merged);
  return { mesh: new THREE.Mesh(merged, material), radius, tube };
}

/** Evenly spaced points straight down from the origin — the earring's chain. */
function verticalPoints(n: number, dropCm: number): CatPoint[] {
  const count = Math.max(2, Math.floor(n));
  return Array.from({ length: count }, (_, i) => ({ x: 0, y: -(dropCm * i) / (count - 1) }));
}

/**
 * Build the piece described by `spec` using an already-loaded typeface.
 *
 * Throws (never returns a half-built group) on an out-of-bounds spec or on text
 * that extrudes to nothing — the caller shows the message and keeps the editor
 * open. The returned group's origin IS the head anchor point, so the piece
 * hangs from wherever KIND_ANCHOR puts it with no extra offset.
 */
export function buildText3D(spec: Text3DSpec, font: Font): BuiltText3D {
  const check = validateSpec(spec);
  if (!check.ok) throw new Error(check.errors[0]);

  const preset = MATERIAL_MAP[spec.material];
  const dims = KIND_DIMS[spec.kind];
  const geometries: THREE.BufferGeometry[] = [];
  const track = (g: THREE.BufferGeometry) => { geometries.push(g); };

  // One material for the whole piece: chain and pendant are the same metal, and
  // a single material keeps the exported GLB to one primitive per mesh.
  const material = new THREE.MeshStandardMaterial({
    color: preset.color,
    metalness: preset.metalness,
    roughness: preset.roughness,
    emissive: preset.emissive,
    emissiveIntensity: preset.emissiveIntensity,
    side: THREE.DoubleSide,
  });

  const group = new THREE.Group();
  group.name = `${spec.text}-${spec.kind}`;

  try {
    if (spec.kind === 'necklace') {
      // The catenary's endpoints sit AT the anchor plane (y = 0) and the curve
      // only ever goes down, so the whole chain hangs below the chin anchor.
      const points = catenaryPoints(spec.chainLinks, dims.spanCm, spec.sagCm);
      const chain = buildChainPart(points, material, track);
      if (chain.mesh) group.add(chain.mesh);
      const text = buildTextPart(spec, font, material, dims.maxTextWidthCm, track);
      // Pendant hangs off the lowest link, clear of the torus's outer edge.
      text.mesh.position.set(0, -spec.sagCm - (chain.radius + chain.tube) - text.halfHeight, 0);
      group.add(text.mesh);
    } else if (spec.kind === 'earrings') {
      // Built symmetric about its own vertical axis, so ONE GLB serves both
      // ears — the caller adds the same URL twice (leftEar, then rightEar).
      const points = verticalPoints(spec.chainLinks, dims.dropCm);
      const chain = buildChainPart(points, material, track);
      if (chain.mesh) group.add(chain.mesh);
      const text = buildTextPart(spec, font, material, dims.maxTextWidthCm, track);
      text.mesh.position.set(0, -dims.dropCm - (chain.radius + chain.tube) - text.halfHeight, 0);
      group.add(text.mesh);
    } else if (spec.kind === 'nosering') {
      const r = dims.ringDiameterCm / 2;
      const ringGeo = new THREE.TorusGeometry(
        r,
        dims.ringTubeCm,
        RING_RADIAL_SEGMENTS,
        RING_TUBULAR_SEGMENTS,
        dims.ringArcRad,
      );
      track(ringGeo);
      const ring = new THREE.Mesh(ringGeo, material);
      // TorusGeometry sweeps from +X, so the un-drawn arc is centred halfway
      // between its end and 2π. Turn that gap to the top, where the piercing
      // would be, instead of leaving it wherever the sweep happened to end.
      ring.rotation.z = Math.PI / 2 - (dims.ringArcRad + Math.PI * 2) / 2;
      ring.position.set(0, -(r + dims.ringTubeCm), 0);
      group.add(ring);
      const text = buildTextPart(spec, font, material, dims.maxTextWidthCm, track);
      text.mesh.position.set(0, -2 * (r + dims.ringTubeCm) - text.halfHeight, 0);
      group.add(text.mesh);
    } else {
      const text = buildTextPart(spec, font, material, dims.maxTextWidthCm, track);
      group.add(text.mesh);
    }
  } catch (e) {
    // A throw partway through would otherwise strand whatever was already
    // built — free it before the error leaves this function.
    for (const g of geometries) g.dispose();
    material.dispose();
    throw e;
  }

  // Survives the GLB round-trip as node `extras`, so a piece re-imported later
  // still identifies itself as generated jewelry.
  group.userData.beamwallText3d = { kind: spec.kind, text: spec.text };

  return {
    group,
    dispose: () => {
      for (const g of geometries) g.dispose();
      geometries.length = 0;
      material.dispose();
    },
  };
}

/**
 * Serialize a built group to a binary GLB blob.
 *
 * `model/gltf-binary` is what db.ts `extFor` maps to the `.glb` extension, so
 * the uploaded file lands with the extension the studio's loaders expect.
 */
export async function exportGlb(root: THREE.Object3D): Promise<Blob> {
  const out = await new GLTFExporter().parseAsync(root, { binary: true });
  if (!(out instanceof ArrayBuffer)) {
    throw new Error('Export produced JSON instead of a binary GLB.');
  }
  return new Blob([out], { type: 'model/gltf-binary' });
}
