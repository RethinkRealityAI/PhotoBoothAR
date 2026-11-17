/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Facial-feature geometry in TEXTURE space, derived from the mesh's own uvs.
 *
 * Designs are never written in hard-coded uv pixels: every stroke is placed
 * relative to a landmark (cheek, eye corner, brow, mouth corner…), looked up
 * through the uvs of the vertices that share MediaPipe's landmark indices
 * (verified against the captured 8th Wall topology — see faceTopology.ts). If
 * 8th Wall ever ships a different uv layout, the art follows the features.
 *
 * SIDE NAMING: `l`/`r` are the guest's SCREEN left/right, not anatomical. The
 * uv layout puts u≈0 on the subject's right side; FacePaintLayer renders the
 * mesh so that small u lands on the screen's left in BOTH the mirrored selfie
 * preview and an unmirrored camera (see mirrorPairs below) — which is also what
 * makes a logo read the right way round in both.
 */

export interface Pt { x: number; y: number }

/** MediaPipe landmark indices the designs anchor to. */
export const FACE_LANDMARKS = {
  foreheadTop: 10,
  foreheadMid: 151,
  browMid: 9,
  noseBridge: 168,
  noseTip: 4,
  chin: 152,
  mouthTop: 0,
  mouthBottom: 17,
  mouthL: 61,
  mouthR: 291,
  eyeOuterL: 33,
  eyeOuterR: 263,
  eyeInnerL: 133,
  eyeInnerR: 362,
  eyeTopL: 159,
  eyeTopR: 386,
  eyeBotL: 145,
  eyeBotR: 374,
  browL: 105,
  browR: 334,
  browOuterL: 70,
  browOuterR: 300,
  cheekL: 50,
  cheekR: 280,
  cheekboneL: 123,
  cheekboneR: 352,
  underEyeL: 117,
  underEyeR: 346,
  cheekLowL: 187,
  cheekLowR: 411,
  sideL: 234,
  sideR: 454,
  templeL: 21,
  templeR: 251,
  jawL: 172,
  jawR: 397,
  chinL: 149,
  chinR: 378,
} as const;

export type FaceLandmark = keyof typeof FACE_LANDMARKS;

/** Every anchor point in canvas px, plus derived measures. */
export type FaceFrame = Record<FaceLandmark, Pt> & {
  /** Canvas side in px. */
  size: number;
  /** Distance between the outer eye corners — the unit every design scales by. */
  eyeSpan: number;
};

/** uv → canvas px: x = u·size, y = (1 − v)·size (canvas y grows DOWN, v grows UP). */
export function uvToCanvas(uvs: ArrayLike<number>, index: number, size: number): Pt {
  return { x: uvs[index * 2] * size, y: (1 - uvs[index * 2 + 1]) * size };
}

export function faceFrameFromUvs(uvs: ArrayLike<number>, size: number): FaceFrame {
  const out: Partial<FaceFrame> = { size };
  for (const [name, idx] of Object.entries(FACE_LANDMARKS) as [FaceLandmark, number][]) {
    out[name] = uvToCanvas(uvs, idx, size);
  }
  const f = out as FaceFrame;
  f.eyeSpan = Math.hypot(f.eyeOuterR.x - f.eyeOuterL.x, f.eyeOuterR.y - f.eyeOuterL.y);
  return f;
}

export function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Left↔right partner of every vertex, by reflecting its uv about u = 0.5 and
 * taking the nearest REFERENCED vertex. On the captured topology this is an
 * exact involution (worst uv error 0.0022; 28 midline vertices pair with
 * themselves); vertices no triangle uses (the iris points) map to themselves.
 *
 * WHY: the tracked head group renders a mirrored preview as M·P·M (faceRig
 * reflects the POSE), so local geometry is reflected too. Feeding vertex i the
 * reflected position of its partner undoes that exactly — the paint lands on
 * the guest's real skin (a lopsided smile stretches the right cheek) — while
 * every vertex keeps its own uv, so artwork and lettering still read the right
 * way round on screen and in the saved photo.
 */
export function mirrorPairs(uvs: ArrayLike<number>, indices: ArrayLike<number>, points: number): Int32Array {
  const used = new Uint8Array(points);
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k];
    if (i >= 0 && i < points) used[i] = 1;
  }
  const pair = new Int32Array(points);
  for (let i = 0; i < points; i++) {
    pair[i] = i;
    if (!used[i]) continue;
    const tu = 1 - uvs[i * 2];
    const tv = uvs[i * 2 + 1];
    let best = i;
    let bestD = Infinity;
    for (let j = 0; j < points; j++) {
      if (!used[j]) continue;
      const d = (uvs[j * 2] - tu) ** 2 + (uvs[j * 2 + 1] - tv) ** 2;
      if (d < bestD) { bestD = d; best = j; }
    }
    pair[i] = best;
  }
  return pair;
}

/**
 * Ring distance of every vertex from the mesh's OUTER silhouette (hairline,
 * temples, jaw): 0 on the outer boundary loop, 1 one edge in, … capped at
 * `maxRings`. Unused vertices get `maxRings`.
 *
 * Only the LONGEST boundary loop counts — the eye and mouth holes are
 * boundaries too, and feathering there would fade paint off the eyelids and
 * lips, which is exactly where a full-face design must stay solid. The paint
 * layer fades alpha over these rings, so a tiger mask ends in a soft blend at
 * the hairline instead of on a hard polygon edge.
 */
export function outerRingDistance(indices: ArrayLike<number>, points: number, maxRings = 4): Float32Array {
  const out = new Float32Array(points).fill(maxRings);
  // Boundary edges = edges used by exactly one triangle.
  const edgeCount = new Map<number, number>();
  const key = (a: number, b: number) => (a < b ? a * points + b : b * points + a);
  const adj: number[][] = Array.from({ length: points }, () => []);
  for (let k = 0; k + 2 < indices.length; k += 3) {
    const t = [indices[k], indices[k + 1], indices[k + 2]];
    for (let e = 0; e < 3; e++) {
      const a = t[e], b = t[(e + 1) % 3];
      if (a < 0 || b < 0 || a >= points || b >= points) continue;
      const kk = key(a, b);
      edgeCount.set(kk, (edgeCount.get(kk) ?? 0) + 1);
      adj[a].push(b);
    }
  }
  const bAdj = new Map<number, number[]>();
  for (const [kk, c] of edgeCount) {
    if (c !== 1) continue;
    const a = Math.floor(kk / points), b = kk % points;
    (bAdj.get(a) ?? bAdj.set(a, []).get(a)!).push(b);
    (bAdj.get(b) ?? bAdj.set(b, []).get(b)!).push(a);
  }
  // Connected boundary components; keep the largest.
  const seen = new Set<number>();
  let outer: number[] = [];
  for (const start of bAdj.keys()) {
    if (seen.has(start)) continue;
    const comp: number[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const v = stack.pop()!;
      comp.push(v);
      for (const w of bAdj.get(v) ?? []) if (!seen.has(w)) { seen.add(w); stack.push(w); }
    }
    if (comp.length > outer.length) outer = comp;
  }
  // Breadth-first rings inward over the full (undirected) adjacency.
  for (let v = 0; v < points; v++) for (const w of adj[v]) if (!adj[w].includes(v)) adj[w].push(v);
  let frontier = outer;
  for (const v of frontier) out[v] = 0;
  for (let r = 1; r < maxRings && frontier.length > 0; r++) {
    const next: number[] = [];
    for (const v of frontier) for (const w of adj[v]) if (out[w] > r) { out[w] = r; next.push(w); }
    frontier = next;
  }
  return out;
}

/**
 * Where a point the rig projects to canvas NDC (x,y ∈ [-1,1]) sits in the
 * camera frame's texture uv (v up), under the rig's contract: the pose's 63°
 * vertical fov spans the FULL frame height, so v maps straight across and u
 * scales by canvasAspect / frameAspect. A mirrored preview shows the frame
 * flipped, so u flips with it.
 */
export function frameUvFromNdc(ndcX: number, ndcY: number, canvasAspect: number, frameAspect: number, mirror: boolean): { u: number; v: number } {
  const k = canvasAspect / frameAspect;
  const x = ndcX * k * (mirror ? -1 : 1);
  return { u: 0.5 + 0.5 * x, v: 0.5 + 0.5 * ndcY };
}
