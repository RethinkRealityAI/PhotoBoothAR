/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * cardFlight — the PURE maths behind the 'airplane' card reveal
 * (components/cards/reveals/AirplaneReveal.tsx). No three.js, no DOM.
 *
 * THE FOLD MODEL. A classic paper dart is folded from the card-sized sheet in
 * seven folds: the two top corners onto the centre line ('corners'), the new
 * slanted edges onto the centre line again ('edges'), the whole sheet in half
 * along the centre line ('keel'), and each wing down ('wings'). Each fold is a
 * RIGID rotation of part of the paper about a hinge line. Instead of guessing
 * vertex positions, the sheet is cut along every crease the folds create —
 * including the creases a later fold makes through flaps an earlier fold laid
 * on top — into convex FACETS (the flat sheet split into the dart's crease
 * pattern). A facet records which folds carry it.
 *
 * Posing is then exact: start from the flat sheet and apply folds in order,
 * each rotating only the facets it carries. A fold's hinge was measured in the
 * state "every earlier fold complete", so a pose is exact whenever every fold
 * that is partly done has all earlier folds complete — which is precisely what
 * an unfold played in REVERSE order is (wings, then keel, then edges, then
 * corners). `unfoldSchedule` only overlaps groups whose hinges are independent
 * of one another (wings↔keel, keel↔edges); `foldScheduleIsSafe` pins that.
 *
 * Flat folds (corners, edges) are a full 180° about hinges nudged one paper
 * thickness behind the sheet, so layers stack in physical order instead of
 * z-fighting or poking through the printed face.
 *
 * THE FLIGHT. A lazy figure-of-eight, then — once caught — a Catmull-Rom path
 * (swoop toward the viewer, one loop, settle in front), re-timed by arc length
 * so speed starts at the idle speed and eases to zero. Orientation comes from
 * the APPARENT LIFT (acceleration + gravity): level flight is upright, turns
 * bank, and the top of a loop is inverted — all from one formula.
 */

export type V2 = readonly [number, number];
export type V3 = [number, number, number];

/* ── Small vector helpers (exported for the scene + tests) ─────────────── */

export function sub3(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function add3(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function scale3(a: V3, k: number): V3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}
export function dot3(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function cross3(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function len3(a: V3): number {
  return Math.hypot(a[0], a[1], a[2]);
}
export function norm3(a: V3, fallback: V3 = [0, 1, 0]): V3 {
  const l = len3(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [...fallback];
}
export function lerp3(a: V3, b: V3, t: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Rodrigues rotation of `p` about the line through `o` with unit `axis`. */
export function rotateAbout(p: V3, o: V3, axis: V3, angle: number): V3 {
  const v = sub3(p, o);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = axis;
  const kxv = cross3(k, v);
  const kdv = dot3(k, v);
  return [
    o[0] + v[0] * c + kxv[0] * s + k[0] * kdv * (1 - c),
    o[1] + v[1] * c + kxv[1] * s + k[1] * kdv * (1 - c),
    o[2] + v[2] * c + kxv[2] * s + k[2] * kdv * (1 - c),
  ];
}

/* ── Easing ────────────────────────────────────────────────────────────── */

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const easeInOutCubic = (x: number): number => {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
export const easeOutCubic = (x: number): number => 1 - Math.pow(1 - clamp01(x), 3);
export const easeInOutSine = (x: number): number => -(Math.cos(Math.PI * clamp01(x)) - 1) / 2;
/** 0 before `a`, 1 after `b`, eased between. */
export const window01 = (t: number, a: number, b: number, ease: (x: number) => number = easeInOutCubic): number =>
  b <= a ? (t >= b ? 1 : 0) : ease((t - a) / (b - a));

/* ── Stage: how big the card is on this screen ─────────────────────────── */

export interface CardStage {
  /** width / height of the card sheet. */
  aspect: number;
  /** Phone: the card IS the screen, edge to edge. */
  fullBleed: boolean;
  /** Fraction of the viewport HEIGHT the finished card fills. */
  fillHeight: number;
}

/** Desktop stage: a tall phone-proportioned card centred on the field. */
export const DESKTOP_CARD_ASPECT = 9 / 16;

export function cardStage(viewW: number, viewH: number): CardStage {
  const w = Number.isFinite(viewW) && viewW > 0 ? viewW : 390;
  const h = Number.isFinite(viewH) && viewH > 0 ? viewH : 844;
  const a = w / h;
  if (a < 0.75 && w < 700) {
    // Full bleed: the card takes the screen's own proportions, clamped so a
    // very odd window still folds into a sensible dart.
    return { aspect: Math.min(0.75, Math.max(0.4, a)), fullBleed: true, fillHeight: 1.02 };
  }
  return { aspect: DESKTOP_CARD_ASPECT, fullBleed: false, fillHeight: 0.88 };
}

/** Distance from a camera (vertical fov in degrees) at which a card of size
 *  (cardW × cardH) fills `fillHeight` of the view — or, when full-bleed, covers
 *  the whole view edge to edge. */
export function fillDistance(
  cardW: number,
  cardH: number,
  viewAspect: number,
  fovDeg: number,
  fillHeight: number,
  fullBleed: boolean,
): number {
  const t = Math.tan(((fovDeg * Math.PI) / 180) / 2);
  const dH = cardH / (2 * t * fillHeight);
  if (!fullBleed) return dH;
  // Cover: the nearer of the two distances at which width or height fits.
  const dW = cardW / (2 * t * viewAspect * fillHeight);
  return Math.min(dH, dW);
}

/** Visible half-extents of the view plane at `depth` in front of the camera. */
export function viewHalfExtents(depth: number, viewAspect: number, fovDeg: number): { hw: number; hh: number } {
  const hh = depth * Math.tan(((fovDeg * Math.PI) / 180) / 2);
  return { hw: hh * viewAspect, hh };
}

/* ── The dart ──────────────────────────────────────────────────────────── */

export type FoldGroup = 'corners' | 'edges' | 'keel' | 'wings';
export const FOLD_GROUPS: readonly FoldGroup[] = ['corners', 'edges', 'keel', 'wings'];
export type FoldAmounts = Record<FoldGroup, number>;
export const FOLDED: Readonly<FoldAmounts> = Object.freeze({ corners: 1, edges: 1, keel: 1, wings: 1 });
export const FLAT: Readonly<FoldAmounts> = Object.freeze({ corners: 0, edges: 0, keel: 0, wings: 0 });

interface FoldDef {
  group: FoldGroup;
  /** Two flat-sheet points on the crease and one on the side that moves. */
  a: V2;
  b: V2;
  ref: V2;
  /** Which way the moving side swings, relative to the hinge facet's face normal. */
  toward: 'back' | 'front';
  angle: number;
  /** Hinge nudged this far in the swing direction (paper thickness stacking). */
  offset: number;
  /** Only facets on this side of the flat centre line may move (+1 right, -1 left). */
  half?: 1 | -1;
}

export interface DartFold {
  group: FoldGroup;
  point: V3;
  axis: V3;
  /** Signed full angle (radians) at amount 1. */
  angle: number;
}

export interface DartFacet {
  /** Convex polygon in flat-sheet coordinates (CCW). */
  poly: V2[];
  /** Indices into `folds` that carry this facet. */
  moves: number[];
}

export interface DartModel {
  w: number;
  h: number;
  facets: DartFacet[];
  folds: DartFold[];
  /** Triangle soup: flat positions (z = 0), 3 floats per vertex. */
  flat: Float32Array;
  /** UVs: u = (x + w) / 2w, v = (y + h) / 2h. */
  uv: Float32Array;
  /** For each fold, the vertex indices it carries. */
  carried: Uint32Array[];
  /** Interior crease segments in flat coordinates (deduplicated). */
  creases: [V2, V2][];
}

interface WorkFacet {
  poly: V2[];
  moves: number[];
  /** Rigid transform flat → current: rotation (row-major 3×3) + translation. */
  r: number[];
  t: V3;
}

const IDENTITY_R = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function applyR(r: number[], v: V3): V3 {
  return [
    r[0] * v[0] + r[1] * v[1] + r[2] * v[2],
    r[3] * v[0] + r[4] * v[1] + r[5] * v[2],
    r[6] * v[0] + r[7] * v[1] + r[8] * v[2],
  ];
}

function rotationMatrix(axis: V3, angle: number): number[] {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const C = 1 - c;
  return [
    c + x * x * C, x * y * C - z * s, x * z * C + y * s,
    y * x * C + z * s, c + y * y * C, y * z * C - x * s,
    z * x * C - y * s, z * y * C + x * s, c + z * z * C,
  ];
}

function mulR(a: number[], b: number[]): number[] {
  const out = new Array<number>(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  return out;
}

function toCurrent(f: WorkFacet, p: V2): V3 {
  return add3(applyR(f.r, [p[0], p[1], 0]), f.t);
}

export function polygonArea(poly: readonly V2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function centroid(poly: readonly V2[]): V2 {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p[0];
    y += p[1];
  }
  return [x / poly.length, y / poly.length];
}

function containsConvex(poly: readonly V2[], p: V2, eps = 1e-7): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (cr < -eps) return false;
  }
  return true;
}

/** Sutherland–Hodgman against one affine half-plane: keeps d(p) >= 0 (sign = 1) or <= 0 (sign = -1). */
function clipHalf(poly: readonly V2[], d: (p: V2) => number, sign: 1 | -1): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const dp = d(p) * sign;
    const dq = d(q) * sign;
    if (dp >= 0) out.push(p);
    if ((dp >= 0) !== (dq >= 0)) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  // Drop consecutive duplicates (a vertex exactly on the line is pushed twice).
  const dedup: V2[] = [];
  for (const p of out) {
    const last = dedup[dedup.length - 1];
    if (last === undefined || Math.hypot(last[0] - p[0], last[1] - p[1]) > 1e-9) dedup.push(p);
  }
  if (dedup.length > 1) {
    const f = dedup[0];
    const l = dedup[dedup.length - 1];
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) <= 1e-9) dedup.pop();
  }
  return dedup;
}

const AREA_EPS = 1e-7;

function dartFoldDefs(w: number, h: number, tau: number): FoldDef[] {
  const s = Math.sin(Math.PI / 8);
  const c = Math.cos(Math.PI / 8);
  const nose: V2 = [0, h];
  const along = (dir: V2, t: number): V2 => [nose[0] + dir[0] * t, nose[1] + dir[1] * t];
  // B crease length before it leaves the sheet (right edge or bottom).
  const bLen = Math.min(w / s, (2 * h) / c);
  const k = Math.min(0.36 * w, 0.3 * h); // keel depth at the tail
  const wingDir: V2 = [k, -2 * h];
  const xB = Math.min(w, 1.9 * h * Math.tan(Math.PI / 8));
  const defs: FoldDef[] = [];
  for (const side of [1, -1] as const) {
    defs.push({
      group: 'corners',
      a: along([side * w, -w], 0.3),
      b: along([side * w, -w], 0.8),
      ref: [side * w * 0.97, h * 0.99],
      toward: 'back',
      angle: Math.PI,
      offset: tau,
      half: side,
    });
  }
  for (const side of [1, -1] as const) {
    const dir: V2 = [side * s, -c];
    defs.push({
      group: 'edges',
      a: along(dir, 0.25 * bLen),
      b: along(dir, 0.7 * bLen),
      ref: [side * w * 0.98, h - w - 0.02 * h],
      toward: 'back',
      angle: Math.PI,
      offset: 3 * tau,
      half: side,
    });
  }
  defs.push({
    group: 'keel',
    a: [0, 0.2 * h],
    b: [0, -0.7 * h],
    ref: [-0.5 * w, -0.95 * h],
    toward: 'back',
    angle: (170 * Math.PI) / 180,
    offset: 8 * tau,
  });
  for (const side of [1, -1] as const) {
    defs.push({
      group: 'wings',
      a: along([side * wingDir[0], wingDir[1]], 0.35),
      b: along([side * wingDir[0], wingDir[1]], 0.95),
      ref: [side * (0.95 * k + xB) / 2, -0.9 * h],
      toward: 'front',
      angle: (84 * Math.PI) / 180,
      offset: 0,
      half: side,
    });
  }
  return defs;
}

/** Find the least-folded facet containing flat point p (the stationary layer). */
function hostFacet(facets: WorkFacet[], p: V2): WorkFacet {
  let best: WorkFacet | null = null;
  for (const f of facets) {
    if (!containsConvex(f.poly, p, 1e-6)) continue;
    if (best === null || f.moves.length < best.moves.length) best = f;
  }
  if (best === null) throw new Error(`dart: no facet contains (${p[0]}, ${p[1]})`);
  return best;
}

/**
 * Build the dart for a sheet of half-width `w`, half-height `h` (nose at +y).
 * `thickness` is the paper layer spacing used to stack flat folds.
 */
export function buildDart(w: number, h: number, thickness = 0.004): DartModel {
  if (!(w > 0 && h > 0) || w > 2 * h) throw new Error('dart: need 0 < w <= 2h');
  let facets: WorkFacet[] = [
    { poly: [[-w, -h], [w, -h], [w, h], [-w, h]], moves: [], r: [...IDENTITY_R], t: [0, 0, 0] },
  ];
  const folds: DartFold[] = [];
  const defs = dartFoldDefs(w, h, thickness);

  defs.forEach((def, k) => {
    const host = hostFacet(facets, def.a);
    const A = toCurrent(host, def.a);
    const B = toCurrent(host, def.b);
    const axis = norm3(sub3(B, A));
    const n = norm3(applyR(host.r, [0, 0, 1]));
    const cut = norm3(cross3(axis, n));
    const refHost = hostFacet(facets, def.ref);
    const refSide = Math.sign(dot3(cut, sub3(toCurrent(refHost, def.ref), A))) || 1;
    const u = scale3(cut, refSide); // in-plane direction toward the moving side
    const desired = def.toward === 'back' ? scale3(n, -1) : n;
    const sign = dot3(cross3(axis, u), desired) >= 0 ? 1 : -1;
    const angle = sign * def.angle;
    const point = add3(A, scale3(desired, def.offset));
    folds.push({ group: def.group, point, axis, angle });

    const rot = rotationMatrix(axis, angle);
    const next: WorkFacet[] = [];
    for (const f of facets) {
      // Signed distance to the cut plane, pulled back into this facet's flat coords.
      const d = (p: V2) => refSide * dot3(cut, sub3(toCurrent(f, p), A));
      const movingPoly = clipHalf(f.poly, d, 1);
      const stayPoly = clipHalf(f.poly, d, -1);
      const movingArea = movingPoly.length >= 3 ? polygonArea(movingPoly) : 0;
      const stayArea = stayPoly.length >= 3 ? polygonArea(stayPoly) : 0;
      const allowed =
        def.half === undefined || movingArea <= AREA_EPS || Math.sign(centroid(movingPoly)[0]) === def.half;
      if (!allowed || movingArea <= AREA_EPS) {
        next.push(f);
        continue;
      }
      const moved: WorkFacet = {
        poly: movingPoly,
        moves: [...f.moves, k],
        r: mulR(rot, f.r),
        t: add3(applyR(rot, sub3(f.t, point)), point),
      };
      if (stayArea > AREA_EPS) next.push({ ...f, poly: stayPoly });
      next.push(moved);
    }
    facets = next;
  });

  // Triangulate (fan — every facet is convex).
  const flat: number[] = [];
  const uv: number[] = [];
  const carriedLists: number[][] = folds.map(() => []);
  let vi = 0;
  for (const f of facets) {
    for (let i = 1; i < f.poly.length - 1; i++) {
      for (const p of [f.poly[0], f.poly[i], f.poly[i + 1]]) {
        flat.push(p[0], p[1], 0);
        uv.push((p[0] + w) / (2 * w), (p[1] + h) / (2 * h));
        for (const k of f.moves) carriedLists[k].push(vi);
        vi++;
      }
    }
  }

  return {
    w,
    h,
    facets: facets.map((f) => ({ poly: f.poly, moves: f.moves })),
    folds,
    flat: new Float32Array(flat),
    uv: new Float32Array(uv),
    carried: carriedLists.map((l) => Uint32Array.from(l)),
    creases: creaseSegments(facets, w, h),
  };
}

function creaseSegments(facets: readonly { poly: V2[] }[], w: number, h: number): [V2, V2][] {
  const onBoundary = (p: V2, q: V2) => {
    const e = 1e-6;
    return (
      (Math.abs(p[0] - w) < e && Math.abs(q[0] - w) < e) ||
      (Math.abs(p[0] + w) < e && Math.abs(q[0] + w) < e) ||
      (Math.abs(p[1] - h) < e && Math.abs(q[1] - h) < e) ||
      (Math.abs(p[1] + h) < e && Math.abs(q[1] + h) < e)
    );
  };
  const seen = new Set<string>();
  const out: [V2, V2][] = [];
  const key = (p: V2) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
  for (const f of facets) {
    for (let i = 0; i < f.poly.length; i++) {
      const p = f.poly[i];
      const q = f.poly[(i + 1) % f.poly.length];
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-4 || onBoundary(p, q)) continue;
      const kp = key(p);
      const kq = key(q);
      const id = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push([p, q]);
    }
  }
  return out;
}

/**
 * Pose the dart: write positions for `amounts` (0 = flat, 1 = folded; any
 * finite value, so a wing flutter may nudge past 1) into `out` (same length as
 * model.flat). Allocation-free apart from the per-fold rotation constants.
 */
export function poseDart(model: DartModel, amounts: Readonly<FoldAmounts>, out: Float32Array): void {
  out.set(model.flat);
  model.folds.forEach((fold, k) => {
    const a = amounts[fold.group];
    if (!Number.isFinite(a) || a === 0) return;
    const r = rotationMatrix(fold.axis, fold.angle * a);
    const [ox, oy, oz] = fold.point;
    const idx = model.carried[k];
    for (let i = 0; i < idx.length; i++) {
      const j = idx[i] * 3;
      const x = out[j] - ox;
      const y = out[j + 1] - oy;
      const z = out[j + 2] - oz;
      out[j] = r[0] * x + r[1] * y + r[2] * z + ox;
      out[j + 1] = r[3] * x + r[4] * y + r[5] * z + oy;
      out[j + 2] = r[6] * x + r[7] * y + r[8] * z + oz;
    }
  });
}

/** The folded dart's own frame (model space): nose direction, lift-up direction, and their cross. */
export function dartFrame(model: DartModel): { forward: V3; up: V3; side: V3 } {
  // Up = the bisector of the fuselage V: the right keel's in-plane "up" (+x)
  // and the left keel's (−x carried through the keel fold).
  const forward: V3 = [0, 1, 0];
  const keel = model.folds.find((f) => f.group === 'keel');
  const left = keel ? rotateAbout([-1, 0, 0], [0, 0, 0], keel.axis, keel.angle) : ([1, 0, 0] as V3);
  const up = norm3([1 + left[0], 0, left[2]], [1, 0, 0]);
  const side = norm3(cross3(up, forward));
  return { forward, up, side };
}

/* ── Unfold schedule ───────────────────────────────────────────────────── */

export interface Span {
  start: number;
  end: number;
}

export interface AirplaneTimeline {
  /** Seconds the catch flight lasts (swoop + loop + settle). */
  flight: number;
  /** Light racing along the creases (front position 0..1 from the nose). */
  pulse: Span;
  /** Fold groups open in REVERSE fold order. */
  unfold: Record<FoldGroup, Span>;
  /** Sheet turns from its flight attitude to face the viewer. */
  face: Span;
  /** Warm light blooming out of the opening creases (rise to peak to fade). */
  bloom: { start: number; peak: number; end: number };
  /** Camera eases in until the sheet fills the frame; the true-colour card fades over the paper. */
  dolly: Span;
  print: Span;
  /** onDone. */
  done: number;
}

export function airplaneTimeline(reducedMotion: boolean): AirplaneTimeline {
  if (reducedMotion) {
    // No loop, a slower glide; the unfold still happens, a touch calmer.
    return {
      flight: 2.0,
      pulse: { start: 1.6, end: 2.5 },
      unfold: {
        wings: { start: 2.3, end: 2.9 },
        keel: { start: 2.7, end: 3.4 },
        edges: { start: 3.3, end: 3.95 },
        corners: { start: 3.95, end: 4.6 },
      },
      face: { start: 2.4, end: 4.5 },
      bloom: { start: 2.8, peak: 4.2, end: 5.2 },
      dolly: { start: 4.3, end: 5.5 },
      print: { start: 4.9, end: 5.5 },
      done: 5.6,
    };
  }
  return {
    flight: 3.0,
    pulse: { start: 2.45, end: 3.25 },
    unfold: {
      wings: { start: 3.05, end: 3.5 },
      keel: { start: 3.3, end: 3.9 },
      edges: { start: 3.8, end: 4.3 },
      corners: { start: 4.3, end: 4.85 },
    },
    face: { start: 3.1, end: 4.7 },
    bloom: { start: 3.3, peak: 4.35, end: 5.2 },
    dolly: { start: 4.4, end: 5.5 },
    print: { start: 4.95, end: 5.5 },
    done: 5.6,
  };
}

/** True when overlapping groups are only ones whose hinges are independent
 *  (see the file header): edges start after the wings are open, corners after the edges. */
export function foldScheduleIsSafe(tl: AirplaneTimeline): boolean {
  const u = tl.unfold;
  return u.edges.start >= u.wings.end && u.corners.start >= u.edges.end && u.keel.start >= u.wings.start;
}

/** Fold amounts (1 folded → 0 open) at `t` seconds after the tap. */
export function foldAmountsAt(tl: AirplaneTimeline, t: number): FoldAmounts {
  const out = { corners: 1, edges: 1, keel: 1, wings: 1 } as FoldAmounts;
  for (const g of FOLD_GROUPS) {
    const s = tl.unfold[g];
    out[g] = 1 - window01(t, s.start, s.end, easeInOutCubic);
  }
  return out;
}

/** 0 → 1 → 0 bloom envelope. */
export function bloomAt(tl: AirplaneTimeline, t: number): number {
  const b = tl.bloom;
  if (t <= b.start || t >= b.end) return 0;
  if (t <= b.peak) return easeInOutSine((t - b.start) / (b.peak - b.start));
  return 1 - easeInOutSine((t - b.peak) / (b.end - b.peak));
}

/* ── Flight ────────────────────────────────────────────────────────────── */

export interface FigureEight {
  center: V3;
  /** Half-extents of the eight. */
  ax: number;
  ay: number;
  az: number;
  /** Seconds per full eight. */
  period: number;
}

/** Lemniscate of Gerono, leaning in depth so the plane comes toward and away from the viewer. */
export function figureEight(f: FigureEight, t: number): V3 {
  const w = (2 * Math.PI) / f.period;
  const s = Math.sin(w * t);
  return [
    f.center[0] + f.ax * s,
    f.center[1] + f.ay * Math.sin(2 * w * t) * 0.5 + f.ay * 0.18 * Math.sin(w * t * 0.5),
    f.center[2] + f.az * Math.cos(w * t),
  ];
}

export interface Kinematics {
  pos: V3;
  vel: V3;
  acc: V3;
}

/** Position, velocity and acceleration of any path by central differences. */
export function kinematics(path: (t: number) => V3, t: number, dt = 1 / 120): Kinematics {
  const p0 = path(t - dt);
  const p1 = path(t);
  const p2 = path(t + dt);
  return {
    pos: p1,
    vel: scale3(sub3(p2, p0), 1 / (2 * dt)),
    acc: scale3(add3(sub3(p2, p1), sub3(p0, p1)), 1 / (dt * dt)),
  };
}

/**
 * The plane's attitude from its motion: forward along velocity, up along the
 * APPARENT LIFT (acceleration + gravity) made perpendicular to forward. Returns
 * null when the plane is (nearly) stopped — callers hold the last attitude.
 */
export function flightAttitude(vel: V3, acc: V3, gravity = 9.8): { forward: V3; up: V3 } | null {
  const speed = len3(vel);
  if (!(speed > 1e-3)) return null;
  const forward = scale3(vel, 1 / speed);
  const lift = add3(acc, [0, gravity, 0]);
  const perp = sub3(lift, scale3(forward, dot3(lift, forward)));
  let up = norm3(perp, [0, 1, 0]);
  if (len3(perp) < 1e-6) {
    // Lift parallel to motion (a vertical dive): any up ⟂ forward will do.
    const alt: V3 = Math.abs(forward[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
    up = norm3(sub3(alt, scale3(forward, dot3(alt, forward))));
  }
  return { forward, up };
}

/** Centripetal Catmull-Rom through points[1..n-2] (first and last are phantoms). */
function catmullRom(p0: V3, p1: V3, p2: V3, p3: V3, t: number): V3 {
  const alpha = 0.5;
  const tj = (a: V3, b: V3, ti: number) => ti + Math.max(1e-4, Math.pow(len3(sub3(b, a)), alpha));
  const t0 = 0;
  const t1 = tj(p0, p1, t0);
  const t2 = tj(p1, p2, t1);
  const t3 = tj(p2, p3, t2);
  const tt = t1 + (t2 - t1) * t;
  const A1 = add3(scale3(p0, (t1 - tt) / (t1 - t0)), scale3(p1, (tt - t0) / (t1 - t0)));
  const A2 = add3(scale3(p1, (t2 - tt) / (t2 - t1)), scale3(p2, (tt - t1) / (t2 - t1)));
  const A3 = add3(scale3(p2, (t3 - tt) / (t3 - t2)), scale3(p3, (tt - t2) / (t3 - t2)));
  const B1 = add3(scale3(A1, (t2 - tt) / (t2 - t0)), scale3(A2, (tt - t0) / (t2 - t0)));
  const B2 = add3(scale3(A2, (t3 - tt) / (t3 - t1)), scale3(A3, (tt - t1) / (t3 - t1)));
  return add3(scale3(B1, (t2 - tt) / (t2 - t1)), scale3(B2, (tt - t1) / (t2 - t1)));
}

export interface CatchPathInput {
  start: V3;
  /** Idle velocity at the moment of the tap (world units / s). */
  startVel: V3;
  /** Where the plane comes to rest, in front of the camera. */
  settle: V3;
  /** Visible half-width / half-height at the settle depth (to keep moves on screen). */
  hw: number;
  hh: number;
  duration: number;
  /** Reduced motion: a gentle glide straight in, no loop. */
  loop: boolean;
}

export interface CatchPath {
  duration: number;
  at(t: number): V3;
  /** Total arc length (world units). */
  length: number;
}

const ARC_SAMPLES = 400;

/** Swoop toward the viewer, one loop, then settle at `settle` with zero speed. */
export function catchPath(input: CatchPathInput): CatchPath {
  const { start, settle, hw, hh, loop } = input;
  const speed0 = len3(input.startVel);
  const dir0 = norm3(input.startVel, [1, 0, 0]);
  const pts: V3[] = [];
  const lead = Math.max(0.6, speed0 * 0.35);
  pts.push(sub3(start, scale3(dir0, lead))); // phantom: matches the idle heading
  pts.push(start);
  pts.push(add3(start, scale3(dir0, lead))); // carry on the idle heading before turning in
  // Visible extents scale with depth; hw/hh were measured at the settle depth.
  const settleDepth = Math.max(0.5, -settle[2]);
  const extAt = (depth: number) => ({ hw: (hw * depth) / settleDepth, hh: (hh * depth) / settleDepth });
  if (loop) {
    // A big loop TOWARD the viewer: in from the distance, dip, climb at the
    // camera, over the top inverted (moving away), down the far side, out of
    // the bottom heading back in. The loop's plane is turned 35° about the
    // vertical so it reads as a loop rather than an up-and-down on a phone.
    const depth = settleDepth + 6;
    const ext = extAt(depth);
    const ry = Math.min(ext.hh * 0.42, ext.hw * 1.1);
    const rz = ry;
    const tilt = (35 * Math.PI) / 180;
    const C: V3 = [settle[0] + ext.hw * 0.05, settle[1] + ext.hh * 0.06, -depth];
    const loopAt = (th: number): V3 => [
      C[0] + rz * Math.sin(th) * Math.sin(tilt),
      C[1] - ry * Math.cos(th),
      C[2] + rz * Math.sin(th) * Math.cos(tilt),
    ];
    const inDir: V3 = [Math.sin(tilt), 0, Math.cos(tilt)];
    const bottom = loopAt(0);
    pts.push(add3(bottom, scale3(inDir, -rz * 1.6)));
    const steps = 10;
    for (let i = 0; i <= steps; i++) pts.push(loopAt((i / steps) * Math.PI * 2));
    pts.push(add3(bottom, scale3(inDir, rz * 0.9)));
    const near = extAt(settleDepth + 1.4);
    pts.push([settle[0] - near.hw * 0.45, settle[1] - near.hh * 0.28, settle[2] - 1.4]);
  } else {
    const near = extAt(settleDepth + 2.2);
    pts.push(lerp3(start, [settle[0] - near.hw * 0.4, settle[1] - near.hh * 0.1, settle[2] - 2.2], 0.6));
    pts.push([settle[0] - near.hw * 0.3, settle[1] - near.hh * 0.12, settle[2] - 1.1]);
  }
  pts.push(settle);
  // Phantom after the end: continue drifting right and slightly toward the viewer.
  pts.push(add3(settle, [hw * 0.3, hh * 0.05, 0.25]));

  const segs = pts.length - 3;
  const raw = (u: number): V3 => {
    const x = clamp01(u) * segs;
    const i = Math.min(segs - 1, Math.floor(x));
    return catmullRom(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], x - i);
  };
  // Arc-length table.
  const us = new Float64Array(ARC_SAMPLES + 1);
  const ss = new Float64Array(ARC_SAMPLES + 1);
  let prev = raw(0);
  for (let i = 1; i <= ARC_SAMPLES; i++) {
    const u = i / ARC_SAMPLES;
    const p = raw(u);
    us[i] = u;
    ss[i] = ss[i - 1] + len3(sub3(p, prev));
    prev = p;
  }
  const L = ss[ARC_SAMPLES];
  const uAtS = (s: number): number => {
    if (s <= 0) return 0;
    if (s >= L) return 1;
    let lo = 0;
    let hi = ARC_SAMPLES;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ss[mid] < s) lo = mid;
      else hi = mid;
    }
    const f = (s - ss[lo]) / Math.max(1e-12, ss[hi] - ss[lo]);
    return us[lo] + (us[hi] - us[lo]) * f;
  };
  const T = Math.max(0.1, input.duration);
  // Speed profile over normalised time u: from the idle speed up to an even
  // cruise (so the loop is graceful, not a whip), then easing to rest over
  // the last ~45%. s(u) = ∫shape / ∫shape — monotone, zero speed at the end.
  const N = 256;
  const cum = new Float64Array(N + 1);
  const smooth = (a: number, b: number, x: number) => {
    const k = clamp01((x - a) / (b - a));
    return k * k * (3 - 2 * k);
  };
  const build = (v0n: number) => {
    const shape = (u: number) => (v0n + (1 - v0n) * smooth(0, 0.14, u)) * (1 - smooth(0.55, 1, u));
    cum[0] = 0;
    for (let i = 1; i <= N; i++) cum[i] = cum[i - 1] + (shape((i - 0.5) / N) / N);
    return cum[N];
  };
  let v0n = 0.3;
  for (let pass = 0; pass < 3; pass++) {
    const mean = build(v0n);
    const cruise = L / (T * Math.max(1e-6, mean));
    v0n = Math.min(1, Math.max(0.05, speed0 / Math.max(1e-6, cruise)));
  }
  const total = build(v0n);
  const sOfT = (t: number): number => {
    const x = clamp01(t / T) * N;
    const i = Math.min(N - 1, Math.floor(x));
    const f = cum[i] + (cum[i + 1] - cum[i]) * (x - i);
    return (L * f) / Math.max(1e-12, total);
  };
  return {
    duration: T,
    length: L,
    at: (t: number) => raw(uAtS(sOfT(t))),
  };
}

/* ── Paper relief: height → normal map ─────────────────────────────────── */

/**
 * Sobel a single-channel height field (0..255, row-major w×h, read from the R
 * channel of RGBA data) into an RGBA tangent-space normal map. `strength`
 * scales the slopes. Edges clamp.
 */
export function heightToNormal(rgba: Uint8ClampedArray, w: number, h: number, strength = 2): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  const H = (x: number, y: number) => {
    const xx = x < 0 ? 0 : x >= w ? w - 1 : x;
    const yy = y < 0 ? 0 : y >= h ? h - 1 : y;
    return rgba[(yy * w + xx) * 4] / 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx =
        H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x - 1, y) - H(x - 1, y + 1);
      const dy =
        H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x, y - 1) - H(x + 1, y - 1);
      // Canvas rows run top→bottom while texture v runs bottom→top: flip dy.
      let nx = -dx * strength;
      let ny = dy * strength;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * w + x) * 4;
      out[i] = Math.round((nx * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      out[i + 3] = 255;
    }
  }
  return out;
}
