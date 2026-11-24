/**
 * World mode, part 3: a 2D event frame becomes a solid standing board.
 *
 * The frame art (a transparent PNG/WebP) is printed on the front of a board
 * whose OUTLINE is the art's own silhouette, so the board has real thickness
 * exactly where the art is solid (lettering, borders, photos) and nothing where
 * the art is see-through. This builds the board's side walls: marching squares
 * over the alpha channel, one wall quad per contour segment, coloured from the
 * art just inside the edge. The front and back are flat quads drawn with the
 * art itself (WorldStage), so the print stays pixel-sharp.
 *
 * Pure (typed arrays in, typed arrays out), so it is unit-tested in node.
 */

export interface StandeeGrid {
  /** Grid size in cells; row 0 is the TOP of the picture. */
  w: number;
  h: number;
  /** Alpha 0..1 per cell, w*h. */
  alpha: Float32Array;
  /** RGB 0..1 per cell, 3*w*h (unpremultiplied). */
  rgb: Float32Array;
}

export interface WallOptions {
  /** Board size in metres (the art's full rectangle). */
  width: number;
  height: number;
  /** Board thickness in metres. */
  depth: number;
  /** Alpha at or above this is solid board. */
  threshold?: number;
  /** Edge colour = the art's colour × this (an edge catches less light than a face). */
  edgeShade?: number;
}

export interface WallGeometry {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  /** Number of contour segments (= wall quads). */
  segments: number;
}

/** Alpha at grid point (i, j); outside the grid is empty (so the outer edge gets a wall too). */
function alphaAt(g: StandeeGrid, i: number, j: number): number {
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return 0;
  return g.alpha[j * g.w + i];
}

/** Bilinear alpha at fractional grid coordinates. */
function alphaBilinear(g: StandeeGrid, x: number, y: number): number {
  const i = Math.floor(x), j = Math.floor(y);
  const fx = x - i, fy = y - j;
  const a = alphaAt(g, i, j), b = alphaAt(g, i + 1, j);
  const c = alphaAt(g, i, j + 1), d = alphaAt(g, i + 1, j + 1);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

function rgbNear(g: StandeeGrid, x: number, y: number, out: number[]): void {
  const i = Math.min(g.w - 1, Math.max(0, Math.round(x)));
  const j = Math.min(g.h - 1, Math.max(0, Math.round(y)));
  const k = (j * g.w + i) * 3;
  out[0] = g.rgb[k]; out[1] = g.rgb[k + 1]; out[2] = g.rgb[k + 2];
}

/** Contour segments in GRID coordinates: [x0, y0, x1, y1, ...]. */
export function contourSegments(g: StandeeGrid, threshold = 0.5): number[] {
  const segs: number[] = [];
  const cross = (xa: number, ya: number, va: number, xb: number, yb: number, vb: number): [number, number] => {
    const t = vb === va ? 0.5 : (threshold - va) / (vb - va);
    return [xa + (xb - xa) * t, ya + (yb - ya) * t];
  };
  for (let j = -1; j < g.h; j++) {
    for (let i = -1; i < g.w; i++) {
      const v0 = alphaAt(g, i, j), v1 = alphaAt(g, i + 1, j);
      const v2 = alphaAt(g, i + 1, j + 1), v3 = alphaAt(g, i, j + 1);
      const in0 = v0 >= threshold, in1 = v1 >= threshold, in2 = v2 >= threshold, in3 = v3 >= threshold;
      if (in0 === in1 && in1 === in2 && in2 === in3) continue;
      // Crossings per edge: 0 top (p0-p1), 1 right (p1-p2), 2 bottom (p2-p3), 3 left (p3-p0).
      const e: ([number, number] | null)[] = [
        in0 !== in1 ? cross(i, j, v0, i + 1, j, v1) : null,
        in1 !== in2 ? cross(i + 1, j, v1, i + 1, j + 1, v2) : null,
        in2 !== in3 ? cross(i + 1, j + 1, v2, i, j + 1, v3) : null,
        in3 !== in0 ? cross(i, j + 1, v3, i, j, v0) : null,
      ];
      const push = (a: number, b: number) => {
        const pa = e[a]!, pb = e[b]!;
        segs.push(pa[0], pa[1], pb[0], pb[1]);
      };
      const hits = e.reduce((n, p) => n + (p ? 1 : 0), 0);
      if (hits === 2) {
        const idx = e.map((p, k) => (p ? k : -1)).filter((k) => k >= 0);
        push(idx[0], idx[1]);
      } else if (hits === 4) {
        // Saddle: the cell centre decides which corners are joined.
        const centreIn = (v0 + v1 + v2 + v3) / 4 >= threshold;
        if (in0 && in2) {
          if (centreIn) { push(0, 1); push(2, 3); } else { push(3, 0); push(1, 2); }
        } else if (centreIn) { push(3, 0); push(1, 2); } else { push(0, 1); push(2, 3); }
      }
    }
  }
  return segs;
}

/** Side walls of the board, as non-indexed triangles in metres.
 *  x: -width/2..width/2, y: 0 (bottom)..height, z: -depth/2 (back)..+depth/2 (front). */
export function buildStandeeWalls(g: StandeeGrid, opts: WallOptions): WallGeometry {
  const threshold = opts.threshold ?? 0.5;
  const shade = opts.edgeShade ?? 0.78;
  const segs = contourSegments(g, threshold);
  const n = segs.length / 4;
  const positions = new Float32Array(n * 18);
  const normals = new Float32Array(n * 18);
  const colors = new Float32Array(n * 18);
  // Grid point (i, j) is a cell CENTRE: x = (i + 0.5) / w * width - width / 2.
  const sx = opts.width / g.w, sy = opts.height / g.h;
  const toX = (gx: number) => (gx + 0.5) * sx - opts.width / 2;
  const toY = (gy: number) => opts.height - (gy + 0.5) * sy;
  const zf = opts.depth / 2, zb = -opts.depth / 2;
  const rgb = [0, 0, 0];
  let o = 0;
  for (let s = 0; s < n; s++) {
    const gx0 = segs[s * 4], gy0 = segs[s * 4 + 1], gx1 = segs[s * 4 + 2], gy1 = segs[s * 4 + 3];
    const x0 = toX(gx0), y0 = toY(gy0), x1 = toX(gx1), y1 = toY(gy1);
    // Outward normal: the side of the segment where the art is see-through.
    let nx = y1 - y0, ny = -(x1 - x0);
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;
    const mx = (gx0 + gx1) / 2, my = (gy0 + gy1) / 2;
    // World normal (nx, ny) in grid units: grid y points DOWN, so flip ny.
    const probe = 0.35;
    const outside = alphaBilinear(g, mx + nx * probe, my - ny * probe);
    const inside = alphaBilinear(g, mx - nx * probe, my + ny * probe);
    if (outside > inside) { nx = -nx; ny = -ny; }
    rgbNear(g, mx - nx * 0.8, my + ny * 0.8, rgb);
    const r = rgb[0] * shade, gg = rgb[1] * shade, b = rgb[2] * shade;
    // Quad (x0,y0)-(x1,y1) swept from front to back; wind it so it faces along the normal.
    const ax = x1 - x0, ay = y1 - y0;
    // Triangle (front0, front1, back1): edge1 = (ax, ay, 0), edge2 = (0, 0, zb - zf) → cross = (ay*(zb-zf), -ax*(zb-zf), 0)
    const cx = ay * (zb - zf), cy = -ax * (zb - zf);
    const flip = cx * nx + cy * ny < 0;
    const A = [x0, y0, zf], B = [x1, y1, zf], C = [x1, y1, zb], D = [x0, y0, zb];
    const tris = flip ? [A, C, B, A, D, C] : [A, B, C, A, C, D];
    for (const v of tris) {
      positions[o] = v[0]; positions[o + 1] = v[1]; positions[o + 2] = v[2];
      normals[o] = nx; normals[o + 1] = ny; normals[o + 2] = 0;
      colors[o] = r; colors[o + 1] = gg; colors[o + 2] = b;
      o += 3;
    }
  }
  return { positions, normals, colors, segments: n };
}

/**
 * An RGBA image (Uint8ClampedArray from getImageData, `w` × `h`) as a grid of
 * `factor` × `factor` blocks. Each cell takes its block's MOST opaque pixel
 * (alpha and colour), so a 2 px hairline border still becomes solid board
 * instead of dissolving into a dashed outline.
 */
export function gridFromImageData(data: Uint8ClampedArray, w: number, h: number, factor = 1): StandeeGrid {
  const f = Math.max(1, Math.floor(factor));
  const gw = Math.ceil(w / f), gh = Math.ceil(h / f);
  const alpha = new Float32Array(gw * gh);
  const rgb = new Float32Array(gw * gh * 3);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let best = -1, bestK = 0;
      for (let y = gy * f; y < Math.min(h, gy * f + f); y++) {
        for (let x = gx * f; x < Math.min(w, gx * f + f); x++) {
          const k = (y * w + x) * 4;
          if (data[k + 3] > best) { best = data[k + 3]; bestK = k; }
        }
      }
      const c = gy * gw + gx;
      alpha[c] = Math.max(0, best) / 255;
      rgb[c * 3] = data[bestK] / 255;
      rgb[c * 3 + 1] = data[bestK + 1] / 255;
      rgb[c * 3 + 2] = data[bestK + 2] / 255;
    }
  }
  return { w: gw, h: gh, alpha, rgb };
}
