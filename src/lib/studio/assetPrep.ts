/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ASSET PREP — turning a raw GLB into an AssetTemplate descriptor.
 *
 * ## The thing this module exists to admit
 *
 * There is no automatic pass that produces a usable descriptor, and pretending
 * otherwise is the failure mode. Meshy's remesher emits ONE watertight manifold:
 * measured on this repo's own `public/models/reference-head.glb` (20 125 verts,
 * 30 109 triangles) `connectedComponents` returns **1** once coincident
 * positions are welded. Segmentation has nothing to segment.
 *
 * Worse, the naive version LOOKS like it works. Union-find over the index buffer
 * exactly as authored returns **815** components on that same file — not 815
 * parts, but 815 slivers, because a glTF exporter duplicates a vertex wherever
 * the UV or the normal is discontinuous. A prep tool that reported "815 regions
 * found!" would be confidently wrong, which is why `connectedComponents` welds
 * by position first and reports BOTH numbers.
 *
 * So the automatic pass here does not pretend to find parts. It does the three
 * things that genuinely are mechanical — measure the box, propose a real-world
 * size, place a text anchor on the front face — and then seeds regions from
 * BANDS along an axis, which is a starting point a human repaints rather than an
 * answer. `preparedBy: 'human'` is the honest outcome for anything shipped;
 * `'auto'` means literally nobody looked.
 *
 * ## Pure
 *
 * No three.js, no DOM, no network. Everything takes plain typed arrays, which is
 * what makes the segmentation maths a unit test instead of a screenshot. The
 * browser half is src/dev/AssetPrepTool.tsx.
 */
import { TEMPLATE_BOUNDS, type AssetRegion, type AssetTemplate, type AssetTextSlot, type Vec3 } from './assetTemplate';
import { MAX_REGIONS, packRegionIds } from './regionTint';

/* ── bounds ───────────────────────────────────────────────────────────────── */

export interface PrepBounds {
  min: Vec3;
  max: Vec3;
}

export function boundsSize(b: PrepBounds): Vec3 {
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
}

export function boundsCenter(b: PrepBounds): Vec3 {
  return [
    (b.min[0] + b.max[0]) / 2,
    (b.min[1] + b.max[1]) / 2,
    (b.min[2] + b.max[2]) / 2,
  ];
}

/** Bounding box of a flat xyz position buffer. Null for an empty/ragged buffer. */
export function boundsOfPositions(positions: ArrayLike<number>): PrepBounds | null {
  const n = Math.floor(positions.length / 3);
  if (n <= 0) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const v = positions[i * 3 + c];
      if (!Number.isFinite(v)) return null;
      if (v < min[c]) min[c] = v;
      if (v > max[c]) max[c] = v;
    }
  }
  return { min, max };
}

/* ── axes ─────────────────────────────────────────────────────────────────── */

export type AxisId = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

export const AXIS_IDS: readonly AxisId[] = ['+x', '-x', '+y', '-y', '+z', '-z'];

export const AXIS_VECTORS: Record<AxisId, Vec3> = {
  '+x': [1, 0, 0], '-x': [-1, 0, 0],
  '+y': [0, 1, 0], '-y': [0, -1, 0],
  '+z': [0, 0, 1], '-z': [0, 0, -1],
};

/** Which cardinal axis a vector points most nearly along. */
export function nearestAxis(v: Vec3): AxisId {
  let best: AxisId = '+z';
  let bestDot = -Infinity;
  for (const id of AXIS_IDS) {
    const a = AXIS_VECTORS[id];
    const dot = v[0] * a[0] + v[1] * a[1] + v[2] * a[2];
    if (dot > bestDot) { bestDot = dot; best = id; }
  }
  return best;
}

/** Index 0/1/2 of the axis a cardinal id runs along. */
export function axisIndex(id: AxisId): 0 | 1 | 2 {
  return id[1] === 'x' ? 0 : id[1] === 'y' ? 1 : 2;
}

/**
 * The front the automatic pass PROPOSES.
 *
 * glTF 2.0 §3.4 fixes the coordinate system as +Y up and −Z forward for a
 * camera, but says nothing about which way an arbitrary asset faces — an
 * exporter's "front" is whatever the artist had pointing at them. So this is a
 * proposal, not a measurement: +Z, which is what Meshy and Blender's default
 * glTF export both produce for a front-facing subject, and which the prep tool
 * puts a rotate control next to precisely because it is a guess.
 */
export const DEFAULT_FRONT_AXIS: AxisId = '+z';

/* ── real-world size ──────────────────────────────────────────────────────── */

export interface FitProposal {
  fitCm: number;
  /** One line the prep tool shows the human, in their words, not ours. */
  reason: string;
  /** False = the tool must make the human confirm before exporting. */
  confident: boolean;
}

/**
 * Propose `template.fitCm` from the model's largest local dimension.
 *
 * A GLB carries no unit. glTF's convention is metres, but a Meshy download is
 * normalised to roughly one unit across, a Blender export is whatever the scene
 * scale was, and a CAD import can be in millimetres. So this reads the magnitude
 * and says what it thinks, with `confident: false` whenever the magnitude does
 * not fall into one of the two ranges that mean something.
 *
 * `defaultCm` is the size the asset SHOULD be in the world, which only a human
 * knows — a cap is ~20cm across, an earring ~2cm. It is the anchor for the
 * normalised case, not a fallback.
 */
export function proposeFitCm(largestUnit: number, defaultCm = 20): FitProposal {
  const clampCm = (n: number) => Math.min(TEMPLATE_BOUNDS.fitCm.max, Math.max(TEMPLATE_BOUNDS.fitCm.min, n));
  if (!Number.isFinite(largestUnit) || largestUnit <= 0) {
    return { fitCm: clampCm(defaultCm), reason: 'The model has no measurable size — using the default.', confident: false };
  }
  if (largestUnit >= 0.4 && largestUnit <= 4) {
    return {
      fitCm: clampCm(defaultCm),
      reason: `Roughly one unit across (${largestUnit.toFixed(2)}) — a normalised export, so its real size has to be stated, not read.`,
      confident: true,
    };
  }
  if (largestUnit >= 5 && largestUnit <= 300) {
    return {
      fitCm: clampCm(largestUnit),
      reason: `${largestUnit.toFixed(1)} units across — already looks like centimetres, so it is taken at face value.`,
      confident: true,
    };
  }
  return {
    fitCm: clampCm(defaultCm),
    reason: `${largestUnit.toFixed(3)} units across is neither a normalised export nor centimetres — check this one by eye.`,
    confident: false,
  };
}

/* ── text anchor ──────────────────────────────────────────────────────────── */

export interface TextAnchor {
  position: Vec3;
  normal: Vec3;
  up: Vec3;
}

/**
 * The up the automatic pass GUESSES when nobody has said.
 *
 * "Whichever axis is neither the front nor X" is a coin flip on its sign, and
 * this repo's own `reference-head.glb` is the proof it can be wrong in a way no
 * bounding box reveals: its node carries `rotation: [0.7071, 0, 0, 0.7071]`, a
 * +90 degree turn about X, so the MESH data is Z-up while the SCENE is Y-up. In
 * the mesh's own space — which is the space `AssetTextSlot.position` lives in,
 * because assetDecal builds against `largestMesh` with its world matrix
 * identitied — the front is +Y and up is −Z. Nothing in the geometry says so.
 *
 * Hence `proposeTextAnchor` takes an explicit `upAxis`, and the prep tool puts a
 * control next to it. This function is the fallback for the automatic pass only.
 */
export function guessUpAxis(frontAxis: AxisId): AxisId {
  return axisIndex(frontAxis) === 1 ? '+z' : '+y';
}

/**
 * Place a text anchor on the FRONT FACE of the bounding box.
 *
 * This is the "raycast a text anchor" step, done against the box rather than the
 * mesh on purpose: a ray fired at a concave front (the gap between a cap's brim
 * and its crown) hits the far wall, and a decal projected from inside the model
 * carves nothing. Sitting on the box and letting `decalDepth` reach inward is
 * both simpler and more robust — the projector is a box anyway.
 *
 * `heightFraction` runs 0 (the `upAxis`-negative end) to 1 (its positive end);
 * 0.5 is the middle of the front face. An `upAxis` parallel to the front would
 * collapse the decal's basis, so it is rejected in favour of the guess — the
 * same defence `assetTemplate.orthogonalUp` applies downstream.
 */
export function proposeTextAnchor(
  bounds: PrepBounds,
  frontAxis: AxisId = DEFAULT_FRONT_AXIS,
  heightFraction = 0.5,
  upAxis?: AxisId,
): TextAnchor {
  const normal = AXIS_VECTORS[frontAxis];
  const ai = axisIndex(frontAxis);
  const centre = boundsCenter(bounds);
  const position: Vec3 = [centre[0], centre[1], centre[2]];
  // On the face, not inside it: the positive half-axis takes max, the negative
  // takes min.
  position[ai] = frontAxis[0] === '+' ? bounds.max[ai] : bounds.min[ai];

  const chosen = upAxis && axisIndex(upAxis) !== ai ? upAxis : guessUpAxis(frontAxis);
  const upIndex = axisIndex(chosen);
  const t = Math.min(1, Math.max(0, Number.isFinite(heightFraction) ? heightFraction : 0.5));
  // `heightFraction` is "up", not "+axis": on a −axis up, 1 must mean the
  // minimum end, or the slider runs backwards against what the host can see.
  const along = chosen[0] === '+' ? t : 1 - t;
  position[upIndex] = bounds.min[upIndex] + (bounds.max[upIndex] - bounds.min[upIndex]) * along;

  const up = AXIS_VECTORS[chosen];
  return { position, normal: [normal[0], normal[1], normal[2]], up: [up[0], up[1], up[2]] };
}

/**
 * A decal projector depth that reaches into the surface without punching out the
 * back — a fraction of the model's depth ALONG the projection axis.
 *
 * This is the single number stopping a name from bleeding onto an adjacent part
 * (assetDecal.ts note 2), so the proposal is deliberately shallow. Clamped into
 * TEMPLATE_BOUNDS.decalDepth, which owns the range.
 */
export function proposeDecalDepth(bounds: PrepBounds, frontAxis: AxisId = DEFAULT_FRONT_AXIS): number {
  const depth = boundsSize(bounds)[axisIndex(frontAxis)];
  const proposed = (Number.isFinite(depth) && depth > 0 ? depth : 1) * 0.12;
  return Math.min(TEMPLATE_BOUNDS.decalDepth.max, Math.max(TEMPLATE_BOUNDS.decalDepth.min, proposed));
}

/* ── segmentation ─────────────────────────────────────────────────────────── */

export interface ComponentResult {
  /** Components over WELDED positions — the physical shell count. */
  count: number;
  /**
   * Components over the index buffer exactly as authored. Larger than `count`
   * whenever the exporter split vertices at a UV or normal seam, which is
   * almost always — reported so a tool cannot present it as a part count.
   */
  rawCount: number;
  /** Per-vertex component index, 0-based, dense. */
  ids: Uint32Array;
}

/** Quantised position key — the weld. 1e-5 of a unit is below any real seam. */
function positionKey(positions: ArrayLike<number>, v: number, epsilon: number): string {
  const q = (x: number) => Math.round(x / epsilon);
  return `${q(positions[v * 3])},${q(positions[v * 3 + 1])},${q(positions[v * 3 + 2])}`;
}

/**
 * Connected components of a triangle mesh, welding coincident positions first.
 *
 * The welding is the whole point. Without it this returns the number of UV
 * islands, which on a Meshy manifold is in the hundreds and means nothing about
 * how the object is built. See this module's docblock for the measured numbers.
 *
 * `indices` null = the buffer is non-indexed (every three vertices are one
 * triangle), which is what a decimated export often is.
 */
export function connectedComponents(
  positions: ArrayLike<number>,
  indices: ArrayLike<number> | null,
  epsilon = 1e-5,
): ComponentResult {
  const vertexCount = Math.floor(positions.length / 3);
  if (vertexCount <= 0) return { count: 0, rawCount: 0, ids: new Uint32Array(0) };

  const eps = Number.isFinite(epsilon) && epsilon > 0 ? epsilon : 1e-5;
  const triCount = indices ? Math.floor(indices.length / 3) : Math.floor(vertexCount / 3);
  const at = (i: number) => (indices ? indices[i] : i);

  // Two disjoint sets over the same triangles: one keyed by vertex index (raw),
  // one keyed by welded position id.
  const raw = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) raw[i] = i;
  const rawFind = (x: number) => { while (raw[x] !== x) { raw[x] = raw[raw[x]]; x = raw[x]; } return x; };

  const weldId = new Int32Array(vertexCount);
  const seen = new Map<string, number>();
  const weld: number[] = [];
  for (let v = 0; v < vertexCount; v++) {
    const key = positionKey(positions, v, eps);
    let id = seen.get(key);
    if (id === undefined) { id = weld.length; weld.push(id); seen.set(key, id); }
    weldId[v] = id;
  }
  const weldFind = (x: number) => { while (weld[x] !== x) { weld[x] = weld[weld[x]]; x = weld[x]; } return x; };

  for (let t = 0; t < triCount; t++) {
    const a = at(t * 3), b = at(t * 3 + 1), c = at(t * 3 + 2);
    if (a >= vertexCount || b >= vertexCount || c >= vertexCount) continue;
    for (const [p, q] of [[a, b], [b, c]] as const) {
      const ra = rawFind(p), rb = rawFind(q);
      if (ra !== rb) raw[ra] = rb;
      const wa = weldFind(weldId[p]), wb = weldFind(weldId[q]);
      if (wa !== wb) weld[wa] = wb;
    }
  }

  const rawRoots = new Set<number>();
  for (let v = 0; v < vertexCount; v++) rawRoots.add(rawFind(v));

  // Dense per-vertex component ids, from the WELDED sets — the useful answer.
  const dense = new Map<number, number>();
  const ids = new Uint32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    const root = weldFind(weldId[v]);
    let d = dense.get(root);
    if (d === undefined) { d = dense.size; dense.set(root, d); }
    ids[v] = d;
  }

  return { count: dense.size, rawCount: rawRoots.size, ids };
}

/**
 * Seed region ids by slicing the model into equal BANDS along one axis.
 *
 * Not a segmentation — a scaffold. On a cap, bands along the vertical do split
 * crown from brim well enough to be worth painting over rather than starting
 * from a blank mesh; on anything else they are simply a grid the human corrects.
 * Bounded by MAX_REGIONS because that is the GLSL uniform array length.
 */
export function bandRegionIds(
  positions: ArrayLike<number>,
  bounds: PrepBounds,
  axis: AxisId,
  bands: number,
): Uint8Array {
  const vertexCount = Math.floor(positions.length / 3);
  const out = new Uint8Array(Math.max(0, vertexCount));
  const n = Math.min(MAX_REGIONS, Math.max(1, Math.floor(Number.isFinite(bands) ? bands : 1)));
  if (vertexCount <= 0 || n === 1) return out;

  const ai = axisIndex(axis);
  const lo = bounds.min[ai];
  const span = bounds.max[ai] - lo;
  if (!Number.isFinite(span) || span <= 0) return out;

  const descending = axis[0] === '-';
  for (let v = 0; v < vertexCount; v++) {
    const t = (positions[v * 3 + ai] - lo) / span;
    // `n - 1` for t === 1 exactly, so the top vertex is not its own band.
    let band = Math.min(n - 1, Math.max(0, Math.floor(t * n)));
    if (descending) band = n - 1 - band;
    out[v] = band;
  }
  return out;
}

/**
 * Paint every vertex inside a sphere with one region id — the human correction
 * step, and the reason `preparedBy` exists.
 *
 * MUTATES `ids` in place and returns how many vertices changed, so the tool can
 * tell a real edit from a click that landed on nothing (the difference between
 * a descriptor a person authored and one they only looked at).
 */
export function paintSphere(
  positions: ArrayLike<number>,
  ids: Uint8Array,
  centre: Vec3,
  radius: number,
  region: number,
): number {
  const vertexCount = Math.min(ids.length, Math.floor(positions.length / 3));
  if (!Number.isFinite(radius) || radius <= 0) return 0;
  const value = Math.min(MAX_REGIONS - 1, Math.max(0, Math.round(region)));
  const r2 = radius * radius;
  let changed = 0;
  for (let v = 0; v < vertexCount; v++) {
    const dx = positions[v * 3] - centre[0];
    const dy = positions[v * 3 + 1] - centre[1];
    const dz = positions[v * 3 + 2] - centre[2];
    if (dx * dx + dy * dy + dz * dz > r2) continue;
    if (ids[v] === value) continue;
    ids[v] = value;
    changed += 1;
  }
  return changed;
}

/** Which region ids actually appear, so the tool never emits an empty region. */
export function usedRegionIndices(ids: ArrayLike<number>): number[] {
  const seen = new Set<number>();
  for (let i = 0; i < ids.length; i++) seen.add(ids[i]);
  return [...seen].sort((a, b) => a - b);
}

/* ── descriptor assembly ──────────────────────────────────────────────────── */

export interface PrepRegionDraft {
  id: string;
  label: string;
  recolourable: boolean;
  defaultHex: string;
  refLuminance: number;
  /** Slot in the packed per-vertex id buffer. */
  index: number;
}

export interface PrepInput {
  id: string;
  name: string;
  glbUrl: string;
  fitCm: number;
  frontAxis: AxisId;
  regions: PrepRegionDraft[];
  /** Per-vertex region indices, or null for a single-region asset. */
  regionIds: Uint8Array | null;
  textSlots: (Omit<AssetTextSlot, 'label'> & { label?: string })[];
  /**
   * True the moment a person paints a region, moves an anchor or edits a field.
   * The ONLY input to `preparedBy`, because the automatic pass is known to be
   * wrong on real assets and a descriptor that claims otherwise is a lie the
   * next person has to discover for themselves.
   */
  humanEdited: boolean;
}

/**
 * Assemble the descriptor the catalogue pastes in.
 *
 * Regions that no vertex carries are DROPPED: a band scaffold usually leaves one
 * empty after painting, and an empty region is a colour control that does
 * nothing when the host drags it.
 */
export function buildTemplateDescriptor(input: PrepInput): AssetTemplate {
  const used = input.regionIds ? new Set(usedRegionIndices(input.regionIds)) : new Set([0]);
  const regions: AssetRegion[] = input.regions
    .filter((r) => used.has(r.index))
    .slice(0, MAX_REGIONS)
    .map((r) => ({
      id: r.id,
      label: r.label || r.id,
      recolourable: r.recolourable,
      defaultHex: r.defaultHex,
      refLuminance: r.refLuminance,
    }));

  const textSlots: AssetTextSlot[] = input.textSlots
    .slice(0, TEMPLATE_BOUNDS.maxTextSlots)
    .map((s) => ({ ...s, label: s.label || s.id }));

  const out: AssetTemplate = {
    id: input.id,
    name: input.name || input.id,
    glbUrl: input.glbUrl,
    fitCm: input.fitCm,
    frontAxis: AXIS_VECTORS[input.frontAxis] ?? AXIS_VECTORS[DEFAULT_FRONT_AXIS],
    regions,
    textSlots,
    preparedBy: input.humanEdited ? 'human' : 'auto',
  };
  // Only worth carrying when there is more than one region to distinguish; a
  // 30k-vertex buffer that says "everything is region 0" is 27 KB of base64
  // saying nothing (FaceRig treats a missing attribute as exactly that).
  if (input.regionIds && regions.length > 1) out.regionIds = packRegionIds(input.regionIds);
  return out;
}

/** The descriptor as the catalogue wants it pasted — stable key order. */
export function descriptorJson(template: AssetTemplate): string {
  return JSON.stringify(template, null, 2);
}
