/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Face Paint design registry: eight procedural looks, each drawn into
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
  angleOf, dot, ellipseAt, hard, heartPath, rng, soft, starPath, taperPath, type PaintContext,
} from './shapes';

export const FACE_PAINT_DESIGN_IDS = [
  'game-day',
  'flag-cheeks',
  'eye-black',
  'glitter-freckles',
  'hearts',
  'stars',
  'tiger',
  'sugar-skull',
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

const draw = { gameDay, flagCheeks, eyeBlack, glitterFreckles, hearts, stars, tiger, sugarSkull };

export const FACE_PAINT_DESIGNS: readonly FacePaintDesign[] = [
  { id: 'game-day', name: 'Game Day', blurb: 'Team stripes under the eyes', slots: [{ label: 'Stripe 1', source: 'accent' }, { label: 'Stripe 2', source: '#ffffff' }], draw: draw.gameDay },
  { id: 'flag-cheeks', name: 'Flag Cheeks', blurb: 'A waving three-band flag on each cheek', slots: [{ label: 'Band 1', source: 'accent' }, { label: 'Band 2', source: '#ffffff' }, { label: 'Band 3', source: 'accent3' }], draw: draw.flagCheeks },
  { id: 'eye-black', name: 'Eye Black', blurb: 'The classic athlete smear', slots: [{ label: 'Paint', source: '#121212' }], draw: draw.eyeBlack },
  { id: 'glitter-freckles', name: 'Glitter Freckles', blurb: 'Sparkling freckles across the nose', slots: [{ label: 'Glitter 1', source: 'accent2' }, { label: 'Glitter 2', source: 'accent' }, { label: 'Glitter 3', source: '#ffffff' }], draw: draw.glitterFreckles },
  { id: 'hearts', name: 'Hearts', blurb: 'A heart on the cheek and a little trail', slots: [{ label: 'Hearts', source: '#e8336f' }, { label: 'Accent', source: '#ffffff' }], draw: draw.hearts },
  { id: 'stars', name: 'Stars', blurb: 'A star cluster by the eye', slots: [{ label: 'Big star', source: 'accent2' }, { label: 'Small stars', source: '#ffffff' }, { label: 'Accent', source: 'accent' }], draw: draw.stars },
  { id: 'tiger', name: 'Tiger', blurb: 'Full-face tiger with whisker pads', slots: [{ label: 'Coat', source: '#f2851f' }, { label: 'Stripes', source: '#151515' }, { label: 'Muzzle', source: '#f7f2e8' }], draw: draw.tiger, fullFace: true },
  { id: 'sugar-skull', name: 'Sugar Skull', blurb: 'Día de Muertos calavera, petals and stitches', slots: [{ label: 'Base', source: '#f4f0e8' }, { label: 'Petals', source: 'accent' }, { label: 'Detail', source: '#161616' }], draw: draw.sugarSkull, fullFace: true },
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
