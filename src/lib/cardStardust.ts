/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * cardStardust — the PURE maths behind the 'stardust' card reveal
 * (components/cards/reveals/StardustReveal.tsx), plus the card-FACE layout the
 * two lane-B reveals (stardust + airplane) both paint. No three.js, no DOM.
 *
 * The reveal: thousands of points swirl as a small galaxy; on the tap they
 * spin up into a vortex and then CONDENSE onto the card face — every particle
 * owns one target sampled from the rendered face (brighter texels — the title,
 * the photo's highlights — draw more particles, the outline gets its own
 * share so the card's edge reads crisp) and arrives after a per-particle
 * delay, so the card ripples together from the centre out. The shader does
 * the motion; this module decides where everything goes and when.
 */

/* ── Seeded randomness (deterministic layouts, testable) ───────────────── */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller normal sample. */
function gauss(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ── Budget ────────────────────────────────────────────────────────────── */

export const STARDUST_FULL = 25000;
export const STARDUST_LITE = 8000;

/** ~25k on a desktop, ~8k on small or low-DPR screens or with reduced motion. */
export function particleBudget(opts: { width: number; height: number; dpr: number; reducedMotion: boolean }): number {
  const small = Math.min(opts.width, opts.height) < 600;
  const lowDpr = !(opts.dpr >= 1.25) && Math.max(opts.width, opts.height) < 1200;
  return opts.reducedMotion || small || lowDpr ? STARDUST_LITE : STARDUST_FULL;
}

/* ── Galaxy ────────────────────────────────────────────────────────────── */

export interface Galaxy {
  /** Disk-space positions (x, y = thickness, z), radius ≈ 1. */
  positions: Float32Array;
  /** 0 = core (warm), 1 = rim (accent). */
  heat: Float32Array;
  /** Per-particle size multiplier, ~0.5..1.8. */
  scale: Float32Array;
  /** 0..1 random seed per particle. */
  seed: Float32Array;
}

/** A three-armed spiral galaxy of `n` points with a warm central bulge. */
export function galaxy(n: number, rng: () => number, arms = 3): Galaxy {
  const positions = new Float32Array(n * 3);
  const heat = new Float32Array(n);
  const scale = new Float32Array(n);
  const seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const bulge = rng() < 0.16;
    let r: number;
    let theta: number;
    if (bulge) {
      r = Math.abs(gauss(rng)) * 0.16;
      theta = rng() * Math.PI * 2;
    } else {
      r = 0.08 + Math.pow(rng(), 0.75) * 0.92;
      const arm = Math.floor(rng() * arms);
      // Logarithmic-ish wind: outer stars lag behind; scatter grows outward.
      theta = (arm / arms) * Math.PI * 2 + r * 4.2 + gauss(rng) * (0.18 + 0.22 * r);
    }
    const thick = gauss(rng) * 0.045 * (1.2 - r);
    positions[i * 3] = Math.cos(theta) * r;
    positions[i * 3 + 1] = thick;
    positions[i * 3 + 2] = Math.sin(theta) * r;
    heat[i] = Math.min(1, Math.max(0, r * 1.15 + gauss(rng) * 0.08));
    const sparkle = rng() < 0.04;
    scale[i] = sparkle ? 1.4 + rng() * 0.6 : 0.5 + rng() * 0.7;
    seed[i] = rng();
  }
  return { positions, heat, scale, seed };
}

/* ── Card targets ──────────────────────────────────────────────────────── */

export interface ImageLike {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

export interface CardTargets {
  /** Card UV of each target (u right, v UP — texture convention). */
  uv: Float32Array;
  /** Linear 0..1 RGB of the face at that target. */
  rgb: Float32Array;
  /** Perimeter coordinate 0..1 for outline particles; -1 for interior ones. */
  edge: Float32Array;
}

const lum = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/**
 * Sample `n` particle targets from a rendering of the card face. `edgeShare`
 * of them sit on the card's outline (for a crisp edge and the light pulse that
 * races around it); the rest are importance-sampled: a floor of uniform
 * coverage so dark areas are still "card", plus weight on bright texels.
 */
export function sampleCardTargets(img: ImageLike, n: number, rng: () => number, edgeShare = 0.1): CardTargets {
  const { width: w, height: h, data } = img;
  const uv = new Float32Array(n * 2);
  const rgb = new Float32Array(n * 3);
  const edge = new Float32Array(n).fill(-1);
  const aspect = w / h;
  const nEdge = Math.round(n * Math.min(0.5, Math.max(0, edgeShare)));
  const color = (x: number, y: number, i: number) => {
    const px = Math.min(w - 1, Math.max(0, Math.floor(x)));
    const py = Math.min(h - 1, Math.max(0, Math.floor(y)));
    const o = (py * w + px) * 4;
    rgb[i * 3] = data[o] / 255;
    rgb[i * 3 + 1] = data[o + 1] / 255;
    rgb[i * 3 + 2] = data[o + 2] / 255;
  };
  // Outline: evenly around the perimeter, jittered a hair inward.
  for (let i = 0; i < nEdge; i++) {
    const s = (i + rng() * 0.6) / Math.max(1, nEdge);
    const [u, v] = perimeterPoint(s, aspect);
    const inset = rng() * 0.006;
    const uu = u + (u < 0.5 ? inset : -inset);
    const vv = v + (v < 0.5 ? inset : -inset);
    uv[i * 2] = uu;
    uv[i * 2 + 1] = vv;
    edge[i] = s % 1;
    color(uu * w, (1 - vv) * h, i);
  }
  // Interior: CDF over weights.
  const cdf = new Float64Array(w * h);
  let acc = 0;
  for (let p = 0; p < w * h; p++) {
    const o = p * 4;
    const l = lum(data[o], data[o + 1], data[o + 2]);
    acc += 0.35 + 2.4 * l * l;
    cdf[p] = acc;
  }
  for (let i = nEdge; i < n; i++) {
    const target = rng() * acc;
    let lo = 0;
    let hi = cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const px = (lo % w) + rng();
    const py = Math.floor(lo / w) + rng();
    uv[i * 2] = px / w;
    uv[i * 2 + 1] = 1 - py / h;
    color(px, py, i);
  }
  return { uv, rgb, edge };
}

/**
 * A point on the card's outline at perimeter coordinate s (0..1, wraps),
 * clockwise from the top-centre, as card UV (v up). Lengths respect `aspect`
 * so the pulse runs at an even speed round a tall card.
 */
export function perimeterPoint(s: number, aspect: number): [number, number] {
  const a = Math.max(1e-3, aspect);
  const W = a;
  const H = 1;
  const P = 2 * (W + H);
  let d = (((s % 1) + 1) % 1) * P;
  // Top edge, right half.
  if (d < W / 2) return [0.5 + d / W, 1];
  d -= W / 2;
  if (d < H) return [1, 1 - d / H];
  d -= H;
  if (d < W) return [1 - d / W, 0];
  d -= W;
  if (d < H) return [0, d / H];
  d -= H;
  return [d / W, 1];
}

/** Inverse of perimeterPoint for a point ON the outline. */
export function perimeterParam(u: number, v: number, aspect: number): number {
  const W = Math.max(1e-3, aspect);
  const H = 1;
  const P = 2 * (W + H);
  const du = Math.min(u, 1 - u);
  const dv = Math.min(v, 1 - v);
  let d: number;
  if (dv * H <= du * W) {
    // On the top or bottom edge.
    d = v >= 0.5 ? (u >= 0.5 ? (u - 0.5) * W : W / 2 + H + W + H + u * W) : W / 2 + H + (1 - u) * W;
  } else {
    d = u >= 0.5 ? W / 2 + (1 - v) * H : W / 2 + H + W + v * H;
  }
  return (((d / P) % 1) + 1) % 1;
}

/** Per-particle arrival delay (0..maxDelay): the centre locks in first, the
 *  card ripples outward, with a little jitter so it shimmers rather than wipes. */
export function gatherDelay(u: number, v: number, aspect: number, jitter: number, maxDelay = 0.38): number {
  const dx = (u - 0.5) * aspect;
  const dy = v - 0.5;
  const rMax = Math.hypot(aspect * 0.5, 0.5);
  const r = Math.hypot(dx, dy) / rMax;
  const d = 0.78 * r + 0.22 * Math.min(1, Math.max(0, jitter));
  return Math.min(maxDelay, Math.max(0, d * maxDelay));
}

/** The shader's per-particle progress: 0 until its delay, eased to 1 over `window`. */
export function localGather(gather: number, delay: number, window = 0.62): number {
  const x = (gather - delay) / window;
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  // easeInOutCubic — kept identical to the GLSL.
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/* ── Timeline ──────────────────────────────────────────────────────────── */

export interface StardustState {
  /** Spin speed multiplier (radians/s of the base rotation). */
  spin: number;
  /** 0..1 how far the galaxy has drawn into a vortex. */
  vortex: number;
  /** 0..1 shader gather progress (with per-particle delays ≤ 0.38, window 0.62). */
  gather: number;
  /** 0..1 white-warm flash as the card locks in. */
  flash: number;
  /** Light racing round the edge: position (laps, monotonic) and strength. */
  edgePos: number;
  edgeAmp: number;
  /** Textured card opacity. */
  card: number;
  /** Particle cloud opacity. */
  particles: number;
  /** Halo behind the card. */
  glow: number;
  /** Faint title in the core (idle) — fades as the vortex begins. */
  title: number;
  done: boolean;
}

export interface StardustTimeline {
  vortex: [number, number];
  gather: [number, number];
  lock: number;
  edge: [number, number];
  card: [number, number];
  particlesOut: [number, number];
  done: number;
  spinPeak: number;
  flashPeak: number;
}

export function stardustTimeline(reducedMotion: boolean): StardustTimeline {
  return reducedMotion
    ? {
        vortex: [0, 1.0],
        gather: [0.2, 2.9],
        lock: 2.75,
        edge: [2.6, 3.8],
        card: [2.75, 3.45],
        particlesOut: [2.85, 3.5],
        done: 4.2,
        spinPeak: 1.2,
        flashPeak: 0.45,
      }
    : {
        vortex: [0, 1.25],
        gather: [0.85, 2.75],
        lock: 2.55,
        edge: [2.4, 3.6],
        card: [2.55, 3.15],
        particlesOut: [2.6, 3.2],
        done: 3.9,
        spinPeak: 7,
        flashPeak: 1,
      };
}

const sm = (a: number, b: number, t: number) => {
  if (b <= a) return t >= b ? 1 : 0;
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

/** Everything the scene needs at `t` seconds after the tap (t < 0 = idle). */
export function stardustAt(tl: StardustTimeline, t: number): StardustState {
  if (t < 0) {
    return { spin: 1, vortex: 0, gather: 0, flash: 0, edgePos: 0, edgeAmp: 0, card: 0, particles: 1, glow: 0, title: 1, done: false };
  }
  const v = sm(tl.vortex[0], tl.vortex[1], t);
  // Spin ramps to its peak through the vortex, then winds down as the card forms.
  const spinUp = 1 + (tl.spinPeak - 1) * v;
  const spin = spinUp * (1 - sm(tl.gather[0], tl.lock, t) * 0.92);
  const gather = sm(tl.gather[0], tl.gather[1], t);
  const flashIn = sm(tl.lock - 0.12, tl.lock, t);
  const flashOut = 1 - sm(tl.lock, tl.lock + 0.5, t);
  const flash = tl.flashPeak * flashIn * flashOut;
  const edgeLin = Math.min(1, Math.max(0, (t - tl.edge[0]) / (tl.edge[1] - tl.edge[0])));
  // Two laps, decelerating, fading as it finishes.
  const edgePos = 2 * (1 - Math.pow(1 - edgeLin, 2));
  const edgeAmp = t < tl.edge[0] ? 0 : sm(tl.edge[0], tl.edge[0] + 0.12, t) * (1 - sm(tl.edge[1] - 0.35, tl.edge[1], t));
  const card = sm(tl.card[0], tl.card[1], t);
  const particles = 1 - sm(tl.particlesOut[0], tl.particlesOut[1], t);
  const glow = sm(tl.lock - 0.2, tl.lock + 0.2, t) * (1 - 0.65 * sm(tl.lock + 0.3, tl.done, t));
  const title = 1 - sm(0, 0.5, t);
  return { spin, vortex: v, gather, flash, edgePos, edgeAmp, card, particles, glow, title, done: t >= tl.done };
}

/* ── Card face layout (shared by the stardust + airplane faces) ────────── */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FaceLayout {
  /** Arched photo window (top is a semicircle of radius w/2). */
  photo: Rect;
  /** Title box: lines are centred on cx from top `y`. */
  title: { cx: number; y: number; maxW: number; maxH: number };
  /** Filigree frame inset. */
  frame: Rect;
  /** Small warm sparkle under the title (centre). */
  sparkle: { x: number; y: number; r: number };
}

/** Lay out a W×H face. Without a photo the arch still frames a monogram. */
export function cardFaceLayout(W: number, H: number): FaceLayout {
  const inset = W * 0.045;
  const frame = { x: inset, y: inset, w: W - 2 * inset, h: H - 2 * inset };
  const pw = W * 0.74;
  const ph = Math.min(H * 0.56, pw * 1.32);
  const titleH = Math.min(H * 0.26, W * 0.42);
  const gap = H * 0.035;
  const block = ph + gap + titleH;
  const top = Math.max(H * 0.07, (H - block) / 2 - H * 0.02);
  const photo = { x: (W - pw) / 2, y: top, w: pw, h: ph };
  const tY = top + ph + gap;
  return {
    photo,
    title: { cx: W / 2, y: tY, maxW: W * 0.8, maxH: titleH },
    frame,
    sparkle: { x: W / 2, y: Math.min(H - inset * 1.6, tY + titleH + gap * 0.4), r: W * 0.018 },
  };
}

/** Source rect that cover-crops a (sw × sh) image into a (dw × dh) box. */
export function coverCrop(sw: number, sh: number, dw: number, dh: number): Rect {
  if (!(sw > 0 && sh > 0 && dw > 0 && dh > 0)) return { x: 0, y: 0, w: Math.max(0, sw), h: Math.max(0, sh) };
  const s = Math.max(dw / sw, dh / sh);
  const w = dw / s;
  const h = dh / s;
  return { x: (sw - w) / 2, y: (sh - h) * 0.4, w, h };
}

/**
 * Greedy word wrap with an injected measurer (canvas measureText in the app,
 * a fake in tests). A single word wider than `maxW` gets its own line.
 * Returns null when the text needs more than `maxLines`.
 */
export function wrapTitle(text: string, maxW: number, measure: (s: string) => number, maxLines: number): string[] | null {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line === '' ? w : `${line} ${w}`;
    if (line !== '' && measure(next) > maxW) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line !== '') lines.push(line);
  if (lines.length > maxLines) return null;
  if (lines.some((l) => measure(l) > maxW * 1.0001)) return null;
  return lines;
}

/** Largest font size (stepping down from `max`) whose wrap fits the title box. */
export function fitTitle(
  text: string,
  box: { maxW: number; maxH: number },
  measureAt: (s: string, size: number) => number,
  opts: { max: number; min: number; lineHeight: number; maxLines: number },
): { size: number; lines: string[] } {
  for (let size = opts.max; size >= opts.min; size -= Math.max(1, opts.max * 0.04)) {
    const lines = wrapTitle(text, box.maxW, (s) => measureAt(s, size), opts.maxLines);
    if (lines !== null && lines.length * size * opts.lineHeight <= box.maxH) return { size, lines };
  }
  // Fallback: smallest size, hard-truncate to maxLines with an ellipsis.
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line === '' ? w : `${line} ${w}`;
    if (line !== '' && measureAt(next, opts.min) > box.maxW) {
      lines.push(line);
      line = w;
      if (lines.length === opts.maxLines) break;
    } else line = next;
  }
  if (lines.length < opts.maxLines && line !== '') lines.push(line);
  else if (lines.length === opts.maxLines) lines[opts.maxLines - 1] = `${lines[opts.maxLines - 1]}…`;
  return { size: opts.min, lines };
}
