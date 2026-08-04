/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Beam ceremony maths — PURE (no three.js, no React). BeamFX.tsx renders what
 * these functions describe; keeping the phase/colour/projection logic here puts
 * it under the vitest node suite and out of the render loop.
 *
 * Timing envelope follows the PlayCanvas optic-blast reference (charge → erupt
 * ~0.13s → sustain → fade), compressed so a full ceremony fits inside the
 * trigger engine's 2.5s default cooldown.
 *
 * Spaces: the booth's 3D world is MediaPipe head-metric CENTIMETRES with the
 * camera at the origin looking down −Z at 63° vertical FOV (faceRig.RIG_CAMERA).
 * `unprojectToDepth` maps normalized image coords into that world.
 */

import type { AssetCustomization } from '../../types';
import type { AssetTemplate } from './assetTemplate';
import type { BeamStyle, TriggerAction } from './triggers';

export type BeamAction = Extract<TriggerAction, { type: 'beam' }>;

export interface BeamSpec {
  style: BeamStyle;
  origin: 'head' | 'hand';
  /**
   * fxBus emitter-registry key of the piece this beam erupts from (the piece's
   * layer/object id). BeamFX follows that registered object's live world
   * transform — the visor's lens front, the wand's crystal tip, the gauntlet's
   * palm — falling back to the per-`origin` default when nothing is registered
   * under the key (asset still loading, no authored emitter, piece hidden).
   * Absent when the author FORCED `origin` — an explicit 'head'/'hand' must
   * never parent to a piece of the other family.
   */
  emitterKey?: string;
  /** Fully resolved hex — never 'auto' by the time it reaches the renderer. */
  colorHex: string;
  /** White-hot core colour, derived from colorHex. */
  coreHex: string;
  chargeMs: number;
  fireMs: number;
  holdMs: number;
  fadeMs: number;
  startedAt: number;
}

export interface BeamPhase {
  phase: 'charge' | 'fire' | 'hold' | 'fade' | 'done';
  /** 0..1 emissive/flare intensity (charge ramps 0→0.6, fire spikes to 1). */
  intensity: number;
  /** 0..1 how far the bolt has extended. */
  length01: number;
  /** 0..1 full-frame flash alpha — nonzero only across the eruption. */
  flash: number;
}

/** Ruby default — the classic optic blast (reference's --ruby). */
export const OPTIC_RED = '#ff2b4a';

export const BEAM_STYLE_TIMING: Record<
  BeamStyle,
  { chargeMs: number; fireMs: number; holdMs: number; fadeMs: number }
> = {
  optic: { chargeMs: 320, fireMs: 140, holdMs: 420, fadeMs: 320 },
  energy: { chargeMs: 260, fireMs: 120, holdMs: 300, fadeMs: 260 },
  sparkle: { chargeMs: 180, fireMs: 100, holdMs: 620, fadeMs: 400 },
  lightning: { chargeMs: 120, fireMs: 80, holdMs: 220, fadeMs: 180 },
};

const HEX_RE = /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/;

function expandHex(hex: string): string {
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return hex;
}

/** Mix a hex colour toward white in sRGB byte space (amount 0..1). */
export function lightenTowardWhite(hex: string, amount: number): string {
  const h = HEX_RE.test(hex) ? expandHex(hex) : '#ffffff';
  const a = Math.min(1, Math.max(0, amount));
  const c = (i: number): string => {
    const v = parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
    return Math.round(v + (255 - v) * a)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${c(0)}${c(1)}${c(2)}`;
}

/**
 * The region whose colour drives the beam: a region literally named 'lens' if
 * present, else the first recolourable region, else regions[0]. Exported so the
 * guest picker, the studio configurator and the renderer agree on "the lens".
 */
export function beamRegionId(template: AssetTemplate | null | undefined): string | null {
  if (!template || template.regions.length === 0) return null;
  const lens = template.regions.find((r) => r.id === 'lens');
  if (lens) return lens.id;
  const recolourable = template.regions.find((r) => r.recolourable);
  return (recolourable ?? template.regions[0]).id;
}

export interface BeamEmitterPiece {
  template?: AssetTemplate | null;
  customization?: AssetCustomization | null;
  /** The piece's emitter-registry key (its layer/object id). */
  fxKey?: string;
  /** Present ⇒ the piece rides a HandRig (drives 'auto' origin resolution). */
  handAnchor?: string;
}

/**
 * Lens hex → beam hex. Precedence: explicit action colour → the emitting
 * piece's customized lens-region hex → that region's authored default →
 * OPTIC_RED. 'auto' and absent both mean "read the piece".
 */
export function resolveBeamColor(action: BeamAction, piece: BeamEmitterPiece | null): string {
  if (typeof action.color === 'string' && action.color !== 'auto' && HEX_RE.test(action.color)) {
    return expandHex(action.color).toLowerCase();
  }
  const template = piece?.template ?? null;
  const region = beamRegionId(template);
  if (template && region !== null) {
    const part = piece?.customization?.parts?.[region];
    if (part?.hex !== undefined && part.hex !== null && HEX_RE.test(part.hex)) {
      return expandHex(part.hex).toLowerCase();
    }
    const authored = template.regions.find((r) => r.id === region);
    if (authored && HEX_RE.test(authored.defaultHex)) {
      return expandHex(authored.defaultHex).toLowerCase();
    }
  }
  return OPTIC_RED;
}

/**
 * Build the renderable spec for a fired beam action.
 *
 * Origin resolution ('auto'/absent): the EMITTING PIECE decides — a
 * hand-anchored wand fires from the hand rig even when a smile triggered it,
 * a head-worn visor fires from the head even on a fist clench. Only with no
 * piece at all does the firing gesture (`handFired`) break the tie. An
 * explicit 'head'/'hand' is a forced override: it wins outright AND drops the
 * piece emitter, so a beam can never parent to a rig of the other family.
 */
export function makeBeamSpec(
  action: BeamAction,
  piece: BeamEmitterPiece | null,
  handFired: boolean,
  nowMs: number,
): BeamSpec {
  const timing = BEAM_STYLE_TIMING[action.style];
  const forced = action.origin === 'head' || action.origin === 'hand';
  const origin =
    action.origin === 'head' || action.origin === 'hand'
      ? action.origin
      : piece !== null
        ? piece.handAnchor !== undefined
          ? 'hand'
          : 'head'
        : handFired
          ? 'hand'
          : 'head';
  const emitterKey = !forced && piece?.fxKey !== undefined && piece.fxKey !== '' ? piece.fxKey : undefined;
  const colorHex = resolveBeamColor(action, piece);
  const holdMs =
    typeof action.durationMs === 'number' && isFinite(action.durationMs) && action.durationMs > 0
      ? Math.min(4000, action.durationMs)
      : timing.holdMs;
  return {
    style: action.style,
    origin,
    ...(emitterKey !== undefined ? { emitterKey } : {}),
    colorHex,
    coreHex: lightenTowardWhite(colorHex, 0.82),
    chargeMs: timing.chargeMs,
    fireMs: timing.fireMs,
    holdMs,
    fadeMs: timing.fadeMs,
    startedAt: nowMs,
  };
}

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Where the ceremony is at `nowMs`. Pure — the renderer holds no phase state. */
export function beamPhaseAt(spec: BeamSpec, nowMs: number): BeamPhase {
  const t = nowMs - spec.startedAt;
  const fireStart = spec.chargeMs;
  const holdStart = fireStart + spec.fireMs;
  const fadeStart = holdStart + spec.holdMs;
  const end = fadeStart + spec.fadeMs;

  // 90ms triangular flash centred on the eruption boundary.
  const flashHalf = 45;
  const flash = Math.max(0, 1 - Math.abs(t - fireStart) / flashHalf);

  if (t < 0) return { phase: 'charge', intensity: 0, length01: 0, flash: 0 };
  if (t < fireStart) {
    const k = spec.chargeMs > 0 ? t / spec.chargeMs : 1;
    return { phase: 'charge', intensity: 0.6 * easeOutQuad(k), length01: 0, flash };
  }
  if (t < holdStart) {
    const k = spec.fireMs > 0 ? (t - fireStart) / spec.fireMs : 1;
    return { phase: 'fire', intensity: 0.6 + 0.4 * k, length01: easeOutCubic(k), flash };
  }
  if (t < fadeStart) {
    const k = spec.holdMs > 0 ? (t - holdStart) / spec.holdMs : 1;
    return { phase: 'hold', intensity: 1 - 0.28 * k, length01: 1, flash };
  }
  if (t < end) {
    const k = spec.fadeMs > 0 ? (t - fadeStart) / spec.fadeMs : 1;
    return { phase: 'fade', intensity: 0.72 * (1 - easeOutQuad(k)), length01: 1, flash: 0 };
  }
  return { phase: 'done', intensity: 0, length01: 1, flash: 0 };
}

/**
 * Normalized image coords (y DOWN, 0..1) → head-metric world cm at `depthCm`
 * in front of the camera. fovDeg is the VERTICAL fov over the full frame
 * (RIG_CAMERA.fov = 63); aspect = frame width / height.
 */
export function unprojectToDepth(
  nx: number,
  ny: number,
  depthCm: number,
  fovDeg: number,
  aspect: number,
): [number, number, number] {
  const halfH = Math.tan((fovDeg * Math.PI) / 360) * depthCm;
  const halfW = halfH * aspect;
  return [(nx * 2 - 1) * halfW, (1 - ny * 2) * halfH, -depthCm];
}

/** Mixed-adult palm length (wrist → middle MCP), cm. Research: male ~10.4,
 *  female ~9.5. Used only as the monocular scale constant. */
const PALM_LENGTH_CM = 10;
/** f/H for a 63° vertical FOV: 0.5 / tan(31.5°). */
const FOCAL_OVER_HEIGHT = 0.5 / Math.tan((63 * Math.PI) / 360);

/**
 * Monocular hand depth from the apparent palm span (normalized units of frame
 * HEIGHT). Pinhole: Z = f·S/s_px, which reduces to (f/H)·S/spanNorm — no frame
 * size needed. Clamped hard, and additionally clamped around the tracked
 * head's own depth when available: an unclamped estimate throws the beam to
 * infinity the frame a hand leaves view.
 */
export function estimateHandDepthCm(spanNorm: number, headZCm: number | null): number {
  const fallback = headZCm !== null && isFinite(headZCm) && headZCm > 0 ? headZCm : 60;
  if (!isFinite(spanNorm) || spanNorm <= 1e-4) return fallback;
  let depth = (FOCAL_OVER_HEIGHT * PALM_LENGTH_CM) / spanNorm;
  if (headZCm !== null && isFinite(headZCm) && headZCm > 0) {
    depth = Math.min(2.2 * headZCm, Math.max(0.5 * headZCm, depth));
  }
  return Math.min(300, Math.max(25, depth));
}
