/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Procedural paper-cut geometry for theme-pack backdrops: palm fronds, palm
 * trunks, torn banana leaves, petals and scalloped waves, each returned as an
 * SVG path string. Deterministic (no Math.random) so a backdrop renders the
 * same on the welcome page, the wall and the host's thumbnail, and so the
 * shapes are unit-tested for finite, closed output.
 *
 * Shapes are built from straight cuts on purpose: a pair of scissors does
 * not draw béziers, and the angular edges are what read as paper.
 *
 * PURE: no React, no DOM.
 */

export type Pt = readonly [number, number];

const r1 = (n: number) => Math.round(n * 10) / 10;
const pt = (p: Pt) => `${r1(p[0])},${r1(p[1])}`;

/** Closed polygon path from points. */
export function polygon(points: readonly Pt[]): string {
  if (points.length === 0) return '';
  return `M${points.map(pt).join('L')}Z`;
}

/** A quadratic spine: point and unit normal at t ∈ [0, 1]. */
export function spine(p0: Pt, p1: Pt, p2: Pt) {
  const at = (t: number): Pt => {
    const u = 1 - t;
    return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
  };
  const normal = (t: number): Pt => {
    const dx = 2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
    const dy = 2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
    const len = Math.hypot(dx, dy) || 1;
    return [-dy / len, dx / len];
  };
  return { at, normal };
}

const deg = (a: number) => (a * Math.PI) / 180;

/**
 * A pinnate palm frond cut as one piece: a drooping spine with leaflets
 * swept toward the tip on both sides (a zig-zag outline).
 *
 * @param origin  where the frond leaves the crown
 * @param angle   direction in degrees (SVG: 0 = right, -90 = up)
 * @param len     spine length
 * @param droop   how far the tip falls (positive = down)
 * @param width   longest leaflet
 * @param n       leaflets per side
 */
export function palmFrond(origin: Pt, angle: number, len: number, droop: number, width: number, n = 12): string {
  const dir: Pt = [Math.cos(deg(angle)), Math.sin(deg(angle))];
  const tip: Pt = [origin[0] + dir[0] * len, origin[1] + dir[1] * len + droop];
  const ctrl: Pt = [origin[0] + dir[0] * len * 0.55, origin[1] + dir[1] * len * 0.55 - droop * 0.25];
  const s = spine(origin, ctrl, tip);
  const side = (sign: 1 | -1): Pt[] => {
    const out: Pt[] = [];
    for (let i = 1; i <= n; i++) {
      const t = (i / (n + 1)) * 0.94;
      const t2 = Math.min(t + 0.09, 0.99);
      const w = width * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.8) * (1 - 0.25 * t);
      const base = s.at(t);
      const nb = s.normal(t);
      const head = s.at(t2);
      const nh = s.normal(t2);
      out.push([base[0] + nb[0] * sign * width * 0.05, base[1] + nb[1] * sign * width * 0.05]);
      out.push([head[0] + nh[0] * sign * w, head[1] + nh[1] * sign * w]);
    }
    return out;
  };
  const upper = side(1);
  const lower = side(-1).reverse();
  return polygon([origin, ...upper, tip, ...lower]);
}

/** A tapering, gently curved trunk from `base` to `crown`, plus the ring
 *  cuts across it (returned separately so they can take a darker paper). */
export function palmTrunk(base: Pt, crown: Pt, bend: number, wBase: number, wTop: number, rings = 14) {
  const mid: Pt = [(base[0] + crown[0]) / 2 + bend, (base[1] + crown[1]) / 2];
  const s = spine(base, mid, crown);
  const steps = 18;
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = s.at(t);
    const nrm = s.normal(t);
    const w = (wBase + (wTop - wBase) * t) / 2;
    left.push([p[0] + nrm[0] * w, p[1] + nrm[1] * w]);
    right.push([p[0] - nrm[0] * w, p[1] - nrm[1] * w]);
  }
  const outline = polygon([...left, ...right.reverse()]);
  const ringPaths: string[] = [];
  for (let i = 1; i < rings; i++) {
    const t = i / rings;
    const p = s.at(t);
    const nrm = s.normal(t);
    const w = (wBase + (wTop - wBase) * t) / 2;
    const a: Pt = [p[0] + nrm[0] * w * 0.92, p[1] + nrm[1] * w * 0.92];
    const b: Pt = [p[0] - nrm[0] * w * 0.92, p[1] - nrm[1] * w * 0.92];
    // A shallow chevron, like the overlapping leaf scars of a real trunk.
    const c: Pt = [p[0] + (crown[0] - base[0]) * 0.012, p[1] + (crown[1] - base[1]) * 0.012 + 3];
    ringPaths.push(`M${pt(a)}L${pt(c)}L${pt(b)}`);
  }
  return { outline, rings: ringPaths.join('') };
}

/**
 * A banana / tropical leaf torn into strips: each side is a run of separate
 * quads with thin gaps between them (the tears), so the backdrop shows
 * through like real cut paper. Returns one path of many closed pieces.
 */
export function tornLeaf(origin: Pt, angle: number, len: number, droop: number, width: number, strips = 9): string {
  const dir: Pt = [Math.cos(deg(angle)), Math.sin(deg(angle))];
  const tip: Pt = [origin[0] + dir[0] * len, origin[1] + dir[1] * len + droop];
  const ctrl: Pt = [origin[0] + dir[0] * len * 0.5, origin[1] + dir[1] * len * 0.5 - droop * 0.2];
  const s = spine(origin, ctrl, tip);
  const halfW = (t: number) => width * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95)), 0.7);
  const pieces: string[] = [];
  const gap = 0.012;
  for (const sign of [1, -1] as const) {
    for (let i = 0; i < strips; i++) {
      const a = 0.04 + (i / strips) * 0.92;
      const b = 0.04 + ((i + 1) / strips) * 0.92 - gap;
      // The outer edge runs a little further toward the tip than the rib:
      // the tears sweep back, like a wind-torn banana leaf.
      const a2 = Math.min(a + 0.05, 0.99);
      const b2 = Math.min(b + 0.05, 0.99);
      const pa = s.at(a); const pb = s.at(b);
      const qa = s.at(a2); const qb = s.at(b2);
      const na = s.normal(a2); const nb = s.normal(b2);
      const rib = 0.03 * width;
      const ra = s.normal(a); const rb = s.normal(b);
      pieces.push(polygon([
        [pa[0] + ra[0] * sign * rib, pa[1] + ra[1] * sign * rib],
        [pb[0] + rb[0] * sign * rib, pb[1] + rb[1] * sign * rib],
        [qb[0] + nb[0] * sign * halfW(b2), qb[1] + nb[1] * sign * halfW(b2)],
        [qa[0] + na[0] * sign * halfW(a2), qa[1] + na[1] * sign * halfW(a2)],
      ]));
    }
  }
  return pieces.join('');
}

/** A smooth leaf (hibiscus / frangipani greens): pointed oval along a spine. */
export function leaf(origin: Pt, angle: number, len: number, width: number): string {
  const d: Pt = [Math.cos(deg(angle)), Math.sin(deg(angle))];
  const n: Pt = [-d[1], d[0]];
  const tip: Pt = [origin[0] + d[0] * len, origin[1] + d[1] * len];
  const c1 = (k: number, w: number): Pt => [origin[0] + d[0] * len * k + n[0] * w, origin[1] + d[1] * len * k + n[1] * w];
  return `M${pt(origin)}C${pt(c1(0.25, width))} ${pt(c1(0.75, width * 0.9))} ${pt(tip)}C${pt(c1(0.75, -width * 0.9))} ${pt(c1(0.25, -width))} ${pt(origin)}Z`;
}

/** A scalloped wave band: crests of `period` across `width`, filled down to
 *  `height`. `phase` shifts the crests so stacked bands do not line up. */
export function waveBand(width: number, height: number, y: number, amp: number, period: number, phase = 0): string {
  const parts: string[] = [`M0,${height}L0,${r1(y)}`];
  const start = -((phase % 1) * period);
  let x = start;
  parts.push(`L${r1(Math.max(0, x))},${r1(y)}`);
  while (x < width) {
    const mid = x + period / 2;
    const end = x + period;
    // A crest that leans forward, like a wave about to curl.
    parts.push(`C${r1(x + period * 0.18)},${r1(y - amp * 1.15)} ${r1(mid + period * 0.12)},${r1(y - amp * 1.1)} ${r1(mid + period * 0.22)},${r1(y - amp * 0.35)}`);
    parts.push(`Q${r1(end - period * 0.1)},${r1(y + amp * 0.18)} ${r1(end)},${r1(y)}`);
    x = end;
  }
  parts.push(`L${r1(width)},${height}Z`);
  return parts.join('');
}
