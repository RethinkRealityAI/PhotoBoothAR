/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Face Paint design registry: procedural looks (the eight originals plus a
 * Christmas set), each drawn into
 * TEXTURE space relative to facial landmarks (features.ts), never at fixed uv
 * pixels. Every design takes up to three colours in slot order; the studio fills
 * them from the event theme and the host can override each one.
 *
 * Determinism is a contract (facePaint.test.ts): the same spec paints the same
 * calls every time — glitter positions come from a seeded PRNG, never
 * Math.random — so a guest's photo, the studio thumbnail and the booth all agree.
 */
import { lerpPt, type FaceFrame, type Pt } from './features';
import {
  angleOf, arcLengths, cubicPts, dot, ellipseAt, hard, heartPath, hollyLeafPath, polylinePath, polyNormals,
  quadPts, ribbonPath, rng, roundEnds, snowflakePath, soft, softBlob, spiralPts, starPath, taperPath, type PaintContext,
} from './shapes';
import { cloudPath } from './shapes';

export const FACE_PAINT_DESIGN_IDS = [
  'game-day',
  'flag-cheeks',
  'eye-black',
  'glitter-freckles',
  'hearts',
  'stars',
  'tiger',
  'sugar-skull',
  'candy-cane',
  'rudolph',
  'snowflakes',
  'frost-queen',
  'gingerbread',
  // Party (year-round), second wave
  'butterfly',
  'hero-mask',
  'rainbow',
  'lightning-bolt',
  'unicorn',
  'cat',
  'neon-tribal',
  // Flags (full-face and cheek pairs), for team and heritage nights
  'saltire-face',
  'tricolour-face',
  'rival-flags',
  // Celebration (weddings, anniversaries, galas)
  'wedding-rings',
  'gilded-lace',
  'hibiscus-bloom',
] as const;
export type FacePaintDesignId = (typeof FACE_PAINT_DESIGN_IDS)[number];

/** Where a colour slot's default comes from: an event theme token, or a fixed hex. */
export type ColorSource = 'accent' | 'accent2' | 'accent3' | `#${string}`;

export interface ThemeColors {
  accent: string;
  accent2: string;
  accent3: string;
}

export interface FacePaintDesign {
  id: FacePaintDesignId;
  name: string;
  blurb: string;
  /** Slot labels + default sources, in the order `colors[]` is read. */
  slots: { label: string; source: ColorSource }[];
  draw: (ctx: PaintContext, f: FaceFrame, colors: string[]) => void;
  /**
   * Covers the whole face. The paint layer shades these fully by the guest's
   * own skin luminance (so it reads as pigment, not a rubber mask); accent
   * designs keep a lighter touch and stay crisp.
   */
  fullFace?: true;
  /**
   * Picker shelf (FACE_PAINT_CATEGORIES). Optional: a design without one
   * lands on the first shelf, so a new design never needs picker code.
   */
  category?: FacePaintCategory;
  /**
   * Living twinkle: FacePaintLayer adds a subtle time-driven glint over the
   * paint (frozen still under prefers-reduced-motion). A REGISTRY property, not
   * a stored-spec field — so it is opt-in per design, and none of the first
   * eight designs carries it (their saved scenes render exactly as before;
   * facePaint.test.ts pins that).
   */
  shimmer?: true;
}

/** Picker shelves, in display order. The builder hides a shelf with no designs. */
export const FACE_PAINT_CATEGORIES = [
  { id: 'everyday', label: 'Everyday' },
  { id: 'party', label: 'Party' },
  { id: 'holiday', label: 'Holiday' },
  { id: 'flags', label: 'Flags' },
  { id: 'celebration', label: 'Celebration' },
] as const;
export type FacePaintCategory = (typeof FACE_PAINT_CATEGORIES)[number]['id'];
export const DEFAULT_FACE_PAINT_CATEGORY: FacePaintCategory = 'everyday';

/** The shelf a design sits on (its own category, else the default shelf). */
export function categoryOf(d: Pick<FacePaintDesign, 'category'>): FacePaintCategory {
  return d.category ?? DEFAULT_FACE_PAINT_CATEGORY;
}

/** Fallback when the event theme is unreadable (the platform's beam gold). */
export const DEFAULT_THEME: ThemeColors = { accent: '#d4a017', accent2: '#f3d47a', accent3: '#7a5a18' };

type Side = 'L' | 'R';
const SIDES: Side[] = ['L', 'R'];

/** Per-side landmark accessor + the outward x sign (screen left is −x). */
function sided(f: FaceFrame, s: Side) {
  const L = s === 'L';
  return {
    out: L ? -1 : 1,
    eyeOuter: L ? f.eyeOuterL : f.eyeOuterR,
    eyeInner: L ? f.eyeInnerL : f.eyeInnerR,
    eyeTop: L ? f.eyeTopL : f.eyeTopR,
    eyeBot: L ? f.eyeBotL : f.eyeBotR,
    brow: L ? f.browL : f.browR,
    browOuter: L ? f.browOuterL : f.browOuterR,
    cheek: L ? f.cheekL : f.cheekR,
    cheekbone: L ? f.cheekboneL : f.cheekboneR,
    underEye: L ? f.underEyeL : f.underEyeR,
    cheekLow: L ? f.cheekLowL : f.cheekLowR,
    side: L ? f.sideL : f.sideR,
    temple: L ? f.templeL : f.templeR,
    jaw: L ? f.jawL : f.jawR,
    chinSide: L ? f.chinL : f.chinR,
    mouth: L ? f.mouthL : f.mouthR,
  };
}

function eyeCentre(f: FaceFrame, s: Side): Pt {
  const k = sided(f, s);
  return { x: (k.eyeOuter.x + k.eyeInner.x) / 2, y: (k.eyeTop.y + k.eyeBot.y) / 2 };
}

/** Softness in texture px — scales with the texture so 512/1024/2048 agree. */
function edge(f: FaceFrame, k = 1): number {
  return f.size * 0.006 * k;
}

function withTransform(ctx: PaintContext, at: Pt, rot: number, body: () => void): void {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(rot);
  body();
  ctx.restore();
}

function c(colors: string[], i: number, fallback: string): string {
  return colors[i] ?? colors[0] ?? fallback;
}

/* ── designs ─────────────────────────────────────────────────────────── */

function gameDay(ctx: PaintContext, f: FaceFrame, colors: string[]): void {
  const E = f.eyeSpan;
  const stripes = Math.max(2, Math.min(3, colors.length));
  const h = E * 0.085;
  for (const s of SIDES) {
    const k = sided(f, s);
    // Along the cheekbone just under the eye, tilting down and outward.
    const centre = lerpPt(lerpPt(k.eyeBot, k.eyeOuter, 0.4), k.cheekbone, 0.62);
    // Eye line, flipped on the left so +x always points screen-right; then a
    // tilt that drops the OUTER end (negative on the left, positive on the right).
    const rot = angleOf(k.eyeInner, k.eyeOuter) + (s === 'L' ? Math.PI : 0) + k.out * 0.32;
    withTransform(ctx, centre, rot, () => {
      ctx.lineCap = 'round';
      ctx.lineWidth = h;
      for (let i = 0; i < stripes; i++) {
        const col = c(colors, i, '#ffffff');
        soft(ctx, col, edge(f));
        ctx.strokeStyle = col;
        const y = (i - (stripes - 1) / 2) * h * 1.35;
        const half = E * (0.22 - i * 0.015);
        ctx.beginPath();
        ctx.moveTo(-half, y);
        ctx.lineTo(half, y);
        ctx.stroke();
      }
    });
  }
  hard(ctx);
}

function flagCheeks(ctx: PaintContext, f: FaceFrame, colors: string[]): void {
  const E = f.eyeSpan;
  const w = E * 0.44;
  const h = E * 0.28;
  const bands = Math.max(1, Math.min(3, colors.length));
  for (const s of SIDES) {
    const k = sided(f, s);
    const centre = lerpPt(lerpPt(k.cheek, k.cheekbone, 0.45), k.underEye, 0.25);
    withTransform(ctx, centre, -k.out * 0.08, () => {
      // A gently waving flag: wavy top/bottom edges, straight hoist.
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h / 2);
      ctx.bezierCurveTo(-w / 6, -h / 2 - h * 0.12, w / 6, -h / 2 + h * 0.12, w / 2, -h / 2);
      ctx.lineTo(w / 2, h / 2);
      ctx.bezierCurveTo(w / 6, h / 2 + h * 0.12, -w / 6, h / 2 - h * 0.12, -w / 2, h / 2);
      ctx.closePath();
      soft(ctx, c(colors, 0, '#ffffff'), edge(f, 0.8));
      ctx.fillStyle = c(colors, 0, '#ffffff');
      ctx.fill();
      ctx.clip();
      hard(ctx);
      for (let i = 0; i < bands; i++) {
        ctx.fillStyle = c(colors, i, '#ffffff');
        ctx.fillRect(-w / 2 + (i * w) / bands, -h, w / bands + 0.5, h * 2);
      }
      ctx.restore();
    });
  }
  hard(ctx);
}

function eyeBlack(ctx: PaintContext, f: FaceFrame, colors: string[]): void {
  const E = f.eyeSpan;
  const col = c(colors, 0, '#121212');
  soft(ctx, col, edge(f, 1.4));
  ctx.fillStyle = col;
  for (const s of SIDES) {
    const k = sided(f, s);
    const centre = lerpPt(lerpPt(k.eyeBot, k.underEye, 0.6), k.eyeOuter, 0.18);
    const rot = angleOf(k.eyeInner, k.eyeOuter) + (s === 'L' ? Math.PI : 0);
    withTransform(ctx, centre, rot, () => {
      // Two overlapping passes read as a finger-swiped smear, not a sticker.
      ellipseAt(ctx, { x: 0, y: 0 }, E * 0.17, E * 0.05);
      ctx.fill();
      ellipseAt(ctx, { x: E * 0.02, y: E * 0.012 }, E * 0.15, E * 0.04, 0.05);
      ctx.fill();
    });
  }
  hard(ctx);
}

function glitterFreckles(ctx: PaintContext, f: FaceFrame, colors: string[]): void {
  const E = f.eyeSpan;
  const rand = rng(0x5eed1e5);
  // The freckle band: under-eye → across the nose bridge → under-eye.
  const path = [f.underEyeL, lerpPt(f.cheekL, f.noseTip, 0.5), lerpPt(f.noseBridge, f.noseTip, 0.55), lerpPt(f.cheekR, f.noseTip, 0.5), f.underEyeR];
  const n = 130;
  const palette = colors.length > 0 ? colors : ['#f3d47a'];
  for (let i = 0; i < n; i++) {
    const t = rand() * (path.length - 1);
    const seg = Math.min(path.length - 2, Math.floor(t));
    const p = lerpPt(path[seg], path[seg + 1], t - seg);
    // Box-Muller-ish spread, wider on the cheeks than across the nose.
    const spread = E * (0.06 + 0.09 * Math.abs(t / (path.length - 1) - 0.5) * 2);
    const jx = (rand() + rand() - 1) * spread;
    const jy = (rand() + rand() - 1) * spread * 1.3;
    const r = E * (0.008 + rand() * 0.016);
    const col = palette[Math.floor(rand() * palette.length) % palette.length];
    const at = { x: p.x + jx, y: p.y + jy };
    ctx.fillStyle = col;
    soft(ctx, col, edge(f, 0.35));
    dot(ctx, at, r);
    ctx.fill();
    // Every fourth fleck catches the light: a hot white core.
    if (i % 4 === 0) {
      hard(ctx);
      ctx.fillStyle = '#ffffff';
      dot(ctx, { x: at.x - r * 0.25, y: at.y - r * 0.25 }, r * 0.42);
      ctx.fill();
    }
  }
  // A few four-point glints.
  hard(ctx);
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 6; i++) {
    const t = rand() * (path.length - 1);
    const seg = Math.min(path.length - 2, Math.floor(t));
    const p = lerpPt(path[seg], path[seg + 1], t - seg);
    withTransform(ctx, { x: p.x + (rand() - 0.5) * E * 0.12, y: p.y + (rand() - 0.5) * E * 0.1 }, Math.PI / 4 * rand(), () => {
      starPath(ctx, E * 0.03, E * 0.007, 4);
      ctx.fill();
    });
  }
}

function hearts(ctx: PaintContext, f: FaceFrame, colors: string[]): void {
  const E = f.eyeSpan;
  const main = c(colors, 0, '#e8336f');
  const accent = c(colors, 1, '#ffffff');
  const L = sided(f, 'L');
  const R = sided(f, 'R');
  const items: { at: Pt; s: number; rot: number; col: string }[] = [
    { at: lerpPt(L.cheekbone, L.cheek, 0.45), s: E * 0.13, rot: -0.28, col: main },
    { at: lerpPt(L.eyeOuter, L.side, 0.4), s: E * 0.06, rot: -0.45, col: accent },
    { at: lerpPt(L.eyeOuter, L.temple, 0.45), s: E * 0.045, rot: -0.2, col: main },
    { at: lerpPt(R.cheekbone, R.cheek, 0.45), s: E * 0.07, rot: 0.3, col: main },
  ];
  for (const h of items) {
    withTransform(ctx, h.at, h.rot, () => {
      soft(ctx, h.col, edge(f, 0.7));
      ctx.fillStyle = h.col;
      heartPath(ctx, h.s);
      ctx.fill();
    });
    // A painted highlight stroke on the bigger hearts.
    if (h.s > E * 0.05) {
      hard(ctx);
      withTransform(ctx, h.at, h.rot, () => {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = h.s * 0.12;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-h.s * 0.55, -h.s * 0.35);
        ctx.quadraticCurveTo(-h.s * 0.65, -h.s * 0.05, -h.s * 0.4, h.s * 0.2);
        ctx.stroke();
      });
    }
  }
  hard(ctx);
}

function stars(ctx: PaintContext, f: FaceFrame, colors: string[]): void {
  const E = f.eyeSpan;
  const a = c(colors, 0, '#f3d47a');
  const b = c(colors, 1, '#ffffff');
  const cc = c(colors, 2, a);
  const R = sided(f, 'R');
  const L = sided(f, 'L');
  const items: { at: Pt; r: number; rot: number; col: string }[] = [
    { at: lerpPt(R.eyeOuter, R.cheekbone, 0.6), r: E * 0.16, rot: 0.2, col: a },
    { at: lerpPt(R.eyeOuter, R.temple, 0.5), r: E * 0.09, rot: -0.15, col: b },
    { at: lerpPt(R.browOuter, R.temple, 0.45), r: E * 0.06, rot: 0.35, col: cc },
    { at: lerpPt(R.cheekbone, R.side, 0.45), r: E * 0.05, rot: 0.1, col: b },
    { at: lerpPt(L.eyeOuter, L.cheekbone, 0.55), r: E * 0.06, rot: -0.25, col: a },
  ];
  for (const s of items) {
    withTransform(ctx, s.at, s.rot, () => {
      soft(ctx, s.col, edge(f, 0.6));
      ctx.fillStyle = s.col;
      starPath(ctx, s.r, s.r * 0.45);
      ctx.fill();
    });
  }
  // Tiny dot sparkles linking the cluster.
  hard(ctx);
  ctx.fillStyle = b;
  const rand = rng(0x57a125);
  for (let i = 0; i < 9; i++) {
    const p = lerpPt(lerpPt(R.eyeOuter, R.cheekbone, 0.55), R.temple, rand());
    dot(ctx, { x: p.x + (rand() - 0.5) * E * 0.16, y: p.y + (rand() - 0.5) * E * 0.16 }, E * (0.006 + rand() * 0.006));
    ctx.fill();
  }
}

function tiger(ctx: PaintContext, f: FaceFrame, colors: string[]): void {
  const E = f.eyeSpan;
  const base = c(colors, 0, '#f2851f');
  const ink = c(colors, 1, '#151515');
  const white = c(colors, 2, '#f7f2e8');
  // Full-face base coat — the mesh IS the face, so its edge is the paint's edge.
  hard(ctx);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, f.size, f.size);

  // White: whisker pads, chin and the brow patches.
  soft(ctx, white, edge(f, 1.2));
  ctx.fillStyle = white;
  for (const s of SIDES) {
    const k = sided(f, s);
    ellipseAt(ctx, lerpPt(lerpPt(f.mouthTop, k.mouth, 0.55), f.noseTip, 0.28), E * 0.2, E * 0.14, k.out * 0.12);
    ctx.fill();
    ellipseAt(ctx, lerpPt(k.brow, k.eyeTop, 0.35), E * 0.16, E * 0.07, -k.out * 0.15);
    ctx.fill();
  }
  ellipseAt(ctx, lerpPt(f.mouthBottom, f.chin, 0.45), E * 0.17, E * 0.13);
  ctx.fill();

  // Stripes: tapered strokes driven in from the edges and down the forehead.
  soft(ctx, ink, edge(f, 0.5));
  ctx.fillStyle = ink;
  const centre = lerpPt(f.noseBridge, f.noseTip, 0.4);
  for (const s of SIDES) {
    const k = sided(f, s);
    for (const [from, len, w] of [[k.temple, 0.45, 0.07], [k.side, 0.5, 0.08], [lerpPt(k.side, k.jaw, 0.5), 0.42, 0.07], [k.jaw, 0.32, 0.06]] as [Pt, number, number][]) {
      const tip = lerpPt(from, centre, len);
      taperPath(ctx, from, tip, E * w, 0.12 * k.out);
      ctx.fill();
    }
    // Cat-eye flick off the outer corner.
    taperPath(ctx, k.eyeOuter, { x: k.eyeOuter.x + k.out * E * 0.2, y: k.eyeOuter.y - E * 0.09 }, E * 0.045, 0);
    ctx.fill();
  }
  for (const [dx, len] of [[0, 0.5], [-0.16, 0.4], [0.16, 0.4], [-0.3, 0.3], [0.3, 0.3]]) {
    const from = { x: f.foreheadTop.x + dx * E, y: f.foreheadTop.y + Math.abs(dx) * E * 0.25 };
    const to = lerpPt(from, { x: f.browMid.x + dx * E * 0.6, y: f.browMid.y }, len);
    taperPath(ctx, from, to, E * 0.065, 0.05);
    ctx.fill();
  }

  // Nose + philtrum + whisker dots.
  withTransform(ctx, lerpPt(f.noseTip, f.mouthTop, 0.22), 0, () => {
    ctx.beginPath();
    ctx.moveTo(-E * 0.11, -E * 0.05);
    ctx.quadraticCurveTo(0, -E * 0.09, E * 0.11, -E * 0.05);
    ctx.quadraticCurveTo(E * 0.04, E * 0.06, 0, E * 0.08);
    ctx.quadraticCurveTo(-E * 0.04, E * 0.06, -E * 0.11, -E * 0.05);
    ctx.closePath();
    ctx.fill();
  });
  ctx.strokeStyle = ink;
  ctx.lineWidth = E * 0.022;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(lerpPt(f.noseTip, f.mouthTop, 0.3).x, lerpPt(f.noseTip, f.mouthTop, 0.3).y);
  ctx.lineTo(f.mouthTop.x, f.mouthTop.y);
  ctx.stroke();
  hard(ctx);
  for (const s of SIDES) {
    const k = sided(f, s);
    const pad = lerpPt(lerpPt(f.mouthTop, k.mouth, 0.55), f.noseTip, 0.28);
    for (const [dx, dy] of [[0.05, -0.02], [0.1, 0.02], [0.06, 0.05]]) {
      dot(ctx, { x: pad.x + k.out * dx * E, y: pad.y + dy * E }, E * 0.012);
      ctx.fill();
    }
  }
}

function sugarSkull(ctx: PaintContext, f: FaceFrame, colors: string[]): void {
  const E = f.eyeSpan;
  const base = c(colors, 0, '#f4f0e8');
  const petal = c(colors, 1, '#e0409a');
  const ink = c(colors, 2, '#161616');

  hard(ctx);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, f.size, f.size);

  // Eye sockets: petal rosette → black socket → dot ring.
  for (const s of SIDES) {
    const eye = eyeCentre(f, s);
    const R = E * 0.27;
    ctx.fillStyle = petal;
    soft(ctx, petal, edge(f, 0.5));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ellipseAt(ctx, { x: eye.x + Math.cos(a) * R, y: eye.y + Math.sin(a) * R * 0.9 }, E * 0.075, E * 0.04, a);
      ctx.fill();
    }
    soft(ctx, ink, edge(f, 0.6));
    ctx.fillStyle = ink;
    ellipseAt(ctx, eye, R * 0.86, R * 0.74);
    ctx.fill();
    hard(ctx);
    ctx.fillStyle = base;
    for (let i = 0; i < 12; i++) {
      const a = ((i + 0.5) / 12) * Math.PI * 2;
      dot(ctx, { x: eye.x + Math.cos(a) * R * 1.02, y: eye.y + Math.sin(a) * R * 0.92 }, E * 0.012);
      ctx.fill();
    }
    ctx.fillStyle = ink;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      dot(ctx, { x: eye.x + Math.cos(a) * R * 1.38, y: eye.y + Math.sin(a) * R * 1.22 }, E * 0.01);
      ctx.fill();
    }
  }

  // Nose: an upside-down heart.
  soft(ctx, ink, edge(f, 0.5));
  ctx.fillStyle = ink;
  withTransform(ctx, lerpPt(f.noseTip, f.noseBridge, 0.12), Math.PI, () => {
    heartPath(ctx, E * 0.075);
    ctx.fill();
  });

  // Stitched mouth, running past the corners.
  hard(ctx);
  ctx.strokeStyle = ink;
  ctx.lineCap = 'round';
  ctx.lineWidth = E * 0.016;
  const mL = { x: f.mouthL.x - E * 0.12, y: f.mouthL.y + E * 0.02 };
  const mR = { x: f.mouthR.x + E * 0.12, y: f.mouthR.y + E * 0.02 };
  const mC = lerpPt(f.mouthTop, f.mouthBottom, 0.5);
  ctx.beginPath();
  ctx.moveTo(mL.x, mL.y);
  ctx.quadraticCurveTo(mC.x, mC.y, mR.x, mR.y);
  ctx.stroke();
  ctx.lineWidth = E * 0.011;
  for (let i = 0; i <= 9; i++) {
    const t = i / 9;
    // Point on the quadratic, then a short vertical tick across it.
    const x = (1 - t) * (1 - t) * mL.x + 2 * (1 - t) * t * mC.x + t * t * mR.x;
    const y = (1 - t) * (1 - t) * mL.y + 2 * (1 - t) * t * mC.y + t * t * mR.y;
    const half = E * (0.045 + 0.03 * Math.sin(Math.PI * t));
    ctx.beginPath();
    ctx.moveTo(x, y - half);
    ctx.lineTo(x, y + half);
    ctx.stroke();
  }

  // Forehead flower + swirls.
  const fc = lerpPt(f.browMid, f.foreheadMid, 0.62);
  ctx.fillStyle = petal;
  soft(ctx, petal, edge(f, 0.5));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    ellipseAt(ctx, { x: fc.x + Math.cos(a) * E * 0.075, y: fc.y + Math.sin(a) * E * 0.075 }, E * 0.06, E * 0.032, a);
    ctx.fill();
  }
  hard(ctx);
  ctx.fillStyle = ink;
  dot(ctx, fc, E * 0.035);
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = E * 0.014;
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(fc.x + sgn * E * 0.16, fc.y + E * 0.02);
    ctx.bezierCurveTo(fc.x + sgn * E * 0.3, fc.y - E * 0.12, fc.x + sgn * E * 0.42, fc.y + E * 0.06, fc.x + sgn * E * 0.34, fc.y + E * 0.1);
    ctx.bezierCurveTo(fc.x + sgn * E * 0.28, fc.y + E * 0.13, fc.x + sgn * E * 0.27, fc.y + E * 0.05, fc.x + sgn * E * 0.31, fc.y + E * 0.05);
    ctx.stroke();
    for (const t of [0.2, 0.45, 0.7]) {
      dot(ctx, { x: fc.x + sgn * E * (0.12 + t * 0.32), y: fc.y - E * (0.14 + 0.05 * Math.sin(t * 3)) }, E * 0.011);
      ctx.fill();
    }
  }

  // Cheek curls + dot trails, chin motif.
  for (const s of SIDES) {
    const k = sided(f, s);
    const cc = lerpPt(k.cheekbone, k.cheekLow, 0.45);
    const o = k.out;
    ctx.strokeStyle = ink;
    ctx.lineWidth = E * 0.014;
    ctx.beginPath();
    ctx.moveTo(cc.x - o * E * 0.12, cc.y - E * 0.06);
    ctx.bezierCurveTo(cc.x + o * E * 0.05, cc.y - E * 0.14, cc.x + o * E * 0.14, cc.y + E * 0.04, cc.x + o * E * 0.02, cc.y + E * 0.06);
    ctx.bezierCurveTo(cc.x - o * E * 0.04, cc.y + E * 0.07, cc.x - o * E * 0.05, cc.y, cc.x, cc.y);
    ctx.stroke();
    ctx.fillStyle = petal;
    for (let i = 0; i < 4; i++) {
      dot(ctx, { x: cc.x - o * E * (0.06 + i * 0.045), y: cc.y + E * (0.1 + i * 0.03) }, E * (0.02 - i * 0.003));
      ctx.fill();
    }
  }
  ctx.fillStyle = petal;
  withTransform(ctx, lerpPt(f.mouthBottom, f.chin, 0.55), 0, () => {
    heartPath(ctx, E * 0.045);
    ctx.fill();
  });
}

/* ── Christmas set ───────────────────────────────────────────────────── */
// Fixed festive hexes, not the event accent: a candy cane is red and white,
// Rudolph's nose is red, whatever the event's brand colour is. Hosts can still
// recolour every slot.

/** Point at arc-length fraction t of a sampled polyline (+ its index). */
function along(pts: Pt[], L: number[], t: number): { p: Pt; i: number } {
  const target = t * L[L.length - 1];
  let i = 1;
  while (i < L.length - 1 && L[i] < target) i++;
  const seg = L[i] - L[i - 1] || 1;
  return { p: lerpPt(pts[i - 1], pts[i], (target - L[i - 1]) / seg), i };
}

/** Offset a polyline sideways by `d` px (left of travel = +). */
function offsetPts(pts: Pt[], d: number | ((t: number) => number)): Pt[] {
  const N = polyNormals(pts);
  return pts.map((p, i) => {
    const k = typeof d === 'number' ? d : d(i / (pts.length - 1));
    return { x: p.x + N[i].x * k, y: p.y + N[i].y * k };
  });
}

/**
 * Continue a polyline into a circular curl of radius `r` that bends toward
 * `side` (a point the curl should turn toward), `turns` of a full circle.
 * Returns the extra points (without the shared first one) and the centre.
 */
function curlFrom(pts: Pt[], r: number, toward: Pt, turns: number, n = 24): { pts: Pt[]; centre: Pt } {
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const h = Math.atan2(last.y - prev.y, last.x - prev.x);
  const c1 = { x: last.x + Math.cos(h + Math.PI / 2) * r, y: last.y + Math.sin(h + Math.PI / 2) * r };
  const c2 = { x: last.x + Math.cos(h - Math.PI / 2) * r, y: last.y + Math.sin(h - Math.PI / 2) * r };
  const d = (q: Pt) => Math.hypot(q.x - toward.x, q.y - toward.y);
  const centre = d(c1) < d(c2) ? c1 : c2;
  const a0 = Math.atan2(last.y - centre.y, last.x - centre.x);
  // Travel direction that continues the heading.
  const dir: 1 | -1 = -Math.sin(a0) * Math.cos(h) + Math.cos(a0) * Math.sin(h) >= 0 ? 1 : -1;
  return { pts: spiralPts(centre, r, r, a0, turns, dir, n).slice(1), centre };
}

function candyCane(ctx: PaintContext, f: FaceFrame, colors: string[]): void {
  const E = f.eyeSpan;
  const red = c(colors, 0, '#d4141f');
  const white = c(colors, 1, '#fbf8f3');
  const W = E * 0.1;
  for (const s of SIDES) {
    const k = sided(f, s);
    // A cane lying along the cheekbone: the shaft runs from the apple of the
    // cheek outward under the eye, then hooks up toward the temple.
    const inner = { x: lerpPt(k.underEye, k.cheek, 0.5).x - k.out * E * 0.11, y: lerpPt(k.underEye, k.cheek, 0.5).y + E * 0.02 };
    const outer = { x: lerpPt(k.side, k.eyeOuter, 0.6).x, y: lerpPt(k.side, k.eyeOuter, 0.6).y + E * 0.06 };
    const mid = { x: lerpPt(inner, outer, 0.5).x, y: lerpPt(inner, outer, 0.5).y + E * 0.06 };
    const shaft = quadPts(inner, mid, outer, 30);
    const hook = curlFrom(shaft, E * 0.08, { x: outer.x, y: outer.y - E }, 0.58, 18);
    const pts = [...shaft, ...hook.pts];
    const L = arcLengths(pts);
    const len = L[L.length - 1];
    const N = polyNormals(pts);
    const prof = roundEnds(W);

    // Candy body: white, with a soft same-colour pigment edge.
    soft(ctx, white, edge(f, 0.7));
    ctx.fillStyle = white;
    ribbonPath(ctx, pts, prof);
    ctx.fill();
    hard(ctx);

    // Slanted red stripes, clipped to the body so the edge stays clean.
    ctx.save();
    ribbonPath(ctx, pts, prof);
    ctx.clip();
    ctx.fillStyle = red;
    ctx.strokeStyle = red;
    const pitch = W * 1.35;
    const n = Math.ceil(len / pitch) + 2;
    // Stripes are built from points ON the two band edges, offset along the
    // arc (not along a local normal), so they wrap cleanly round the hook.
    const sk = W * 0.5;
    const h = W * 0.62;
    const edgePt = (sArc: number, side: 1 | -1): Pt => {
      const q = along(pts, L, Math.max(0, Math.min(1, sArc / len)));
      return { x: q.p.x + N[q.i].x * h * side, y: q.p.y + N[q.i].y * h * side };
    };
    const band = (s0: number, s1: number) => {
      ctx.beginPath();
      const steps = 4;
      for (let j = 0; j <= steps; j++) {
        const e = edgePt(s0 + sk + ((s1 - s0) * j) / steps, 1);
        if (j === 0) ctx.moveTo(e.x, e.y);
        else ctx.lineTo(e.x, e.y);
      }
      for (let j = steps; j >= 0; j--) {
        const e = edgePt(s0 - sk + ((s1 - s0) * j) / steps, -1);
        ctx.lineTo(e.x, e.y);
      }
      ctx.closePath();
      ctx.fill();
    };
    for (let i = -2; i < n; i++) {
      band(i * pitch, i * pitch + pitch * 0.42);
      // A thin pinstripe beside every main stripe — the confectioner's detail.
      band(i * pitch + pitch * 0.66, i * pitch + pitch * 0.74);
    }
    // Rounded-tube shading: a darker band along the lower edge.
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#5a0a10';
    // Normals point UP on the left cane and DOWN on the right (travel is outward).
    ribbonPath(ctx, offsetPts(pts, k.out * W * 0.32), (t, sArc, l) => prof(t, sArc, l) * 0.42);
    ctx.fill();
    ctx.restore();

    // Gloss: a long specular streak riding the upper edge, plus a hot spot.
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#ffffff';
    const hi = offsetPts(pts.slice(3, 28), -k.out * W * 0.22);
    ribbonPath(ctx, hi, (t) => W * 0.16 * Math.sin(Math.PI * t));
    ctx.fill();
    ctx.globalAlpha = 1;
    dot(ctx, offsetPts([pts[8], pts[9], pts[10]], -k.out * W * 0.24)[1], W * 0.07);
    ctx.fill();
    ctx.restore();
  }
  hard(ctx);
}

function rudolph(ctx: PaintContext, f: FaceFrame, colors: string[]): void {
  const E = f.eyeSpan;
  const nose = c(colors, 0, '#d0101c');
  const blush = c(colors, 1, '#e5566b');
  const freckle = c(colors, 2, '#7b4a2f');
  const rand = rng(0x2ed0);

  // Rosy cheeks: wide, sponge-soft.
  for (const s of SIDES) {
    const k = sided(f, s);
    softBlob(ctx, lerpPt(k.cheek, k.cheekbone, 0.3), E * 0.17, E * 0.12, blush, 0.55, 10, -k.out * 0.25);
  }
  // Freckles: across the nose bridge and onto both cheeks.
  hard(ctx);
  ctx.save();
  ctx.fillStyle = freckle;
  const spots: Pt[] = [];
  for (const s of SIDES) {
    const k = sided(f, s);
    const cc = lerpPt(k.cheek, k.underEye, 0.45);
    for (let i = 0; i < 16; i++) {
      spots.push({ x: cc.x + (rand() - 0.5) * E * 0.24, y: cc.y + (rand() - 0.5) * E * 0.13 });
    }
  }
  const bridge = lerpPt(f.noseBridge, f.noseTip, 0.5);
  for (let i = 0; i < 8; i++) spots.push({ x: bridge.x + (rand() - 0.5) * E * 0.2, y: bridge.y + (rand() - 0.5) * E * 0.07 });
  for (const p of spots) {
    ctx.globalAlpha = 0.45 + rand() * 0.35;
    dot(ctx, p, E * (0.005 + rand() * 0.006));
    ctx.fill();
  }
  ctx.restore();

  // The nose: a glow, a shaded ball and a glossy highlight.
  const r = E * 0.115;
  const at = lerpPt(f.noseTip, f.noseBridge, 0.06);
  softBlob(ctx, at, r * 1.75, r * 1.6, nose, 0.35, 10);
  soft(ctx, nose, edge(f, 0.8));
  ctx.fillStyle = nose;
  dot(ctx, at, r);
  ctx.fill();
  hard(ctx);
  // Shadow side (lower right) → lit side (upper left), built from layers.
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#4a0006';
  ellipseAt(ctx, { x: at.x + r * 0.22, y: at.y + r * 0.3 }, r * 0.82, r * 0.7);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.fillStyle = '#ff5a52';
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 4; i++) {
    dot(ctx, { x: at.x - r * 0.18, y: at.y - r * 0.2 }, r * (0.7 - i * 0.14));
    ctx.fill();
  }
  ctx.restore();
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.92;
  ellipseAt(ctx, { x: at.x - r * 0.36, y: at.y - r * 0.42 }, r * 0.26, r * 0.15, -0.6);
  ctx.fill();
  ctx.globalAlpha = 0.7;
  dot(ctx, { x: at.x - r * 0.05, y: at.y - r * 0.58 }, r * 0.06);
  ctx.fill();
  ctx.globalAlpha = 0.35;
  ellipseAt(ctx, { x: at.x + r * 0.42, y: at.y + r * 0.45 }, r * 0.18, r * 0.07, -0.8);
  ctx.fill();
  ctx.restore();
}

/** One painted snowflake: an icy glow pass, then the crisp white crystal. */
function snowflakeAt(ctx: PaintContext, f: FaceFrame, at: Pt, r: number, rot: number, white: string, frost: string, branches = 2): void {
  withTransform(ctx, at, rot, () => {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    soft(ctx, frost, edge(f, 1.6));
    ctx.strokeStyle = frost;
    ctx.lineWidth = r * 0.16;
    snowflakePath(ctx, r, branches);
    ctx.stroke();
    hard(ctx);
    ctx.strokeStyle = white;
    ctx.lineWidth = r * 0.075;
    snowflakePath(ctx, r, branches);
    ctx.stroke();
    ctx.fillStyle = white;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 3;
      const x = Math.cos(a) * r * 0.16;
      const y = Math.sin(a) * r * 0.16;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  });
}

/** Frosty glitter: seeded flecks inside an ellipse, every third with a white core. */
function frostGlitter(ctx: PaintContext, f: FaceFrame, centre: Pt, rx: number, ry: number, n: number, palette: string[], seed: number): void {
  const rand = rng(seed);
  const E = f.eyeSpan;
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand());
    const at = { x: centre.x + Math.cos(a) * rx * d, y: centre.y + Math.sin(a) * ry * d };
    const r = E * (0.004 + rand() * 0.008);
    const col = palette[Math.floor(rand() * palette.length) % palette.length];
    soft(ctx, col, edge(f, 0.3));
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.55 + rand() * 0.45;
    dot(ctx, at, r);
    ctx.fill();
    if (i % 3 === 0) {
      hard(ctx);
      ctx.fillStyle = '#ffffff';
      dot(ctx, at, r * 0.45);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  hard(ctx);
}

function snowflakes(ctx: PaintContext, f: FaceFrame, colors: string[]): void {
  const E = f.eyeSpan;
  const white = c(colors, 0, '#ffffff');
  const frost = c(colors, 1, '#7cc6f2');
  const glitter = c(colors, 2, '#cfeaff');
  const R = sided(f, 'R');
  const L = sided(f, 'L');
  // A drift of frost glitter first, so the flakes sit crisp on top of it.
  frostGlitter(ctx, f, lerpPt(R.cheekbone, R.underEye, 0.4), E * 0.2, E * 0.12, 70, [glitter, white, frost], 0x5f1a);
  const flakes: { at: Pt; r: number; rot: number; b: number }[] = [
    { at: lerpPt(R.eyeOuter, R.cheekbone, 0.55), r: E * 0.15, rot: 0.12, b: 2 },
    { at: lerpPt(R.browOuter, R.temple, 0.45), r: E * 0.085, rot: -0.2, b: 2 },
    { at: lerpPt(lerpPt(R.eyeOuter, R.side, 0.55), R.temple, 0.15), r: E * 0.06, rot: 0.3, b: 1 },
    { at: lerpPt(R.cheekbone, R.cheekLow, 0.6), r: E * 0.05, rot: -0.1, b: 1 },
    { at: lerpPt(L.eyeOuter, L.underEye, 0.7), r: E * 0.045, rot: 0.25, b: 1 },
  ];
  for (const fl of flakes) snowflakeAt(ctx, f, fl.at, fl.r, fl.rot, white, frost, fl.b);
  // Four-point glints.
  ctx.fillStyle = '#ffffff';
  const rand = rng(0x5f1c);
  for (let i = 0; i < 5; i++) {
    const p = lerpPt(lerpPt(R.eyeOuter, R.cheekbone, 0.5), R.temple, rand() * 0.8);
    withTransform(ctx, { x: p.x + (rand() - 0.5) * E * 0.14, y: p.y + (rand() - 0.5) * E * 0.14 }, 0, () => {
      starPath(ctx, E * (0.018 + rand() * 0.014), E * 0.004, 4);
      ctx.fill();
    });
  }
}

function frostQueen(ctx: PaintContext, f: FaceFrame, colors: string[]): void {
  const E = f.eyeSpan;
  const ice = c(colors, 0, '#5fb8f0');
  const frost = c(colors, 1, '#ffffff');
  const crystal = c(colors, 2, '#bfe8ff');
  for (const s of SIDES) {
    const k = sided(f, s);
    const o = k.out;
    const corner = k.eyeOuter;
    // Frost wash fanning from the outer corner up to the temple.
    softBlob(ctx, lerpPt(corner, k.browOuter, 0.5), E * 0.17, E * 0.1, ice, 0.55, 10, -o * 0.6);
    softBlob(ctx, lerpPt(k.browOuter, k.temple, 0.35), E * 0.12, E * 0.08, crystal, 0.4, 8, -o * 0.5);

    // Three swirls born at the outer corner, fanning out like frost ferns:
    // up past the brow tail to the temple, out to the hairline, down the cheekbone.
    const swirls: { to: Pt; c1: Pt; c2: Pt; r: number; w: number; toward: Pt }[] = [
      {
        to: { x: k.browOuter.x + o * E * 0.1, y: k.browOuter.y - E * 0.2 },
        c1: { x: corner.x + o * E * 0.12, y: corner.y - E * 0.02 },
        c2: { x: k.browOuter.x + o * E * 0.15, y: k.browOuter.y - E * 0.04 },
        r: E * 0.05, w: 0.064, toward: k.brow,
      },
      {
        to: { x: corner.x + o * E * 0.3, y: corner.y - E * 0.1 },
        c1: { x: corner.x + o * E * 0.12, y: corner.y + E * 0.04 },
        c2: { x: corner.x + o * E * 0.24, y: corner.y + E * 0.02 },
        r: E * 0.04, w: 0.052, toward: k.temple,
      },
      {
        to: { x: corner.x + o * E * 0.12, y: corner.y + E * 0.2 },
        c1: { x: corner.x + o * E * 0.06, y: corner.y + E * 0.05 },
        c2: { x: corner.x + o * E * 0.2, y: corner.y + E * 0.1 },
        r: E * 0.034, w: 0.044, toward: k.eyeBot,
      },
    ];
    const start = { x: corner.x + o * E * 0.015, y: corner.y + E * 0.005 };
    const centres: Pt[] = [];
    for (const sw of swirls) {
      const arc = cubicPts(start, sw.c1, sw.c2, sw.to, 30);
      const curl = curlFrom(arc, sw.r, sw.toward, 0.85, 22);
      centres.push(curl.centre);
      const path = [...arc, ...spiralTighten(curl.pts, curl.centre)];
      const taper = (t: number) => E * sw.w * (0.18 + 0.82 * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95)) ** 0.7);
      soft(ctx, ice, edge(f, 1.6));
      ctx.fillStyle = ice;
      ribbonPath(ctx, path, taper);
      ctx.fill();
      hard(ctx);
      // Frost core: a bright inner line.
      ctx.fillStyle = frost;
      ribbonPath(ctx, path, (t) => taper(t) * 0.36);
      ctx.fill();
    }
    // Icicle flicks off the upper swirl.
    for (const [t, len, ang] of [[0.35, 0.06, -0.5], [0.55, 0.08, -0.9], [0.75, 0.05, -1.3]] as [number, number, number][]) {
      const arc = cubicPts(start, swirls[0].c1, swirls[0].c2, swirls[0].to, 30);
      const p = arc[Math.round(t * 30)];
      soft(ctx, ice, edge(f, 0.5));
      ctx.fillStyle = ice;
      taperPath(ctx, p, { x: p.x + o * Math.cos(ang) * E * len, y: p.y + Math.sin(ang) * E * len }, E * 0.018, 0.12 * o);
      ctx.fill();
    }
    hard(ctx);
    // Crystals: a few rhinestones along the lash line, a jewel in each curl.
    const lash = quadPts(lerpPt(k.eyeBot, corner, 0.55), { x: corner.x - o * E * 0.005, y: corner.y + E * 0.04 }, start, 4);
    lash.forEach((p, i) => rhinestone(ctx, f, p, E * (0.007 + i * 0.002), crystal, ice));
    centres.forEach((cc, i) => rhinestone(ctx, f, cc, E * (0.016 - i * 0.003), crystal, ice));
    // Shimmer.
    frostGlitter(ctx, f, lerpPt(corner, k.browOuter, 0.6), E * 0.2, E * 0.16, 44, [frost, crystal], s === 'L' ? 0xf20a : 0xf20b);
    snowflakeAt(ctx, f, { x: k.temple.x - o * E * 0.02, y: k.browOuter.y - E * 0.21 }, E * 0.05, o * 0.2, frost, ice, 1);
  }
}

/** Pull a circular curl inward as it winds, so it reads as a hand-painted spiral. */
function spiralTighten(pts: Pt[], centre: Pt): Pt[] {
  return pts.map((p, i) => lerpPt(p, centre, (0.55 * i) / Math.max(1, pts.length - 1)));
}

/** A faceted crystal: pale fill, an icy rim and a white catch-light. */
function rhinestone(ctx: PaintContext, f: FaceFrame, p: Pt, r: number, fill: string, rim: string): void {
  soft(ctx, fill, edge(f, 0.6));
  ctx.fillStyle = fill;
  dot(ctx, p, r);
  ctx.fill();
  hard(ctx);
  ctx.strokeStyle = rim;
  ctx.lineWidth = r * 0.3;
  dot(ctx, p, r);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  dot(ctx, { x: p.x - r * 0.3, y: p.y - r * 0.3 }, r * 0.38);
  ctx.fill();
}

/** Raised royal-icing line: a cast shadow, the icing, then a wet highlight. */
function pipe(ctx: PaintContext, pts: Pt[], w: number, icing: string, closed = false): void {
  const path = closed ? [...pts, pts[0]] : pts;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.translate(0, w * 0.3);
  ctx.strokeStyle = 'rgba(60,25,5,0.4)';
  ctx.lineWidth = w * 1.15;
  polylinePath(ctx, path);
  ctx.stroke();
  ctx.translate(0, -w * 0.3);
  ctx.strokeStyle = icing;
  ctx.lineWidth = w;
  polylinePath(ctx, path);
  ctx.stroke();
  ctx.translate(-w * 0.12, -w * 0.16);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = w * 0.3;
  polylinePath(ctx, path);
  ctx.stroke();
  ctx.restore();
}

/** Icing squiggle: a polyline wiggled sideways with `waves` full periods. */
function squiggle(pts: Pt[], amp: number, waves: number): Pt[] {
  const L = arcLengths(pts);
  const len = L[L.length - 1] || 1;
  const N = polyNormals(pts);
  return pts.map((p, i) => {
    const k = amp * Math.sin((L[i] / len) * waves * Math.PI * 2);
    return { x: p.x + N[i].x * k, y: p.y + N[i].y * k };
  });
}

/** Closed Catmull-Rom loop through `ctrl`, `per` samples a span. */
function loopPts(ctrl: Pt[], per = 16): Pt[] {
  const out: Pt[] = [];
  const n = ctrl.length;
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    for (let j = 0; j < per; j++) {
      const t = j / per, t2 = t * t, t3 = t2 * t;
      const cr = (a: number, b: number, cc: number, d: number) =>
        0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
      out.push({ x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  return out;
}

function gingerbread(ctx: PaintContext, f: FaceFrame, colors: string[]): void {
  const E = f.eyeSpan;
  const cookie = c(colors, 0, '#b4692e');
  const icing = c(colors, 1, '#fffaf2');
  const candy = c(colors, 2, '#d4141f');
  hard(ctx);
  ctx.fillStyle = cookie;
  ctx.fillRect(0, 0, f.size, f.size);
  // Baked toast: a slightly darker rim toward the edge, lighter centre.
  // ry stays under the forehead-to-texture-top distance: at 1.05 the top of
  // the ellipse left the texture (the transform-aware bounds test).
  softBlob(ctx, lerpPt(f.noseBridge, f.noseTip, 0.4), E * 0.95, E * 0.88, '#e3a064', 0.35, 10);

  // Piped icing border just inside the face edge.
  const centre = lerpPt(f.noseBridge, f.noseTip, 0.5);
  const ring = [f.foreheadMid, f.templeR, f.sideR, f.jawR, f.chinR, f.chin, f.chinL, f.jawL, f.sideL, f.templeL]
    .map((p, i) => lerpPt(p, centre, i === 0 ? 0.08 : i === 5 ? 0.1 : 0.16));
  const loop = loopPts(ring, 18);
  pipe(ctx, squiggle([...loop, loop[0]], E * 0.024, 44), E * 0.03, icing);

  // Candy cheeks: a red sugar disc ringed with icing dots.
  for (const s of SIDES) {
    const k = sided(f, s);
    const at = lerpPt(k.cheek, k.cheekbone, 0.25);
    const r = E * 0.085;
    softBlob(ctx, at, r * 1.05, r * 1.05, candy, 1.1, 9);
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.55;
    ellipseAt(ctx, { x: at.x - r * 0.35, y: at.y - r * 0.4 }, r * 0.28, r * 0.14, -0.6);
    ctx.fill();
    ctx.restore();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const p = { x: at.x + Math.cos(a) * r * 1.38, y: at.y + Math.sin(a) * r * 1.38 };
      pipeDot(ctx, p, E * 0.013, icing);
    }
  }

  // Iced smile: a scalloped line just below the lower lip.
  const sm = quadPts(
    { x: f.mouthL.x - E * 0.05, y: f.mouthL.y + E * 0.02 },
    { x: f.mouthBottom.x, y: f.mouthBottom.y + E * 0.19 },
    { x: f.mouthR.x + E * 0.05, y: f.mouthR.y + E * 0.02 },
    30,
  );
  pipe(ctx, squiggle(sm, E * 0.01, 7), E * 0.018, icing);

  // Icing dimples at the smile's ends, and a peppermint on the forehead.
  pipeDot(ctx, sm[0], E * 0.016, icing);
  pipeDot(ctx, sm[sm.length - 1], E * 0.016, icing);
  peppermint(ctx, f, lerpPt(f.browMid, f.foreheadMid, 0.55), E * 0.075, candy, icing);
  // Icing dots flanking the peppermint.
  for (const sgn of [-1, 1]) {
    for (let i = 1; i <= 3; i++) {
      pipeDot(ctx, { x: lerpPt(f.browMid, f.foreheadMid, 0.55).x + sgn * E * (0.08 + i * 0.055), y: lerpPt(f.browMid, f.foreheadMid, 0.55).y + E * 0.01 * i }, E * (0.014 - i * 0.002), icing);
    }
  }
}

/** A raised icing dot. */
function pipeDot(ctx: PaintContext, p: Pt, r: number, icing: string): void {
  ctx.fillStyle = 'rgba(60,25,5,0.4)';
  dot(ctx, { x: p.x, y: p.y + r * 0.4 }, r * 1.05);
  ctx.fill();
  ctx.fillStyle = icing;
  dot(ctx, p, r);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  dot(ctx, { x: p.x - r * 0.3, y: p.y - r * 0.35 }, r * 0.35);
  ctx.fill();
}

function gumdrop(ctx: PaintContext, f: FaceFrame, p: Pt, r: number, col: string): void {
  soft(ctx, col, edge(f, 0.6));
  ctx.fillStyle = col;
  ellipseAt(ctx, p, r, r * 0.85);
  ctx.fill();
  hard(ctx);
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = '#ffffff';
  ellipseAt(ctx, { x: p.x - r * 0.3, y: p.y - r * 0.35 }, r * 0.3, r * 0.16, -0.5);
  ctx.fill();
  ctx.restore();
}

function peppermint(ctx: PaintContext, f: FaceFrame, p: Pt, r: number, red: string, white: string): void {
  soft(ctx, white, edge(f, 0.8));
  ctx.fillStyle = white;
  dot(ctx, p, r);
  ctx.fill();
  hard(ctx);
  // Pinwheel: six curved red vanes.
  ctx.fillStyle = red;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const b = a + Math.PI / 6;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.quadraticCurveTo(p.x + Math.cos(a + 0.35) * r * 0.75, p.y + Math.sin(a + 0.35) * r * 0.75, p.x + Math.cos(a) * r * 0.94, p.y + Math.sin(a) * r * 0.94);
    ctx.arc(p.x, p.y, r * 0.94, a, b);
    ctx.quadraticCurveTo(p.x + Math.cos(b + 0.35) * r * 0.75, p.y + Math.sin(b + 0.35) * r * 0.75, p.x, p.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(80,0,8,0.35)';
  ctx.lineWidth = r * 0.06;
  dot(ctx, p, r * 0.97);
  ctx.stroke();
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.8;
  ellipseAt(ctx, { x: p.x - r * 0.38, y: p.y - r * 0.42 }, r * 0.3, r * 0.12, -0.7);
  ctx.fill();
  ctx.restore();
  // A holly sprig tucked behind the mint.
  for (const [rot, dx] of [[-0.5, -1], [0.5, 1]] as [number, number][]) {
    withTransform(ctx, { x: p.x + dx * r * 1.25, y: p.y - r * 0.55 }, rot + (dx < 0 ? Math.PI : 0), () => {
      soft(ctx, '#1f6b3a', edge(f, 0.5));
      ctx.fillStyle = '#2a7a44';
      hollyLeafPath(ctx, r * 0.7, r * 0.32);
      ctx.fill();
      hard(ctx);
      ctx.strokeStyle = 'rgba(200,255,210,0.5)';
      ctx.lineWidth = r * 0.05;
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, 0);
      ctx.lineTo(r * 0.6, 0);
      ctx.stroke();
    });
  }
  for (const [dx, dy] of [[-0.18, -1.05], [0.16, -1.1], [0, -0.92]]) {
    gumdrop(ctx, f, { x: p.x + dx * r, y: p.y + dy * r }, r * 0.17, red);
  }
}

/* ── helpers for the second wave ───────────────────────────────────────── */

type Seg = [Pt, Pt, Pt, Pt];

function cubicPt([p0, p1, p2, p3]: Seg, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, cc = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + cc * p2.x + d * p3.x, y: a * p0.y + b * p1.y + cc * p2.y + d * p3.y };
}

function quadPt(a: Pt, ctrl: Pt, b: Pt, t: number): Pt {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * ctrl.x + t * t * b.x, y: u * u * a.y + 2 * u * t * ctrl.y + t * t * b.y };
}

/** A closed shape made of cubic segments (each starts where the last ended). */
function segPath(ctx: PaintContext, segs: Seg[]): void {
  ctx.beginPath();
  ctx.moveTo(segs[0][0].x, segs[0][0].y);
  for (const [, c1, c2, p3] of segs) ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p3.x, p3.y);
  ctx.closePath();
}

/** A four-point glint (the light catching glitter). */
function glint(ctx: PaintContext, at: Pt, r: number, rot = 0): void {
  withTransform(ctx, at, rot, () => {
    starPath(ctx, r, r * 0.2, 4);
    ctx.fill();
  });
}

/** Soft, translucent wash — blush, frost, a muzzle hint. Leaves alpha at 1. */
function wash(ctx: PaintContext, f: FaceFrame, color: string, alpha: number, blur: number, shape: () => void): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  soft(ctx, color, edge(f, blur));
  shape();
  ctx.restore();
  hard(ctx);
}

/* ── everyday, round two ───────────────────────────────────────────────── */

function butterfly(ctx: PaintContext, f: FaceFrame, colors: string[]): void {
  const E = f.eyeSpan;
  const wing = c(colors, 0, '#d4a017');
  const inner = c(colors, 1, '#f3d47a');
  const ink = c(colors, 2, '#161616');
  const C = lerpPt(f.noseBridge, f.browMid, 0.3);
  const P = (o: number, dx: number, dy: number): Pt => ({ x: C.x + o * dx * E, y: C.y + dy * E });

  for (const s of SIDES) {
    const o = sided(f, s).out;
    const upper: Seg[] = [
      [P(o, 0, 0), P(o, 0.1, -0.35), P(o, 0.55, -0.55), P(o, 0.78, -0.2)],
      [P(o, 0.78, -0.2), P(o, 0.92, 0.05), P(o, 0.75, 0.25), P(o, 0.45, 0.24)],
      [P(o, 0.45, 0.24), P(o, 0.25, 0.23), P(o, 0.08, 0.16), P(o, 0, 0.12)],
    ];
    const lower: Seg[] = [
      [P(o, 0, 0.12), P(o, 0.3, 0.17), P(o, 0.64, 0.22), P(o, 0.56, 0.5)],
      [P(o, 0.56, 0.5), P(o, 0.48, 0.7), P(o, 0.16, 0.56), P(o, 0.05, 0.3)],
    ];
    for (const segs of [upper, lower]) {
      // Base colour, then a lighter inner panel (the same wing, shrunk toward its middle).
      soft(ctx, wing, edge(f, 0.6));
      ctx.fillStyle = wing;
      segPath(ctx, segs);
      ctx.fill();
      hard(ctx);
      const mid = cubicPt(segs[0], 1);
      const centre = lerpPt(C, mid, 0.55);
      ctx.save();
      ctx.translate(centre.x, centre.y);
      ctx.scale(0.58, 0.58);
      ctx.translate(-centre.x, -centre.y);
      ctx.fillStyle = inner;
      segPath(ctx, segs);
      ctx.fill();
      ctx.restore();
      // Outline + veins.
      ctx.strokeStyle = ink;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = E * 0.02;
      segPath(ctx, segs);
      ctx.stroke();
      ctx.lineWidth = E * 0.01;
      for (const seg of segs.slice(0, segs.length - 1)) {
        for (const t of [0.35, 0.8]) {
          const p = cubicPt(seg, t);
          const q = lerpPt(C, p, 0.92);
          ctx.beginPath();
          ctx.moveTo(C.x, C.y + E * 0.05);
          ctx.quadraticCurveTo(lerpPt(C, q, 0.5).x, lerpPt(C, q, 0.5).y - E * 0.03, q.x, q.y);
          ctx.stroke();
        }
      }
      // White dots inside the border, monarch style.
      ctx.fillStyle = '#ffffff';
      for (const seg of segs.slice(0, segs.length - 1)) {
        for (const t of [0.2, 0.45, 0.7]) {
          dot(ctx, lerpPt(cubicPt(seg, t), C, 0.07), E * 0.011);
          ctx.fill();
        }
      }
    }
  }

  // Body down the bridge of the nose, head and antennae on the brow.
  ctx.fillStyle = ink;
  soft(ctx, ink, edge(f, 0.4));
  const head = { x: C.x, y: C.y - E * 0.13 };
  ellipseAt(ctx, { x: C.x, y: C.y + E * 0.08 }, E * 0.035, E * 0.19);
  ctx.fill();
  dot(ctx, head, E * 0.04);
  ctx.fill();
  hard(ctx);
  ctx.strokeStyle = ink;
  ctx.lineWidth = E * 0.012;
  ctx.lineCap = 'round';
  for (const o of [-1, 1]) {
    const end = { x: head.x + o * E * 0.16, y: head.y - E * 0.28 };
    ctx.beginPath();
    ctx.moveTo(head.x, head.y);
    ctx.quadraticCurveTo(head.x + o * E * 0.02, head.y - E * 0.24, end.x, end.y);
    ctx.stroke();
    dot(ctx, end, E * 0.022);
    ctx.fill();
  }
}

function heroMask(ctx: PaintContext, f: FaceFrame, colors: string[]): void {
  const E = f.eyeSpan;
  const mask = c(colors, 0, '#d4a017');
  const trim = c(colors, 1, '#ffffff');
  const top = { x: f.browMid.x, y: f.browMid.y + E * 0.12 };
  const P = (o: number, dx: number, dy: number): Pt => ({ x: top.x + o * dx * E, y: top.y + dy * E });
  // Left half top→tip→under-eye→bridge, then the right half back up.
  const half = (o: number): Seg[] => [
    [P(o, 0, 0), P(o, 0.15, -0.08), P(o, 0.35, -0.12), P(o, 0.55, -0.06)],
    [P(o, 0.55, -0.06), P(o, 0.7, -0.03), P(o, 0.8, -0.04), P(o, 0.88, 0.0)],
    [P(o, 0.88, 0.0), P(o, 0.8, 0.16), P(o, 0.64, 0.3), P(o, 0.4, 0.29)],
    [P(o, 0.4, 0.29), P(o, 0.22, 0.28), P(o, 0.1, 0.15), P(o, 0, 0.15)],
  ];
  const left = half(-1);
  const right = half(1).map(([a, b, cc, d]) => [d, cc, b, a] as Seg).reverse();
  const outline = (): void => {
    ctx.beginPath();
    ctx.moveTo(left[0][0].x, left[0][0].y);
    for (const [, c1, c2, p3] of [...left, ...right]) ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p3.x, p3.y);
    ctx.closePath();
    for (const s of SIDES) {
      const k = sided(f, s);
      const eye = eyeCentre(f, s);
      const rot = angleOf(k.eyeInner, k.eyeOuter) + (s === 'L' ? Math.PI : 0);
      ctx.moveTo(eye.x + Math.cos(rot) * E * 0.2, eye.y + Math.sin(rot) * E * 0.2);
      ctx.ellipse(eye.x, eye.y, E * 0.2, E * 0.095, rot, 0, Math.PI * 2);
    }
  };
  soft(ctx, mask, edge(f, 0.7));
  ctx.fillStyle = mask;
  outline();
  ctx.fill('evenodd');
  hard(ctx);
  ctx.strokeStyle = trim;
  ctx.lineWidth = E * 0.012;
  ctx.lineJoin = 'round';
  outline();
  ctx.stroke();
  // A painted shine across the top edge.
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = E * 0.018;
  ctx.lineCap = 'round';
  for (const o of [-1, 1]) {
    const a = P(o, 0.22, -0.035), b = P(o, 0.5, -0.03);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo((a.x + b.x) / 2, a.y - E * 0.025, b.x, b.y);
    ctx.stroke();
  }
}

const RAINBOW = ['#e63946', '#f4a261', '#f9d74a', '#52b788', '#4895ef', '#9b5de5'];

function rainbow(ctx: PaintContext, f: FaceFrame, colors: string[]): void {
  const E = f.eyeSpan;
  const cloud = c(colors, 0, '#ffffff');
  const sparkle = c(colors, 1, '#f3d47a');
  const R = sided(f, 'R');
  const centre = lerpPt(R.cheekbone, R.cheek, 0.45);
  const at = { x: centre.x, y: centre.y + E * 0.05 };
  const outerR = E * 0.25;
  const band = E * 0.027;
  withTransform(ctx, at, 0.18, () => {
    ctx.lineCap = 'butt';
    for (let i = 0; i < RAINBOW.length; i++) {
      ctx.strokeStyle = RAINBOW[i];
      soft(ctx, RAINBOW[i], edge(f, 0.3));
      ctx.lineWidth = band + 0.8;
      ctx.beginPath();
      ctx.arc(0, 0, outerR - band * (i + 0.5), Math.PI, Math.PI * 2);
      ctx.stroke();
    }
    hard(ctx);
    // A cloud at each foot, with a soft cool shadow.
    const footR = outerR - band * RAINBOW.length / 2;
    for (const sx of [-1, 1]) {
      const foot = { x: sx * footR, y: E * 0.012 };
      ctx.fillStyle = 'rgba(150,170,195,0.45)';
      withTransform(ctx, { x: foot.x, y: foot.y + E * 0.012 }, 0, () => {
        cloudPath(ctx, E * 0.09);
        ctx.fill();
      });
      soft(ctx, cloud, edge(f, 0.6));
      ctx.fillStyle = cloud;
      withTransform(ctx, foot, 0, () => {
        cloudPath(ctx, E * 0.09);
        ctx.fill();
      });
      hard(ctx);
    }
  });
  ctx.fillStyle = sparkle;
  glint(ctx, lerpPt(R.eyeOuter, R.temple, 0.4), E * 0.04, 0.1);
  glint(ctx, lerpPt(R.cheekbone, R.side, 0.4), E * 0.025);
  ctx.fillStyle = cloud;
  glint(ctx, lerpPt(R.underEye, R.eyeOuter, 0.2), E * 0.02, 0.3);
}

function lightningBolt(ctx: PaintContext, f: FaceFrame, colors: string[]): void {
  const E = f.eyeSpan;
  const bolt = c(colors, 0, '#e63946');
  const rim = c(colors, 1, '#4895ef');
  const shine = c(colors, 2, '#ffffff');
  const R = sided(f, 'R');
  const at = { x: eyeCentre(f, 'R').x, y: eyeCentre(f, 'R').y + E * 0.04 };
  const W = E * 0.46;
  const H = E * 0.92;
  // The rock-star bolt, unit coords (x across, y down), centred on the eye.
  const unit: [number, number][] = [[0.18, 0], [0.66, 0], [0.45, 0.37], [0.76, 0.37], [0.22, 1], [0.37, 0.53], [0.06, 0.53]];
  const pts = unit.map(([x, y]) => ({ x: (x - 0.42) * W, y: (y - 0.5) * H }));
  const shape = (grow: number) => {
    const cx = 0, cy = 0;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const k = 1 + grow;
      const x = cx + p.x * k, y = cy + p.y * k;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  };
  withTransform(ctx, at, R.out * 0.12, () => {
    ctx.lineJoin = 'round';
    // Coloured rim (the Aladdin Sane edge), then the bolt, then a shine stripe.
    soft(ctx, rim, edge(f, 0.6));
    ctx.fillStyle = rim;
    shape(0.09);
    ctx.fill();
    soft(ctx, bolt, edge(f, 0.4));
    ctx.fillStyle = bolt;
    shape(0);
    ctx.fill();
    hard(ctx);
    ctx.strokeStyle = shine;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = E * 0.014;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x + W * 0.1, pts[0].y + H * 0.05);
    ctx.lineTo(pts[6].x + W * 0.12, pts[6].y - H * 0.06);
    ctx.stroke();
    ctx.globalAlpha = 1;
  });
  ctx.fillStyle = shine;
  glint(ctx, lerpPt(R.eyeOuter, R.temple, 0.45), E * 0.035, 0.2);
  glint(ctx, lerpPt(R.cheekbone, R.cheek, 0.4), E * 0.022);
}

const PASTEL_MINT = '#a7f3d0';

function unicorn(ctx: PaintContext, f: FaceFrame, colors: string[]): void {
  const E = f.eyeSpan;
  const pink = c(colors, 0, '#f9a8d4');
  const lilac = c(colors, 1, '#c4b5fd');
  const star = c(colors, 2, '#f3d47a');
  // Pastel arcs framing the outer corner of each eye, ending in a curl.
  ctx.lineCap = 'round';
  for (const s of SIDES) {
    const k = sided(f, s);
    const eye = eyeCentre(f, s);
    const bands: [string, number][] = [[pink, 0.27], [lilac, 0.32], [PASTEL_MINT, 0.37]];
    for (const [col, rr] of bands) {
      const r = E * rr;
      soft(ctx, col, edge(f, 0.6));
      ctx.strokeStyle = col;
      ctx.lineWidth = E * 0.04;
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const th = (-95 + (i / 24) * 150) * (Math.PI / 180);
        const x = eye.x + k.out * Math.cos(th) * r;
        const y = eye.y + Math.sin(th) * r * 0.92;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // The curl at the bottom of the arcs, on the cheekbone.
    const th = 55 * (Math.PI / 180);
    const end = { x: eye.x + k.out * Math.cos(th) * E * 0.32, y: eye.y + Math.sin(th) * E * 0.32 * 0.92 };
    soft(ctx, lilac, edge(f, 0.5));
    ctx.strokeStyle = lilac;
    ctx.lineWidth = E * 0.022;
    ctx.beginPath();
    for (let i = 0; i <= 28; i++) {
      const t = i / 28;
      const a = Math.PI * 0.5 + t * Math.PI * 2.2;
      const rr = E * 0.07 * (1 - t * 0.8);
      const x = end.x - k.out * Math.cos(a) * rr + k.out * E * 0.02;
      const y = end.y + E * 0.07 + Math.sin(a) * rr - E * 0.07;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    hard(ctx);
    // Dotted glitter trail down the cheek.
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 4; i++) {
      dot(ctx, { x: end.x - k.out * E * (0.05 + i * 0.035), y: end.y + E * (0.1 + i * 0.03) }, E * (0.014 - i * 0.002));
      ctx.fill();
    }
  }
  // The forehead star (the horn's sparkle), with a white heart-light.
  const fc = lerpPt(f.browMid, f.foreheadMid, 0.55);
  soft(ctx, star, edge(f, 1.2));
  ctx.fillStyle = star;
  withTransform(ctx, fc, 0, () => {
    starPath(ctx, E * 0.11, E * 0.05);
    ctx.fill();
  });
  hard(ctx);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  dot(ctx, { x: fc.x - E * 0.02, y: fc.y - E * 0.02 }, E * 0.016);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  for (const [dx, dy, r] of [[-0.17, -0.06, 0.03], [0.16, 0.05, 0.025], [0.1, -0.12, 0.02]] as const) {
    glint(ctx, { x: fc.x + dx * E, y: fc.y + dy * E }, E * r);
  }
}

function cat(ctx: PaintContext, f: FaceFrame, colors: string[]): void {
  const E = f.eyeSpan;
  const ink = c(colors, 0, '#161616');
  const nose = c(colors, 1, '#f28fb0');
  const stripe = c(colors, 2, '#161616');

  // Cheek stripes: tapered strokes driven in from the sides. They start a
  // little inside the face edge, which the mesh layer feathers away.
  soft(ctx, stripe, edge(f, 0.4));
  ctx.fillStyle = stripe;
  for (const s of SIDES) {
    const k = sided(f, s);
    for (const [from, toward, len, w] of [
      [lerpPt(lerpPt(k.side, k.temple, 0.25), k.underEye, 0.22), k.underEye, 0.55, 0.065],
      [lerpPt(lerpPt(k.side, k.cheekLow, 0.2), k.cheek, 0.22), k.cheek, 0.5, 0.06],
    ] as [Pt, Pt, number, number][]) {
      taperPath(ctx, from, lerpPt(from, toward, len), E * w, 0.1 * k.out);
      ctx.fill();
    }
    // Cat-eye flick.
    taperPath(ctx, k.eyeOuter, { x: k.eyeOuter.x + k.out * E * 0.17, y: k.eyeOuter.y - E * 0.08 }, E * 0.04, 0);
    ctx.fill();
  }

  // Nose: a rounded inverted triangle on the tip, outlined.
  const nt = lerpPt(f.noseTip, f.mouthTop, 0.08);
  const noseShape = () => {
    ctx.beginPath();
    ctx.moveTo(nt.x - E * 0.08, nt.y - E * 0.045);
    ctx.quadraticCurveTo(nt.x, nt.y - E * 0.075, nt.x + E * 0.08, nt.y - E * 0.045);
    ctx.quadraticCurveTo(nt.x + E * 0.03, nt.y + E * 0.04, nt.x, nt.y + E * 0.05);
    ctx.quadraticCurveTo(nt.x - E * 0.03, nt.y + E * 0.04, nt.x - E * 0.08, nt.y - E * 0.045);
    ctx.closePath();
  };
  soft(ctx, nose, edge(f, 0.4));
  ctx.fillStyle = nose;
  noseShape();
  ctx.fill();
  hard(ctx);
  ctx.strokeStyle = ink;
  ctx.lineWidth = E * 0.014;
  ctx.lineJoin = 'round';
  noseShape();
  ctx.stroke();
  // Philtrum down to the lip.
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(nt.x, nt.y + E * 0.05);
  ctx.lineTo(f.mouthTop.x, lerpPt(nt, f.mouthTop, 0.85).y);
  ctx.stroke();

  // Whiskers: three fine curved strokes per side, plus the whisker dots.
  ctx.lineWidth = E * 0.01;
  for (const s of SIDES) {
    const k = sided(f, s);
    // Pads sit up toward the nose, and the low whisker stays shallow, so a wide
    // laugh does not drag ink across the mouth corners.
    const pad = lerpPt(lerpPt(f.mouthTop, k.mouth, 0.55), f.noseTip, 0.42);
    for (const [dy, tilt] of [[-0.04, -0.12], [0, -0.02], [0.04, 0.06]] as const) {
      const a = { x: pad.x + k.out * E * 0.09, y: pad.y + dy * E };
      const b = { x: a.x + k.out * E * 0.34, y: a.y + tilt * E * 1.1 };
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 - E * 0.03, b.x, b.y);
      ctx.stroke();
    }
    ctx.fillStyle = ink;
    for (const [dx, dy] of [[0.03, -0.03], [0.07, 0.0], [0.035, 0.03]]) {
      dot(ctx, { x: pad.x + k.out * dx * E, y: pad.y + dy * E }, E * 0.01);
      ctx.fill();
    }
  }
}

function neonTribal(ctx: PaintContext, f: FaceFrame, colors: string[]): void {
  const E = f.eyeSpan;
  const a = c(colors, 0, '#ff2bd6');
  const b = c(colors, 1, '#18ffff');
  const cc = c(colors, 2, '#c6ff00');
  /** A neon dot: a wide same-colour glow under a bright core. */
  const glowDot = (at: Pt, r: number, col: string) => {
    soft(ctx, col, r * 2.2);
    ctx.fillStyle = col;
    dot(ctx, at, r);
    ctx.fill();
  };
  ctx.lineCap = 'round';
  for (const s of SIDES) {
    const k = sided(f, s);
    // A row of dots arching over the brow, shrinking outward.
    const inner = lerpPt(f.browMid, k.brow, 0.45);
    const ctrl = { x: k.brow.x, y: k.brow.y - E * 0.1 };
    const outer = { x: k.browOuter.x, y: k.browOuter.y - E * 0.04 };
    for (let i = 0; i < 8; i++) {
      const t = i / 7;
      const p = quadPt({ x: inner.x, y: inner.y - E * 0.06 }, ctrl, outer, t);
      glowDot(p, E * (0.02 - t * 0.009), i % 2 === 0 ? a : cc);
    }
    // Two glowing lines along the cheekbone, a dot row beneath them.
    for (const [off, col] of [[0, b], [0.05, a]] as const) {
      const p0 = { x: lerpPt(k.underEye, k.eyeBot, 0.35).x, y: lerpPt(k.underEye, k.eyeBot, 0.35).y + off * E };
      const p1 = { x: k.cheekbone.x, y: k.cheekbone.y - E * 0.05 + off * E };
      soft(ctx, col, E * 0.03);
      ctx.strokeStyle = col;
      ctx.lineWidth = E * 0.013;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.quadraticCurveTo((p0.x + p1.x) / 2, Math.max(p0.y, p1.y) + E * 0.03, p1.x, p1.y);
      ctx.stroke();
    }
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const p = lerpPt(lerpPt(k.underEye, k.cheek, 0.35), lerpPt(k.cheekbone, k.cheekLow, 0.3), t);
      glowDot(p, E * 0.012, cc);
    }
    // A chevron on the temple.
    const tc = lerpPt(k.eyeOuter, k.temple, 0.45);
    soft(ctx, b, E * 0.03);
    ctx.strokeStyle = b;
    ctx.lineWidth = E * 0.013;
    ctx.beginPath();
    ctx.moveTo(tc.x - k.out * E * 0.03, tc.y - E * 0.06);
    ctx.lineTo(tc.x + k.out * E * 0.03, tc.y);
    ctx.lineTo(tc.x - k.out * E * 0.03, tc.y + E * 0.06);
    ctx.stroke();
  }
  // Third-eye diamond on the forehead with a dot drop above it.
  const fc = lerpPt(f.browMid, f.foreheadMid, 0.4);
  soft(ctx, b, E * 0.035);
  ctx.strokeStyle = b;
  ctx.lineWidth = E * 0.014;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(fc.x, fc.y - E * 0.07);
  ctx.lineTo(fc.x + E * 0.045, fc.y);
  ctx.lineTo(fc.x, fc.y + E * 0.07);
  ctx.lineTo(fc.x - E * 0.045, fc.y);
  ctx.closePath();
  ctx.stroke();
  glowDot(fc, E * 0.016, a);
  for (let i = 1; i <= 3; i++) glowDot({ x: fc.x, y: fc.y - E * (0.07 + i * 0.045) }, E * (0.014 - i * 0.002), i % 2 === 0 ? a : cc);
  hard(ctx);
}

/* ── flags ─────────────────────────────────────────────────────────────── */

/**
 * Where a ray from `o` along `d` leaves the texture square, and that exit's
 * position along the square's perimeter, walked clockwise from the top-left
 * corner (canvas y down): top 0..S, right S..2S, bottom 2S..3S, left 3S..4S.
 */
function exitPoint(o: Pt, d: Pt, S: number): { p: Pt; t: number } {
  let best = Infinity;
  if (d.x > 1e-9) best = Math.min(best, (S - o.x) / d.x);
  if (d.x < -1e-9) best = Math.min(best, -o.x / d.x);
  if (d.y > 1e-9) best = Math.min(best, (S - o.y) / d.y);
  if (d.y < -1e-9) best = Math.min(best, -o.y / d.y);
  const k = Number.isFinite(best) ? Math.max(0, best) : 0;
  const p = { x: Math.min(S, Math.max(0, o.x + d.x * k)), y: Math.min(S, Math.max(0, o.y + d.y * k)) };
  const eps = S * 1e-6;
  let t: number;
  if (p.y <= eps) t = p.x;
  else if (p.x >= S - eps) t = S + p.y;
  else if (p.y >= S - eps) t = 3 * S - p.x;
  else t = 4 * S - p.y;
  return { p, t };
}

/** Fills the wedge of the texture between two rays from `o`, sweeping clockwise from `a` to `b`. */
function wedge(ctx: PaintContext, o: Pt, a: Pt, b: Pt, S: number): void {
  const A = exitPoint(o, { x: a.x - o.x, y: a.y - o.y }, S);
  const B = exitPoint(o, { x: b.x - o.x, y: b.y - o.y }, S);
  const corners: [number, Pt][] = [[0, { x: 0, y: 0 }], [S, { x: S, y: 0 }], [2 * S, { x: S, y: S }], [3 * S, { x: 0, y: S }]];
  const span = (B.t - A.t + 4 * S) % (4 * S);
  ctx.beginPath();
  ctx.moveTo(o.x, o.y);
  ctx.lineTo(A.p.x, A.p.y);
  for (const [t, p] of [...corners, ...corners.map(([t2, p2]) => [t2 + 4 * S, p2] as [number, Pt])]) {
    const along = t - A.t;
    if (along > 0 && along < span) ctx.lineTo(p.x, p.y);
  }
  ctx.lineTo(B.p.x, B.p.y);
  ctx.closePath();
}

/** The four arms of a diagonal-cross flag on the face: the centre and its four rays' far points. */
function saltireArms(f: FaceFrame): { o: Pt; tl: Pt; tr: Pt; bl: Pt; br: Pt } {
  const E = f.eyeSpan;
  const o = lerpPt(f.noseBridge, f.noseTip, 0.35);
  const L = sided(f, 'L');
  const R = sided(f, 'R');
  // Up through the temples, down through the jaw corners.
  const tl = { x: L.temple.x, y: L.temple.y - E * 0.15 };
  const tr = { x: R.temple.x, y: R.temple.y - E * 0.15 };
  return { o, tl, tr, bl: L.jaw, br: R.jaw };
}

/** Diagonal-cross flag over the whole face (Jamaica by default). */
function saltireFace(ctx: PaintContext, f: FaceFrame, colors: string[]): void {
  const S = f.size;
  const E = f.eyeSpan;
  const tri = c(colors, 0, '#009b3a');
  const side = c(colors, 1, '#111111');
  const cross = c(colors, 2, '#fed100');
  const { o, tl, tr, bl, br } = saltireArms(f);
  hard(ctx);
  // Hoist and fly first (they fill the whole sweep), then the top and bottom.
  ctx.fillStyle = side;
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = tri;
  soft(ctx, tri, edge(f, 0.5));
  wedge(ctx, o, tl, tr, S);
  ctx.fill();
  wedge(ctx, o, br, bl, S);
  ctx.fill();
  // The cross: two broad bands meeting on the bridge of the nose.
  soft(ctx, cross, edge(f, 0.5));
  ctx.strokeStyle = cross;
  ctx.lineWidth = E * 0.2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  for (const [a, b] of [[tl, br], [tr, bl]] as [Pt, Pt][]) {
    const A = exitPoint(o, { x: a.x - o.x, y: a.y - o.y }, S).p;
    const B = exitPoint(o, { x: b.x - o.x, y: b.y - o.y }, S).p;
    polylinePath(ctx, [A, o, B]);
    ctx.stroke();
  }
  hard(ctx);
}

/** Three upright bands over the whole face (Nigeria by default). */
function tricolourFace(ctx: PaintContext, f: FaceFrame, colors: string[]): void {
  const S = f.size;
  const E = f.eyeSpan;
  const left = c(colors, 0, '#008751');
  const mid = c(colors, 1, '#ffffff');
  const right = c(colors, 2, left);
  const cx = lerpPt(f.noseBridge, f.noseTip, 0.4).x;
  const xl = Math.max(0, cx - E * 0.3);
  const xr = Math.min(S, cx + E * 0.3);
  hard(ctx);
  ctx.fillStyle = mid;
  ctx.fillRect(0, 0, S, S);
  soft(ctx, left, edge(f, 0.5));
  ctx.fillStyle = left;
  ctx.fillRect(0, 0, xl, S);
  soft(ctx, right, edge(f, 0.5));
  ctx.fillStyle = right;
  ctx.fillRect(xr, 0, S - xr, S);
  hard(ctx);
}

/** A gently waving flag outline centred on (0,0): wavy top/bottom, straight hoist. */
function wavingFlagPath(ctx: PaintContext, w: number, h: number): void {
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2);
  ctx.bezierCurveTo(-w / 6, -h / 2 - h * 0.12, w / 6, -h / 2 + h * 0.12, w / 2, -h / 2);
  ctx.lineTo(w / 2, h / 2);
  ctx.bezierCurveTo(w / 6, h / 2 + h * 0.12, -w / 6, h / 2 - h * 0.12, -w / 2, h / 2);
  ctx.closePath();
}

/** One saltire flag on the screen-left cheek, one tricolour on the right: a house divided, happily. */
function rivalFlags(ctx: PaintContext, f: FaceFrame, colors: string[]): void {
  const E = f.eyeSpan;
  const jaGreen = c(colors, 0, '#009b3a');
  const jaGold = c(colors, 1, '#fed100');
  const ngGreen = c(colors, 2, '#008751');
  const w = E * 0.46;
  const h = E * 0.3;
  for (const s of SIDES) {
    const k = sided(f, s);
    const centre = lerpPt(lerpPt(k.cheek, k.cheekbone, 0.45), k.underEye, 0.25);
    withTransform(ctx, centre, -k.out * 0.1, () => {
      ctx.save();
      wavingFlagPath(ctx, w, h);
      soft(ctx, s === 'L' ? jaGreen : ngGreen, edge(f, 0.8));
      ctx.fillStyle = s === 'L' ? '#111111' : '#ffffff';
      ctx.fill();
      ctx.clip();
      hard(ctx);
      if (s === 'L') {
        // Green above and below, black at the hoist and fly, a gold saltire.
        ctx.fillStyle = jaGreen;
        ctx.beginPath();
        ctx.moveTo(-w / 2, -h);
        ctx.lineTo(w / 2, -h);
        ctx.lineTo(0, 0);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-w / 2, h);
        ctx.lineTo(w / 2, h);
        ctx.lineTo(0, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = jaGold;
        ctx.lineWidth = h * 0.2;
        ctx.beginPath();
        ctx.moveTo(-w / 2, -h / 2 - h * 0.1);
        ctx.lineTo(w / 2, h / 2 + h * 0.1);
        ctx.moveTo(w / 2, -h / 2 - h * 0.1);
        ctx.lineTo(-w / 2, h / 2 + h * 0.1);
        ctx.stroke();
      } else {
        ctx.fillStyle = ngGreen;
        ctx.fillRect(-w / 2, -h, w / 3, h * 2);
        ctx.fillRect(w / 6, -h, w / 3 + 0.5, h * 2);
      }
      ctx.restore();
      // A fine light edge, so the flag reads as painted, not printed.
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = E * 0.008;
      wavingFlagPath(ctx, w, h);
      ctx.stroke();
    });
  }
  // A small gold heart on the bridge of the nose: one face, both teams.
  withTransform(ctx, lerpPt(f.noseBridge, f.noseTip, 0.3), 0, () => {
    soft(ctx, jaGold, edge(f, 0.5));
    ctx.fillStyle = jaGold;
    heartPath(ctx, E * 0.045);
    ctx.fill();
  });
  hard(ctx);
}

/* ── celebration ───────────────────────────────────────────────────────── */

/** Two linked gold rings on the cheekbone, a diamond glint and a trail of tiny hearts. */
function weddingRings(ctx: PaintContext, f: FaceFrame, colors: string[]): void {
  const E = f.eyeSpan;
  const gold = c(colors, 0, '#e2b65a');
  const heart = c(colors, 1, '#d9573b');
  const shine = c(colors, 2, '#ffffff');
  const R = sided(f, 'R');
  const at = lerpPt(R.cheekbone, R.cheek, 0.5);
  const r = E * 0.14;
  const lw = E * 0.036;
  withTransform(ctx, at, 0.18, () => {
    const a = { x: -r * 0.55, y: 0 };
    const b = { x: r * 0.55, y: r * 0.12 };
    soft(ctx, gold, edge(f, 0.4));
    ctx.strokeStyle = gold;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.stroke();
    // Re-lay a short arc of the first ring over the second: they interlock.
    hard(ctx);
    ctx.beginPath();
    ctx.arc(a.x, a.y, r, -0.55, 0.15);
    ctx.stroke();
    // Polished highlights on the upper-left of each band.
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = lw * 0.28;
    ctx.lineCap = 'round';
    for (const p of [a, b]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 1.02, Math.PI * 1.08, Math.PI * 1.42);
      ctx.stroke();
    }
    // The stone: a four-point glint sat on top of the first ring.
    ctx.fillStyle = shine;
    glint(ctx, { x: a.x, y: a.y - r - lw * 0.6 }, E * 0.07, 0);
    ctx.fill();
  });
  // Tiny hearts drifting up toward the eye.
  const trail = [[0.45, 0.045, -0.2], [0.66, 0.035, 0.25], [0.84, 0.026, -0.1]] as const;
  const from = { x: at.x + E * 0.14, y: at.y - E * 0.04 };
  for (const [t, sz, rot] of trail) {
    const p = lerpPt(from, R.temple, t);
    withTransform(ctx, p, rot, () => {
      soft(ctx, heart, edge(f, 0.4));
      ctx.fillStyle = heart;
      heartPath(ctx, E * sz);
      ctx.fill();
    });
  }
  hard(ctx);
  ctx.fillStyle = shine;
  const rand = rng(0x71e6d1);
  for (let i = 0; i < 7; i++) {
    dot(ctx, { x: at.x + (rand() - 0.5) * E * 0.36, y: at.y + (rand() - 0.5) * E * 0.3 }, E * (0.005 + rand() * 0.006));
    ctx.fill();
  }
}

/** Gold filigree scalloped along each lower lash line and up to the brow, beaded with pearls. */
function gildedLace(ctx: PaintContext, f: FaceFrame, colors: string[]): void {
  const E = f.eyeSpan;
  const gold = c(colors, 0, '#e2b65a');
  const pearl = c(colors, 1, '#fff6e6');
  const accent = c(colors, 2, '#c8962e');
  for (const s of SIDES) {
    const k = sided(f, s);
    const eye = eyeCentre(f, s);
    const start = { x: k.eyeInner.x - k.out * E * 0.01, y: k.eyeBot.y + E * 0.07 };
    const outer = { x: k.eyeOuter.x + k.out * E * 0.13, y: k.eyeOuter.y + E * 0.04 };
    const end = lerpPt(k.browOuter, k.temple, 0.25);
    const pts = cubicPts(start, { x: lerpPt(start, outer, 0.55).x, y: start.y + E * 0.035 }, { x: outer.x + k.out * E * 0.03, y: outer.y - E * 0.08 }, end, 28);
    const N = polyNormals(pts);
    // Normals that point away from the eye: the scallops open outward.
    const sign = (N[Math.floor(pts.length / 2)].x * (pts[Math.floor(pts.length / 2)].x - eye.x)
      + N[Math.floor(pts.length / 2)].y * (pts[Math.floor(pts.length / 2)].y - eye.y)) >= 0 ? 1 : -1;
    // The spine.
    soft(ctx, gold, edge(f, 0.3));
    ctx.strokeStyle = gold;
    ctx.lineWidth = E * 0.018;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    polylinePath(ctx, pts);
    ctx.stroke();
    // Scallops: small half-loops hung off the spine every few points.
    ctx.lineWidth = E * 0.012;
    for (let i = 2; i < pts.length - 2; i += 3) {
      const a = pts[i];
      const b = pts[i + 3] ?? pts[pts.length - 1];
      const n = N[i + 1] ?? N[i];
      const mid = lerpPt(a, b, 0.5);
      const ctl = { x: mid.x + n.x * sign * E * 0.1, y: mid.y + n.y * sign * E * 0.1 };
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(ctl.x, ctl.y, b.x, b.y);
      ctx.stroke();
      // A seed of accent in each scallop's heart.
      hard(ctx);
      ctx.fillStyle = accent;
      dot(ctx, { x: mid.x + n.x * sign * E * 0.035, y: mid.y + n.y * sign * E * 0.035 }, E * 0.012);
      ctx.fill();
      soft(ctx, gold, edge(f, 0.3));
    }
    hard(ctx);
    // Pearls where the scallops meet.
    for (let i = 2; i < pts.length - 2; i += 3) {
      ctx.fillStyle = pearl;
      dot(ctx, pts[i], E * 0.02);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      dot(ctx, { x: pts[i].x - E * 0.006, y: pts[i].y - E * 0.006 }, E * 0.007);
      ctx.fill();
    }
    // A closing curl at the brow end, and a drop pearl beneath the outer corner.
    const tip = pts[pts.length - 1];
    ctx.strokeStyle = gold;
    ctx.lineWidth = E * 0.015;
    polylinePath(ctx, spiralPts(tip, E * 0.06, E * 0.01, Math.PI / 2, 1.2, s === 'L' ? -1 : 1, 24));
    ctx.stroke();
    ctx.fillStyle = pearl;
    dot(ctx, { x: outer.x, y: outer.y + E * 0.09 }, E * 0.03);
    ctx.fill();
  }
  hard(ctx);
}

/** A hibiscus in bloom by the eye, with two leaves and a scatter of pollen. */
function hibiscusBloom(ctx: PaintContext, f: FaceFrame, colors: string[]): void {
  const E = f.eyeSpan;
  const petal = c(colors, 0, '#d9573b');
  const pollen = c(colors, 1, '#f3c24e');
  const leafCol = c(colors, 2, '#2f7f73');
  const L = sided(f, 'L');
  const at = lerpPt(L.cheekbone, L.cheek, 0.3);
  const k = (E * 0.3) / 80;
  // One petal, ~80 units long, pointing up from (0,0).
  const petalPath = (sc: number): void => {
    const q = (x: number, y: number): [number, number] => [x * k * sc, y * k * sc];
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(...q(-20, -8), ...q(-46, -32), ...q(-38, -58));
    ctx.bezierCurveTo(...q(-32, -76), ...q(-13, -81), ...q(-4, -70));
    ctx.bezierCurveTo(...q(-1, -77), ...q(3, -78), ...q(6, -72));
    ctx.bezierCurveTo(...q(15, -82), ...q(36, -75), ...q(40, -56));
    ctx.bezierCurveTo(...q(46, -32), ...q(20, -8), 0, 0);
    ctx.closePath();
  };
  // Leaves behind the flower.
  soft(ctx, leafCol, edge(f, 0.5));
  ctx.fillStyle = leafCol;
  for (const [ang, len] of [[2.5, 0.36], [1.7, 0.3]] as const) {
    const tip = { x: at.x + Math.cos(ang) * E * len, y: at.y + Math.sin(ang) * E * len };
    taperPath(ctx, at, tip, E * 0.07, 0.25);
    ctx.fill();
  }
  // Five petals, a darker throat, then the stamen.
  withTransform(ctx, at, -0.25, () => {
    for (let i = 0; i < 5; i++) {
      ctx.save();
      ctx.rotate((i * Math.PI * 2) / 5);
      soft(ctx, petal, edge(f, 0.5));
      ctx.fillStyle = petal;
      petalPath(i % 2 === 0 ? 1 : 0.94);
      ctx.fill();
      hard(ctx);
      // A light paper edge keeps each petal distinct on darker skin.
      ctx.strokeStyle = 'rgba(255,226,180,0.8)';
      ctx.lineWidth = E * 0.007;
      ctx.stroke();
      ctx.fillStyle = 'rgba(90,20,10,0.28)';
      petalPath(0.42);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = E * 0.005;
      ctx.beginPath();
      ctx.moveTo(0, -E * 0.03);
      ctx.lineTo(0, -E * 0.11);
      ctx.stroke();
      ctx.restore();
    }
    ctx.strokeStyle = pollen;
    ctx.lineWidth = E * 0.012;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(E * 0.03, -E * 0.08, E * 0.07, -E * 0.13);
    ctx.stroke();
    ctx.fillStyle = pollen;
    for (const [dx, dy] of [[0.07, -0.13], [0.085, -0.12], [0.06, -0.145], [0.08, -0.145], [0.093, -0.135]]) {
      dot(ctx, { x: dx * E, y: dy * E }, E * 0.009);
      ctx.fill();
    }
  });
  // Pollen drifting down the cheek.
  hard(ctx);
  ctx.fillStyle = pollen;
  const rand = rng(0x41b15c);
  for (let i = 0; i < 9; i++) {
    const p = lerpPt(at, L.cheek, 0.35 + rand() * 0.55);
    dot(ctx, { x: p.x + (rand() - 0.5) * E * 0.14, y: p.y }, E * (0.006 + rand() * 0.006));
    ctx.fill();
  }
}

const draw = { gameDay, flagCheeks, eyeBlack, glitterFreckles, hearts, stars, tiger, sugarSkull, candyCane, rudolph, snowflakes, frostQueen, gingerbread };

export const FACE_PAINT_DESIGNS: readonly FacePaintDesign[] = [
  { id: 'game-day', name: 'Game Day', blurb: 'Team stripes under the eyes', slots: [{ label: 'Stripe 1', source: 'accent' }, { label: 'Stripe 2', source: '#ffffff' }], draw: draw.gameDay },
  { id: 'flag-cheeks', name: 'Flag Cheeks', blurb: 'A waving three-band flag on each cheek', slots: [{ label: 'Band 1', source: 'accent' }, { label: 'Band 2', source: '#ffffff' }, { label: 'Band 3', source: 'accent3' }], draw: draw.flagCheeks },
  { id: 'eye-black', name: 'Eye Black', blurb: 'The classic athlete smear', slots: [{ label: 'Paint', source: '#121212' }], draw: draw.eyeBlack },
  { id: 'glitter-freckles', name: 'Glitter Freckles', blurb: 'Sparkling freckles across the nose', slots: [{ label: 'Glitter 1', source: 'accent2' }, { label: 'Glitter 2', source: 'accent' }, { label: 'Glitter 3', source: '#ffffff' }], draw: draw.glitterFreckles },
  { id: 'hearts', name: 'Hearts', blurb: 'A heart on the cheek and a little trail', slots: [{ label: 'Hearts', source: '#e8336f' }, { label: 'Accent', source: '#ffffff' }], draw: draw.hearts },
  { id: 'stars', name: 'Stars', blurb: 'A star cluster by the eye', slots: [{ label: 'Big star', source: 'accent2' }, { label: 'Small stars', source: '#ffffff' }, { label: 'Accent', source: 'accent' }], draw: draw.stars },
  { id: 'tiger', name: 'Tiger', blurb: 'Full-face tiger with whisker pads', slots: [{ label: 'Coat', source: '#f2851f' }, { label: 'Stripes', source: '#151515' }, { label: 'Muzzle', source: '#f7f2e8' }], draw: draw.tiger, fullFace: true },
  { id: 'sugar-skull', name: 'Sugar Skull', blurb: 'Día de Muertos calavera, petals and stitches', slots: [{ label: 'Base', source: '#f4f0e8' }, { label: 'Petals', source: 'accent' }, { label: 'Detail', source: '#161616' }], draw: draw.sugarSkull, fullFace: true },
  { id: 'candy-cane', name: 'Candy Cane', blurb: 'Glossy candy-cane stripes along each cheekbone', slots: [{ label: 'Stripes', source: '#d4141f' }, { label: 'Candy', source: '#fbf8f3' }], draw: draw.candyCane, category: 'holiday' },
  { id: 'rudolph', name: 'Rudolph', blurb: 'A shiny red nose, rosy cheeks and freckles', slots: [{ label: 'Nose', source: '#d0101c' }, { label: 'Cheeks', source: '#e5566b' }, { label: 'Freckles', source: '#7b4a2f' }], draw: draw.rudolph, category: 'holiday' },
  { id: 'snowflakes', name: 'Snowflakes', blurb: 'Crisp snowflakes by the eye in a drift of frost glitter', slots: [{ label: 'Flakes', source: '#ffffff' }, { label: 'Frost', source: '#7cc6f2' }, { label: 'Glitter', source: '#cfeaff' }], draw: draw.snowflakes, category: 'holiday', shimmer: true },
  { id: 'frost-queen', name: 'Frost Queen', blurb: 'Icy swirls framing the eyes, crystals and shimmer', slots: [{ label: 'Ice', source: '#5fb8f0' }, { label: 'Frost', source: '#ffffff' }, { label: 'Crystals', source: '#bfe8ff' }], draw: draw.frostQueen, category: 'holiday', shimmer: true },
  { id: 'gingerbread', name: 'Gingerbread', blurb: 'A full gingerbread face with piped white icing', slots: [{ label: 'Cookie', source: '#b4692e' }, { label: 'Icing', source: '#fffaf2' }, { label: 'Candy', source: '#d4141f' }], draw: draw.gingerbread, fullFace: true, category: 'holiday' },
  // Party (year-round), second wave
  { id: 'butterfly', name: 'Butterfly', blurb: 'Painted wings spread around the eyes', slots: [{ label: 'Wings', source: 'accent' }, { label: 'Inner', source: 'accent2' }, { label: 'Outline', source: '#161616' }], draw: butterfly, category: 'party' },
  { id: 'hero-mask', name: 'Hero Mask', blurb: 'A painted superhero mask around the eyes', slots: [{ label: 'Mask', source: 'accent' }, { label: 'Trim', source: '#ffffff' }], draw: heroMask, category: 'party' },
  { id: 'rainbow', name: 'Rainbow', blurb: 'A rainbow arc on the cheek between two clouds', slots: [{ label: 'Clouds', source: '#ffffff' }, { label: 'Sparkle', source: 'accent2' }], draw: rainbow, category: 'party' },
  { id: 'lightning-bolt', name: 'Lightning Bolt', blurb: 'A rock-star bolt across one eye', slots: [{ label: 'Bolt', source: '#e63946' }, { label: 'Edge', source: '#4895ef' }, { label: 'Shine', source: '#ffffff' }], draw: lightningBolt, category: 'party' },
  { id: 'unicorn', name: 'Unicorn', blurb: 'Pastel swirls round the eyes and a forehead star', slots: [{ label: 'Swirl 1', source: '#f9a8d4' }, { label: 'Swirl 2', source: '#c4b5fd' }, { label: 'Star', source: 'accent2' }], draw: unicorn, category: 'party', shimmer: true },
  { id: 'cat', name: 'Cat', blurb: 'Button nose, whiskers and cheek stripes', slots: [{ label: 'Ink', source: '#161616' }, { label: 'Nose', source: '#f28fb0' }, { label: 'Stripes', source: '#161616' }], draw: cat, category: 'party' },
  { id: 'neon-tribal', name: 'Neon Festival', blurb: 'Glowing festival dots and lines on brows and cheekbones', slots: [{ label: 'Neon 1', source: '#ff2bd6' }, { label: 'Neon 2', source: '#18ffff' }, { label: 'Neon 3', source: '#c6ff00' }], draw: neonTribal, category: 'party', shimmer: true },
  { id: 'saltire-face', name: 'Saltire Flag', blurb: 'A full-face diagonal-cross flag (Jamaica to start)', slots: [{ label: 'Top and bottom', source: '#009b3a' }, { label: 'Sides', source: '#111111' }, { label: 'Cross', source: '#fed100' }], draw: saltireFace, fullFace: true, category: 'flags' },
  { id: 'tricolour-face', name: 'Tricolour Flag', blurb: 'A full-face three-band flag (Nigeria to start)', slots: [{ label: 'Left band', source: '#008751' }, { label: 'Middle band', source: '#ffffff' }, { label: 'Right band', source: '#008751' }], draw: tricolourFace, fullFace: true, category: 'flags' },
  { id: 'rival-flags', name: 'Rival Flags', blurb: 'Jamaica on one cheek, Nigeria on the other, a gold heart between', slots: [{ label: 'Jamaica green', source: '#009b3a' }, { label: 'Jamaica gold', source: '#fed100' }, { label: 'Nigeria green', source: '#008751' }], draw: rivalFlags, category: 'flags' },
  { id: 'wedding-rings', name: 'Wedding Rings', blurb: 'Two linked gold rings with a diamond glint and tiny hearts', slots: [{ label: 'Rings', source: 'accent2' }, { label: 'Hearts', source: '#d9573b' }, { label: 'Sparkle', source: '#ffffff' }], draw: weddingRings, category: 'celebration', shimmer: true },
  { id: 'gilded-lace', name: 'Gilded Lace', blurb: 'Gold filigree and pearls framing the eyes', slots: [{ label: 'Lace', source: 'accent2' }, { label: 'Pearls', source: '#fff6e6' }, { label: 'Accent', source: 'accent' }], draw: gildedLace, category: 'celebration', shimmer: true },
  { id: 'hibiscus-bloom', name: 'Hibiscus Bloom', blurb: 'A hibiscus in bloom by the eye, leaves and pollen', slots: [{ label: 'Petals', source: '#d9573b' }, { label: 'Pollen', source: '#f3c24e' }, { label: 'Leaves', source: '#2f7f73' }], draw: hibiscusBloom, category: 'celebration' },
];

export const FACE_PAINT_DESIGN_MAP: Record<string, FacePaintDesign> = Object.fromEntries(
  FACE_PAINT_DESIGNS.map((d) => [d.id, d]),
);

/** Resolve a design's default colours from the event theme. */
export function defaultColorsFor(designId: string, theme: ThemeColors = DEFAULT_THEME): string[] {
  const d = FACE_PAINT_DESIGN_MAP[designId];
  if (!d) return [];
  return d.slots.map((s) => (s.source.startsWith('#') ? s.source : theme[s.source as keyof ThemeColors]).toLowerCase());
}
