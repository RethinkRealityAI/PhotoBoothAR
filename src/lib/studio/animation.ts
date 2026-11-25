/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure per-object animation math for booth layers/pieces. Deterministic (the
 * caller passes `tSec`, typically `performance.now() / 1000`), so this file
 * has zero three/react imports and is unit-testable in plain node/vitest.
 * Rendered identically in the studio live preview and the guest booth.
 */
import type { Transform2D, LayerAnimation, LayerIntro } from '../../types';

/** 2D animation applied on top of a layer's static Transform2D. 'none' is a no-op. */
export function animateTransform2D(base: Transform2D, preset: LayerAnimation, tSec: number): Transform2D {
  switch (preset) {
    case 'float': {
      // Gentle vertical bob: ~1.2% of frame height amplitude, ~0.5Hz.
      const bob = 1.2 * Math.sin(2 * Math.PI * 0.5 * tSec);
      return { ...base, y: base.y + bob };
    }
    case 'pulse': {
      // Breathing scale: ±4% at 0.8Hz.
      const mul = 1 + 0.04 * Math.sin(2 * Math.PI * 0.8 * tSec);
      return { ...base, scale: base.scale * mul };
    }
    case 'spin': {
      // Continuous rotation at 20°/s, wrapped into [-180, 180].
      const deg = wrapDeg(base.rotation + 20 * tSec);
      return { ...base, rotation: deg };
    }
    case 'sway':
      return { ...base, rotation: base.rotation + SWAY_DEG * Math.sin(2 * Math.PI * SWAY_HZ * tSec) };
    case 'drift':
      return { ...base, x: base.x + DRIFT_PCT * Math.sin(2 * Math.PI * DRIFT_HZ * tSec) };
    case 'twinkle': // opacity only — see layerMotion2D
    case 'none':
    default:
      return base;
  }
}

/* ── Animated Frames: entrance + idle with a pivot ─────────────────────────
 * The booth draws each 2D layer as: translate(base.x/y) · rotate(base) ·
 * scale(base) · [motion about the pivot] · image. layerMotion2D returns the
 * bracketed motion. With the pivot at the frame centre and no intro, the
 * result is exactly what animateTransform2D produced before (same dy, same
 * extra rotation/scale about the centre), so existing layers are unchanged. */

const SWAY_DEG = 3;
const SWAY_HZ = 0.35;
const DRIFT_PCT = 1.5;
const DRIFT_HZ = 0.12;
const TWINKLE_HZ = 0.9;

/** How long one layer's entrance runs, ms. */
export const INTRO_MS = 900;
/** Longest stagger a layer may ask for (a corrupt row must not hide a layer for minutes). */
export const INTRO_DELAY_MAX_MS = 4000;

export const LAYER_INTROS: readonly LayerIntro[] = ['fade', 'rise', 'drop', 'bloom', 'slideLeft', 'slideRight', 'spinIn'];
export const LAYER_ANIMATIONS: readonly LayerAnimation[] = ['none', 'float', 'pulse', 'spin', 'sway', 'twinkle', 'drift'];

export function isLayerIntro(v: unknown): v is LayerIntro {
  return typeof v === 'string' && (LAYER_INTROS as readonly string[]).includes(v);
}
export function isLayerAnimation(v: unknown): v is LayerAnimation {
  return typeof v === 'string' && (LAYER_ANIMATIONS as readonly string[]).includes(v);
}

export interface LayerMotionSpec {
  animation?: LayerAnimation;
  intro?: LayerIntro;
  introDelayMs?: number;
  /** Desyncs idle presets between sibling layers, radians. */
  phase?: number;
}

export interface LayerMotion2D {
  /** Extra offset, percent of frame width/height (added to the base x/y). */
  dx: number;
  dy: number;
  /** Extra rotation about the pivot, degrees. */
  rotDeg: number;
  /** Extra scale about the pivot (1 = none). */
  scale: number;
  /** Opacity multiplier 0..1. */
  alpha: number;
}

const NO_MOTION: LayerMotion2D = { dx: 0, dy: 0, rotDeg: 0, scale: 1, alpha: 1 };

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const easeOutCubic = (k: number) => 1 - Math.pow(1 - k, 3);
/** Overshoots ~10% then settles — the "pop" of a bloom or a drop. */
const easeOutBack = (k: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
};

/** The safe stagger for a stored `introDelayMs` (pure). */
export function introDelayOf(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(INTRO_DELAY_MAX_MS, Math.max(0, v)) : 0;
}

/** Has this layer's entrance finished `sinceMs` after the Look started? */
export function introDone(spec: LayerMotionSpec, sinceMs: number): boolean {
  if (!spec.intro) return true;
  return sinceMs >= introDelayOf(spec.introDelayMs) + INTRO_MS;
}

/**
 * Motion for one 2D layer (pure). `tSec` drives the idle loop (a free-running
 * clock); `sinceMs` is how long ago this layer's Look started (Infinity = long
 * done — what a layer with no intro always behaves like). The idle loop fades
 * in over the entrance so there is no jump where one hands over to the other.
 */
export function layerMotion2D(spec: LayerMotionSpec, tSec: number, sinceMs: number): LayerMotion2D {
  const anim = spec.animation ?? 'none';
  if (anim === 'none' && !spec.intro) return NO_MOTION;
  let dx = 0, dy = 0, rotDeg = 0, scale = 1, alpha = 1;
  let idleGain = 1;

  if (spec.intro) {
    const k = clamp01((sinceMs - introDelayOf(spec.introDelayMs)) / INTRO_MS);
    if (k <= 0) return { ...NO_MOTION, alpha: 0 };
    if (k < 1) {
      const e = easeOutCubic(k);
      const b = easeOutBack(k);
      const fadeIn = clamp01(k * 2.2);
      idleGain = e;
      switch (spec.intro) {
        case 'fade': alpha = easeOutCubic(k); break;
        case 'rise': dy = 7 * (1 - e); alpha = fadeIn; break;
        case 'drop': dy = -9 * (1 - b); alpha = fadeIn; break;
        case 'bloom': scale = 0.55 + 0.45 * b; alpha = fadeIn; break;
        case 'slideLeft': dx = -14 * (1 - e); alpha = fadeIn; break;
        case 'slideRight': dx = 14 * (1 - e); alpha = fadeIn; break;
        case 'spinIn': rotDeg = -100 * (1 - e); scale = 0.5 + 0.5 * b; alpha = fadeIn; break;
      }
    }
  }

  const ph = spec.phase ?? 0;
  switch (anim) {
    case 'float': dy += idleGain * 1.2 * Math.sin(2 * Math.PI * 0.5 * tSec); break;
    case 'pulse': scale *= 1 + idleGain * 0.04 * Math.sin(2 * Math.PI * 0.8 * tSec); break;
    case 'spin': rotDeg += 20 * tSec; break;
    case 'sway': rotDeg += idleGain * SWAY_DEG * Math.sin(2 * Math.PI * SWAY_HZ * tSec + ph); break;
    case 'drift': dx += idleGain * DRIFT_PCT * Math.sin(2 * Math.PI * DRIFT_HZ * tSec + ph); break;
    case 'twinkle': alpha *= 1 - idleGain * 0.225 * (1 - Math.sin(2 * Math.PI * TWINKLE_HZ * tSec + ph)); break;
    default: break;
  }
  return { dx, dy, rotDeg, scale: Math.max(0.01, scale), alpha: clamp01(alpha) };
}

/** Wrap a degree value into [-180, 180]. */
function wrapDeg(deg: number): number {
  let d = ((deg + 180) % 360 + 360) % 360 - 180;
  // Normalize -180 to 180 for a stable, symmetric range.
  if (d === -180) d = 180;
  return d;
}

export interface Animate3DResult {
  /** Local-space offset added on top of the piece's static anchor transform, in centimetres. */
  position: [number, number, number];
  /** Additional Y-axis rotation, in radians. */
  rotationY: number;
  /** Multiplier applied on top of the piece's static scale. */
  scaleMul: number;
}

const IDENTITY_3D: Animate3DResult = { position: [0, 0, 0], rotationY: 0, scaleMul: 1 };

/** How long a one-shot `animate` trigger pulse runs, ms. */
export const PULSE_3D_MS = 900;

/**
 * One-shot 3D pulse for the `animate` trigger action — a transient transform
 * that composes MULTIPLICATIVELY with the piece's continuous animate3D preset
 * and decays to the exact identity by PULSE_3D_MS, so capture parity after the
 * pulse is untouched. elapsedMs < 0 or ≥ PULSE_3D_MS → identity.
 */
export function animatePulse3D(
  preset: 'shake' | 'pulse' | 'spin' | 'pop',
  elapsedMs: number,
): Animate3DResult {
  if (!(elapsedMs >= 0) || elapsedMs >= PULSE_3D_MS) return IDENTITY_3D;
  const k = elapsedMs / PULSE_3D_MS; // 0..1
  const decay = 1 - k;
  switch (preset) {
    case 'shake': {
      // Side-to-side jitter: ±0.9cm at ~7Hz, dying out.
      const x = 0.9 * decay * Math.sin(2 * Math.PI * 7 * (elapsedMs / 1000));
      return { position: [x, 0, 0], rotationY: 0, scaleMul: 1 };
    }
    case 'pulse': {
      // Two visible breaths, dying out.
      const scaleMul = 1 + 0.22 * decay * Math.sin(2 * Math.PI * 2.2 * (elapsedMs / 1000));
      return { position: [0, 0, 0], rotationY: 0, scaleMul: Math.max(0.05, scaleMul) };
    }
    case 'spin': {
      // Exactly one full ease-out turn, landing back at 0 rotation.
      const eased = 1 - Math.pow(1 - k, 3);
      return { position: [0, 0, 0], rotationY: 2 * Math.PI * eased, scaleMul: 1 };
    }
    case 'pop': {
      // Overshoot spring: up to +35% early, settling to 1.
      const scaleMul = 1 + 0.35 * decay * Math.sin(Math.PI * Math.min(1, k * 1.6));
      return { position: [0, 0, 0], rotationY: 0, scaleMul: Math.max(0.05, scaleMul) };
    }
  }
}

/** 3D animation applied on top of a piece's static AnchorConfig-derived transform. */
export function animate3D(preset: LayerAnimation, tSec: number): Animate3DResult {
  switch (preset) {
    case 'float': {
      // Vertical bob: ±0.6cm at 0.5Hz.
      const y = 0.6 * Math.sin(2 * Math.PI * 0.5 * tSec);
      return { position: [0, y, 0], rotationY: 0, scaleMul: 1 };
    }
    case 'pulse': {
      // Breathing scale: ±4% at 0.8Hz.
      const scaleMul = 1 + 0.04 * Math.sin(2 * Math.PI * 0.8 * tSec);
      return { position: [0, 0, 0], rotationY: 0, scaleMul };
    }
    case 'spin': {
      // Continuous Y rotation at 0.6 rad/s.
      return { position: [0, 0, 0], rotationY: 0.6 * tSec, scaleMul: 1 };
    }
    case 'sway':
      // Gentle Y rock: ±0.12 rad at 0.35Hz.
      return { position: [0, 0, 0], rotationY: 0.12 * Math.sin(2 * Math.PI * SWAY_HZ * tSec), scaleMul: 1 };
    case 'drift': {
      // Slow side-to-side: ±0.5cm at 0.12Hz.
      const x = 0.5 * Math.sin(2 * Math.PI * DRIFT_HZ * tSec);
      return { position: [x, 0, 0], rotationY: 0, scaleMul: 1 };
    }
    case 'twinkle':
      // A 3D piece has no layer opacity; a faint shimmer of scale reads the same.
      return { position: [0, 0, 0], rotationY: 0, scaleMul: 1 + 0.02 * Math.sin(2 * Math.PI * TWINKLE_HZ * tSec) };
    case 'none':
    default:
      return IDENTITY_3D;
  }
}

/** The validated entrance fields of a stored 2D layer (untrusted jsonb). Only
 *  keys that are actually set are returned, so an object without them spreads
 *  to nothing and saves byte-identically. */
export interface IntroFields {
  intro?: LayerIntro;
  introDelayMs?: number;
  pivot?: { x: number; y: number };
}
export function introFieldsOf(v: { intro?: unknown; introDelayMs?: unknown; pivot?: unknown } | null | undefined): IntroFields {
  const out: IntroFields = {};
  if (!v) return out;
  if (isLayerIntro(v.intro)) out.intro = v.intro;
  const d = introDelayOf(v.introDelayMs);
  if (out.intro && d > 0) out.introDelayMs = d;
  const p = v.pivot as { x?: unknown; y?: unknown } | null | undefined;
  if (p && typeof p === 'object' && typeof p.x === 'number' && typeof p.y === 'number'
    && Number.isFinite(p.x) && Number.isFinite(p.y)) {
    const px = clamp01(p.x);
    const py = clamp01(p.y);
    if (px !== 0.5 || py !== 0.5) out.pivot = { x: px, y: py };
  }
  return out;
}
