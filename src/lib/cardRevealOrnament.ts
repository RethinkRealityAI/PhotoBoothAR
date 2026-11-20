/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The envelope's LETTERPRESS — procedural filigree for the envelope reveal.
 * ========================================================================
 *
 * The owner's reference (luxury digital invitations) is all embossed relief:
 * floral sprays, curls, beaded seams, scalloped borders, a medallion round the
 * seal. Nothing here is an image: it is pure geometry in stage pixels, drawn
 * ONCE as an SVG (paper grain + an emboss filter) that the browser rasterises
 * a single time and every flap then shows through its own clip-path.
 *
 * Pure and node-testable: deterministic (no randomness — a symmetric design
 * is what reads as "crafted"), absolute coordinates only (circles are four
 * cubic Béziers, never arcs), so a test can bound-check every number.
 *
 * Layout, for a stage `w`×`h` whose four flaps meet at `meet`:
 *   • a scalloped border, a fine rule and a bead row round the edge;
 *   • a medallion (two rings and a sunburst of ticks) round the seal;
 *   • bead rows either side of each seam (corner → meet), so the flaps'
 *     shapes read even before the light starts moving along them;
 *   • a symmetric floral spray on the top flap (pointing down at the seal)
 *     and on the bottom flap (pointing up), each tapering to fit its triangle;
 *   • a curling vine down each side flap.
 */

export interface OrnamentInput {
  w: number;
  h: number;
  meet: { x: number; y: number };
  sealR: number;
}

export interface Ornament {
  /** Stroked linework (stems, curls, leaf outlines, rules, scallops, rings). */
  strokes: string;
  /** Filled marks (beads, berries, petal hearts). */
  fills: string;
  /** The four seams, corner → meet: [x1, y1, x2, y2]. */
  seams: [number, number, number, number][];
  /** Stroke width the art was designed for, px. */
  strokeWidth: number;
}

type Pt = { x: number; y: number };

const r1 = (n: number) => Math.round(n * 10) / 10;
const fmt = (p: Pt) => `${r1(p.x)} ${r1(p.y)}`;

class PathBuilder {
  private readonly parts: string[] = [];
  move(p: Pt) {
    this.parts.push(`M${fmt(p)}`);
  }
  line(p: Pt) {
    this.parts.push(`L${fmt(p)}`);
  }
  quad(c: Pt, p: Pt) {
    this.parts.push(`Q${fmt(c)} ${fmt(p)}`);
  }
  cubic(c1: Pt, c2: Pt, p: Pt) {
    this.parts.push(`C${fmt(c1)} ${fmt(c2)} ${fmt(p)}`);
  }
  close() {
    this.parts.push('Z');
  }
  /** A circle as four cubic Béziers (absolute coordinates only). */
  circle(c: Pt, r: number) {
    const k = 0.5523 * r;
    this.move({ x: c.x + r, y: c.y });
    this.cubic({ x: c.x + r, y: c.y + k }, { x: c.x + k, y: c.y + r }, { x: c.x, y: c.y + r });
    this.cubic({ x: c.x - k, y: c.y + r }, { x: c.x - r, y: c.y + k }, { x: c.x - r, y: c.y });
    this.cubic({ x: c.x - r, y: c.y - k }, { x: c.x - k, y: c.y - r }, { x: c.x, y: c.y - r });
    this.cubic({ x: c.x + k, y: c.y - r }, { x: c.x + r, y: c.y - k }, { x: c.x + r, y: c.y });
    this.close();
  }
  /** A smooth curve through `pts` (quadratic midpoint smoothing). */
  smooth(pts: Pt[]) {
    if (pts.length < 2) return;
    this.move(pts[0]);
    if (pts.length === 2) {
      this.line(pts[1]);
      return;
    }
    for (let i = 1; i < pts.length - 1; i++) {
      const m = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
      this.quad(pts[i], i === pts.length - 2 ? pts[i + 1] : m);
    }
  }
  toString() {
    return this.parts.join('');
  }
}

const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Pt, s: number): Pt => ({ x: a.x * s, y: a.y * s });
const dirOf = (angle: number): Pt => ({ x: Math.cos(angle), y: Math.sin(angle) });

/** An almond leaf outline from `base`, pointing at `angle`. */
function leaf(p: PathBuilder, base: Pt, angle: number, len: number, width: number) {
  const d = dirOf(angle);
  const n = { x: -d.y, y: d.x };
  const tip = add(base, scale(d, len));
  const mid = add(base, scale(d, len * 0.5));
  p.move(base);
  p.quad(add(mid, scale(n, width)), tip);
  p.quad(add(mid, scale(n, -width)), base);
  // midrib
  p.move(add(base, scale(d, len * 0.12)));
  p.line(add(base, scale(d, len * 0.72)));
}

/**
 * A branch that leaves `from` heading `angle`, sweeps `reach` px and winds
 * into a curl (a log spiral) turning `turn` (+1 clockwise on screen, -1 anti).
 */
function curlPoints(from: Pt, angle: number, reach: number, curlR: number, turn: 1 | -1): Pt[] {
  const pts: Pt[] = [];
  const d = dirOf(angle);
  // The sweep: a gentle arc bending toward the curl's side.
  const bend = dirOf(angle + turn * 0.9);
  const end = add(from, scale(d, reach));
  const ctrl = add(add(from, scale(d, reach * 0.55)), scale(bend, reach * 0.18));
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const a = scale(from, (1 - t) * (1 - t));
    const b = scale(ctrl, 2 * (1 - t) * t);
    const c = scale(end, t * t);
    pts.push(add(add(a, b), c));
  }
  // The curl: start tangent to the sweep's end direction.
  const tangent = Math.atan2(end.y - ctrl.y, end.x - ctrl.x);
  const toCentre = tangent + turn * (Math.PI / 2);
  const centre = add(end, scale(dirOf(toCentre), curlR));
  const start = toCentre + Math.PI; // angle of `end` as seen from the centre
  const steps = 14;
  const total = Math.PI * 1.7;
  for (let i = 1; i <= steps; i++) {
    const t = (i / steps) * total;
    const r = curlR * Math.exp(-0.42 * t);
    pts.push(add(centre, scale(dirOf(start + turn * t), r)));
  }
  return pts;
}

/** A rosette: an outer ring of almond petals, a ring, a beaded heart. */
function rosette(s: PathBuilder, f: PathBuilder, c: Pt, r: number, petals: number) {
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2 - Math.PI / 2;
    leaf(s, add(c, scale(dirOf(a), r * 0.42)), a, r * 0.58, r * 0.2);
  }
  s.circle(c, r * 0.36);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    f.circle(add(c, scale(dirOf(a), r * 0.2)), Math.max(0.9, r * 0.055));
  }
  f.circle(c, Math.max(1, r * 0.08));
}

/**
 * A symmetric spray on the vertical axis `cx`, from its base at `y0` (a
 * rosette) to its tip at `y1` (a three-petal fleur). `halfWidthAt(y)` is how
 * much room the flap has either side at that height; every tier fits in it.
 */
function spray(
  s: PathBuilder,
  f: PathBuilder,
  cx: number,
  y0: number,
  y1: number,
  halfWidthAt: (y: number) => number,
  u: number,
) {
  const sign = y1 > y0 ? 1 : -1;
  const len = Math.abs(y1 - y0);
  const rosR = Math.min(halfWidthAt(y0) * 0.3, len * 0.12, 30 * u);
  rosette(s, f, { x: cx, y: y0 }, rosR, 10);
  // Stem with a faint wave so it reads hand-cut, not ruled.
  const stem: Pt[] = [];
  const stemStart = y0 + sign * rosR * 1.05;
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    stem.push({ x: cx + Math.sin(t * Math.PI * 2) * 1.2 * u, y: stemStart + (y1 - stemStart) * t });
  }
  s.smooth(stem);

  const tiers = 5;
  for (let k = 0; k < tiers; k++) {
    const t = 0.16 + 0.74 * (k / (tiers - 1));
    const y = stemStart + (y1 - stemStart) * t;
    const room = Math.max(8, halfWidthAt(y) - 10 * u);
    const taper = 1 - 0.55 * (k / (tiers - 1));
    for (const side of [-1, 1] as const) {
      const at = { x: cx, y };
      // Branch: outward, leaning back toward the base, curling toward the tip.
      const angle = Math.atan2(-sign * 0.38, side);
      const reach = Math.min(room * 0.62, 70 * u * taper);
      const curlR = Math.max(3, Math.min(reach * 0.32, 15 * u * taper));
      const turn: 1 | -1 = side * sign > 0 ? 1 : -1;
      const branch = curlPoints(at, angle, reach, curlR, turn);
      s.smooth(branch);
      // Leaves sprouting along the branch, alternating above and below it
      // (sweep points 0-6 are the branch before it winds into the curl).
      for (const [idx, flip] of [
        [2, 1],
        [4, -1],
      ] as const) {
        const a = branch[idx];
        const b = branch[idx + 1];
        const along = Math.atan2(b.y - a.y, b.x - a.x);
        const la = along + flip * turn * 0.75;
        const ll = Math.min(14 * u * taper, reach * 0.3);
        const tip = add(a, scale(dirOf(la), ll));
        if (Math.abs(tip.x - cx) < halfWidthAt(tip.y) - 4) leaf(s, a, la, ll, ll * 0.3);
      }
      // A small counter-curl near the stem, the flourish that makes a scroll.
      if (k < tiers - 1) {
        const near = branch[1];
        // Heads outward and toward the tip, winding the opposite way.
        s.smooth(curlPoints(near, Math.atan2(sign * 0.9, side * 0.7), reach * 0.22, curlR * 0.5, turn === 1 ? -1 : 1));
      }
      // A leaf pointing outward and toward the tip.
      const leafAngle = Math.atan2(sign * 0.9, side * 1);
      leaf(s, { x: cx + side * 2 * u, y: y + sign * 6 * u }, leafAngle, Math.min(room * 0.5, 24 * u * taper), 6.5 * u * taper);
      // A small back-leaf near the stem.
      leaf(s, { x: cx + side * 1.5 * u, y: y - sign * 4 * u }, Math.atan2(-sign * 1.1, side), 13 * u * taper, 4 * u * taper);
      // Berries trailing past the curl.
      const beyond = add(at, scale(dirOf(angle), reach + curlR * 0.9));
      for (let b = 0; b < 3; b++) {
        const pb = add(beyond, { x: side * b * 6 * u * taper, y: -sign * (b * 3 - 4) * u });
        if (Math.abs(pb.x - cx) < halfWidthAt(pb.y) - 4) f.circle(pb, Math.max(0.9, (2.1 - b * 0.45) * u * taper));
      }
    }
  }
  // Fleur at the tip.
  const tipBase = { x: cx, y: y1 };
  leaf(s, tipBase, sign > 0 ? Math.PI / 2 : -Math.PI / 2, 15 * u, 5 * u);
  leaf(s, tipBase, Math.atan2(sign * 0.8, -1), 11 * u, 4 * u);
  leaf(s, tipBase, Math.atan2(sign * 0.8, 1), 11 * u, 4 * u);
  f.circle(tipBase, 1.8 * u);
}

/** A curling vine down a side flap; curls reach inward (`inward` = ±1). */
function sideVine(
  s: PathBuilder,
  f: PathBuilder,
  x: number,
  ya: number,
  yb: number,
  inward: 1 | -1,
  u: number,
) {
  const stem: Pt[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    stem.push({ x: x + inward * Math.sin(t * Math.PI * 3) * 5 * u, y: ya + (yb - ya) * t });
  }
  s.smooth(stem);
  const nodes = 6;
  for (let k = 0; k < nodes; k++) {
    const t = (k + 0.5) / nodes;
    const y = ya + (yb - ya) * t;
    const px = x + inward * Math.sin(t * Math.PI * 3) * 5 * u;
    const up = k % 2 === 0 ? -1 : 1;
    const angle = Math.atan2(up * 0.55, inward);
    const turn: 1 | -1 = inward * up > 0 ? 1 : -1;
    s.smooth(curlPoints({ x: px, y }, angle, 28 * u, 8 * u, turn === 1 ? -1 : 1));
    leaf(s, { x: px, y: y + up * 9 * u }, Math.atan2(-up * 0.9, inward * 0.6), 15 * u, 4.5 * u);
    f.circle({ x: px + inward * 3 * u, y: y - up * 14 * u }, 1.5 * u);
  }
  // Buds at both ends.
  leaf(s, { x, y: ya }, -Math.PI / 2, 12 * u, 4 * u);
  leaf(s, { x, y: yb }, Math.PI / 2, 12 * u, 4 * u);
}

/** Beads every `step` px along a segment, skipping `skipA`/`skipB` px at the ends. */
function beads(f: PathBuilder, a: Pt, b: Pt, step: number, r: number, skipA: number, skipB: number) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len <= skipA + skipB) return;
  const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  for (let t = skipA; t <= len - skipB; t += step) f.circle(add(a, scale(d, t)), r);
}

/** Inward-facing scallops along a straight edge. */
function scallops(s: PathBuilder, a: Pt, b: Pt, inward: Pt, r: number) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.round(len / (r * 2)));
  const seg = len / n;
  const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  s.move(a);
  for (let i = 0; i < n; i++) {
    const p0 = add(a, scale(d, seg * i));
    const p1 = add(a, scale(d, seg * (i + 1)));
    const k = 0.5523 * 2; // two quarter-circle-ish cubics as one bump
    const c1 = add(p0, scale(inward, (seg / 2) * k * 0.9));
    const c2 = add(p1, scale(inward, (seg / 2) * k * 0.9));
    s.cubic(c1, c2, p1);
  }
}

/** The whole envelope's ornament, in stage pixels. */
export function envelopeOrnament({ w, h, meet, sealR }: OrnamentInput): Ornament {
  const s = new PathBuilder();
  const f = new PathBuilder();
  // Ornament scale: designed on a 390px-wide phone.
  const u = Math.max(0.85, Math.min(1.25, w / 390));

  // ── Border: scallops, a rule, a bead row ───────────────────────────────
  const i0 = 8 * u;
  const sr = 4.2 * u;
  scallops(s, { x: i0, y: i0 }, { x: w - i0, y: i0 }, { x: 0, y: 1 }, sr);
  scallops(s, { x: w - i0, y: i0 }, { x: w - i0, y: h - i0 }, { x: -1, y: 0 }, sr);
  scallops(s, { x: w - i0, y: h - i0 }, { x: i0, y: h - i0 }, { x: 0, y: -1 }, sr);
  scallops(s, { x: i0, y: h - i0 }, { x: i0, y: i0 }, { x: 1, y: 0 }, sr);
  const i1 = 18 * u;
  s.move({ x: i1, y: i1 });
  s.line({ x: w - i1, y: i1 });
  s.line({ x: w - i1, y: h - i1 });
  s.line({ x: i1, y: h - i1 });
  s.close();
  const i2 = 24 * u;
  const step = 9 * u;
  beads(f, { x: i2, y: i2 }, { x: w - i2, y: i2 }, step, 1.1 * u, 0, 0);
  beads(f, { x: i2, y: h - i2 }, { x: w - i2, y: h - i2 }, step, 1.1 * u, 0, 0);
  beads(f, { x: i2, y: i2 + step }, { x: i2, y: h - i2 - step }, step, 1.1 * u, 0, 0);
  beads(f, { x: w - i2, y: i2 + step }, { x: w - i2, y: h - i2 - step }, step, 1.1 * u, 0, 0);

  // ── Seams and the bead rows either side of them ────────────────────────
  const corners: Pt[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  const seams: [number, number, number, number][] = corners.map((c) => [c.x, c.y, meet.x, meet.y]);
  for (const c of corners) {
    const len = Math.hypot(meet.x - c.x, meet.y - c.y);
    const d = { x: (meet.x - c.x) / len, y: (meet.y - c.y) / len };
    const n = { x: -d.y, y: d.x };
    for (const side of [-1, 1]) {
      const off = scale(n, side * 7 * u);
      beads(f, add(c, off), add(meet, off), 8 * u, 1.05 * u, 46 * u, sealR + 30 * u);
    }
  }

  // ── Medallion round the seal ────────────────────────────────────────────
  s.circle(meet, sealR + 10 * u);
  s.circle(meet, sealR + 17 * u);
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const long = i % 2 === 0;
    s.move(add(meet, scale(dirOf(a), sealR + 20 * u)));
    s.line(add(meet, scale(dirOf(a), sealR + (long ? 30 : 25) * u)));
  }

  // ── Top and bottom sprays, tapering to fit their triangles ─────────────
  // Top flap: at height y its half-width is (w/2)·(1 − y/meet.y).
  const topHalf = (y: number) => (w / 2) * Math.max(0, 1 - y / meet.y);
  const botHalf = (y: number) => (w / 2) * Math.max(0, 1 - (h - y) / (h - meet.y));
  const sprayGap = sealR + 40 * u;
  spray(s, f, meet.x, Math.max(i2 + 46 * u, h * 0.1), meet.y - sprayGap, topHalf, u);
  spray(s, f, meet.x, Math.min(h - i2 - 46 * u, h * 0.9), meet.y + sprayGap + 44 * u, botHalf, u);

  // ── Side vines ─────────────────────────────────────────────────────────
  const vx = 40 * u;
  const va = meet.y - (h * 0.22);
  const vb = meet.y + (h * 0.22);
  sideVine(s, f, vx, va, vb, 1, u);
  sideVine(s, f, w - vx, va, vb, -1, u);

  return { strokes: s.toString(), fills: f.toString(), seams, strokeWidth: 1.3 * u };
}

/**
 * The embossed art as a standalone SVG: paper grain over the whole stage and
 * the ornament lit as raised relief (a highlight up-left, a soft shadow
 * down-right, a satin specular on the crests). Transparent everywhere else,
 * so each flap's own paper colour shows through.
 */
export function envelopeArtSvg(o: Ornament, w: number, h: number, shadowRgb: string): string {
  const W = r1(w);
  const H = r1(h);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    '<defs>' +
    '<filter id="g" x="0" y="0" width="100%" height="100%">' +
    '<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" stitchTiles="stitch"/>' +
    '<feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.075 0"/>' +
    '</filter>' +
    '<filter id="e" x="-1%" y="-1%" width="102%" height="102%">' +
    '<feGaussianBlur in="SourceAlpha" stdDeviation="0.75" result="b"/>' +
    '<feSpecularLighting in="b" surfaceScale="2.4" specularConstant="0.95" specularExponent="20" lighting-color="#fff6ea" result="s">' +
    '<feDistantLight azimuth="235" elevation="40"/></feSpecularLighting>' +
    '<feComposite in="s" in2="SourceAlpha" operator="in" result="si"/>' +
    '<feOffset in="b" dx="0.9" dy="1.2" result="so"/>' +
    `<feFlood flood-color="rgb(${shadowRgb})" flood-opacity="0.55"/>` +
    '<feComposite in2="so" operator="in" result="sh"/>' +
    '<feOffset in="b" dx="-0.6" dy="-0.7" result="ho"/>' +
    '<feFlood flood-color="#ffffff" flood-opacity="0.5"/>' +
    '<feComposite in2="ho" operator="in" result="hi"/>' +
    '<feFlood flood-color="#ffffff" flood-opacity="0.14"/>' +
    '<feComposite in2="SourceAlpha" operator="in" result="body"/>' +
    '<feMerge><feMergeNode in="sh"/><feMergeNode in="hi"/><feMergeNode in="body"/><feMergeNode in="si"/></feMerge>' +
    '</filter>' +
    '</defs>' +
    '<rect width="100%" height="100%" filter="url(#g)"/>' +
    '<g filter="url(#e)">' +
    `<path d="${o.strokes}" fill="none" stroke="#fff" stroke-width="${r1(o.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${o.fills}" fill="#fff"/>` +
    '</g></svg>'
  );
}

/**
 * The same linework as a MASK (white on transparent, a touch bolder, plus the
 * seams) — what the idle shimmer of light is allowed to touch.
 */
export function envelopeMaskSvg(o: Ornament, w: number, h: number): string {
  const W = r1(w);
  const H = r1(h);
  const seams = o.seams.map(([x1, y1, x2, y2]) => `M${r1(x1)} ${r1(y1)}L${r1(x2)} ${r1(y2)}`).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<path d="${o.strokes}" fill="none" stroke="#fff" stroke-width="${r1(o.strokeWidth + 1.4)}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${o.fills}" fill="#fff"/>` +
    `<path d="${seams}" stroke="#fff" stroke-width="3" fill="none"/>` +
    '</svg>'
  );
}

/** An SVG string as a CSS-safe data: URL. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
