/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The end-of-night recap: a guest's own photos rendered to a short animated
 * clip, entirely in the browser, with no new dependency and nothing uploaded.
 *
 * This file is the pure half — the timeline, the easing, the Ken Burns path and
 * the cover-crop arithmetic. It has no canvas, no MediaRecorder and no DOM, so
 * every number here is testable in the node-env suite. The component owns the
 * effects: a canvas, `captureStream()`, and the `StreamRecorder` in
 * `lib/recorder.ts` that the booth already uses to record video captures.
 *
 * Everything about this feature is additive and gated. `montageSupported()`
 * must be true before any of it is offered, the render only starts on a tap,
 * and a failure leaves the gallery exactly as it was.
 */

/** More than this and the recap stops being a recap. */
export const MAX_MONTAGE_SLIDES = 8;

export interface MontageOptions {
  /** On-screen time per photo, including its fade. */
  perSlideMs?: number;
  /** Crossfade length. Clamped so it can never exceed half a slide. */
  fadeMs?: number;
  fps?: number;
  width?: number;
  height?: number;
}

export interface MontageSlide {
  index: number;
  startMs: number;
  endMs: number;
}

export interface MontagePlan {
  slides: MontageSlide[];
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  fadeMs: number;
  perSlideMs: number;
}

const DEFAULTS = {
  perSlideMs: 1800,
  fadeMs: 400,
  fps: 30,
  // 720×1280 rather than 1080×1920: it is a share-to-a-group-chat clip, it has
  // to encode in real time on a phone, and the height is what people see.
  width: 720,
  height: 1280,
};

/**
 * Lay the photos out in time.
 *
 * Slides abut exactly — slide n ends where slide n+1 starts — because the
 * crossfade is drawn by overlapping the OUTGOING slide's tail on top of the
 * incoming one, not by leaving a gap the background would show through.
 */
export function montagePlan(count: number, opts: MontageOptions = {}): MontagePlan {
  const perSlideMs = Math.max(300, Math.round(opts.perSlideMs ?? DEFAULTS.perSlideMs));
  // A fade longer than half a slide would still be fading when the next one
  // starts, which reads as a permanent blur rather than a transition.
  const fadeMs = Math.max(0, Math.min(Math.round(opts.fadeMs ?? DEFAULTS.fadeMs), perSlideMs / 2));
  const n = Math.max(0, Math.min(Math.floor(count), MAX_MONTAGE_SLIDES));
  const slides: MontageSlide[] = [];
  for (let i = 0; i < n; i++) {
    slides.push({ index: i, startMs: i * perSlideMs, endMs: (i + 1) * perSlideMs });
  }
  return {
    slides,
    durationMs: n * perSlideMs,
    width: Math.max(2, Math.round(opts.width ?? DEFAULTS.width)),
    height: Math.max(2, Math.round(opts.height ?? DEFAULTS.height)),
    fps: Math.max(1, Math.round(opts.fps ?? DEFAULTS.fps)),
    fadeMs,
    perSlideMs,
  };
}

/** Which slide is on screen at `tMs`, and how far through it we are (0..1). */
export function slideAt(plan: MontagePlan, tMs: number): { index: number; progress: number } | null {
  if (plan.slides.length === 0) return null;
  if (tMs < 0) return { index: 0, progress: 0 };
  if (tMs >= plan.durationMs) {
    return { index: plan.slides.length - 1, progress: 1 };
  }
  const index = Math.min(plan.slides.length - 1, Math.floor(tMs / plan.perSlideMs));
  const local = tMs - plan.slides[index].startMs;
  return { index, progress: local / plan.perSlideMs };
}

/**
 * Opacity for the slide at `progress`.
 *
 * Fades in over the first `fadeMs`, holds, and stays fully opaque at the end —
 * the NEXT slide fading in underneath is what makes the transition, so fading
 * this one out too would flash the background between every pair.
 */
export function slideAlpha(plan: MontagePlan, progress: number): number {
  if (plan.fadeMs <= 0) return 1;
  const fadeFraction = plan.fadeMs / plan.perSlideMs;
  if (progress <= 0) return 0;
  if (progress >= fadeFraction) return 1;
  return progress / fadeFraction;
}

/** Smooth both ends; a linear Ken Burns pan reads as a machine, not a memory. */
export function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

export interface KenBurns {
  /** Zoom factor >= 1. 1 means the crop exactly covers the frame. */
  scale: number;
  /** Pan offsets in units of the spare crop, each in -1..1. */
  panX: number;
  panY: number;
}

/**
 * A slow push-in with a gentle drift, varied per slide so consecutive photos
 * do not move identically. Deterministic in `index`, so a re-render of the same
 * gallery produces the same film.
 */
export function kenBurns(progress: number, index: number): KenBurns {
  const e = easeInOut(Math.min(1, Math.max(0, progress)));
  // Alternate the direction and vary the amount; no randomness, so this is
  // reproducible and testable.
  const dir = index % 2 === 0 ? 1 : -1;
  const drift = 0.18 + (index % 3) * 0.06;
  return {
    scale: 1.06 + 0.1 * e,
    panX: dir * drift * (e - 0.5) * 2,
    panY: -drift * 0.5 * (e - 0.5) * 2,
  };
}

export interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * The source rectangle to draw so the image COVERS the frame at `scale`, panned
 * by `panX`/`panY`.
 *
 * `object-fit: cover` in arithmetic: take the largest centred crop of the
 * source with the destination's aspect ratio, shrink it by `scale` to zoom in,
 * then slide it within the leftover room. The result is always inside the
 * source bounds — a rectangle that runs off the edge draws transparent pixels
 * and would flash the canvas background mid-pan.
 */
export function coverRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  kb: KenBurns = { scale: 1, panX: 0, panY: 0 },
): SourceRect {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) {
    return { sx: 0, sy: 0, sw: Math.max(0, srcW), sh: Math.max(0, srcH) };
  }
  const dstAspect = dstW / dstH;
  // The biggest centred crop of the source with the destination's aspect.
  let baseW = srcW;
  let baseH = srcW / dstAspect;
  if (baseH > srcH) {
    baseH = srcH;
    baseW = srcH * dstAspect;
  }
  const scale = Math.max(1, kb.scale);
  const sw = baseW / scale;
  const sh = baseH / scale;
  // Room to pan, in source pixels, in each direction from centre.
  const roomX = (srcW - sw) / 2;
  const roomY = (srcH - sh) / 2;
  const clamp = (v: number) => Math.min(1, Math.max(-1, v));
  const sx = roomX + clamp(kb.panX) * roomX;
  const sy = roomY + clamp(kb.panY) * roomY;
  return { sx, sy, sw, sh };
}

/**
 * Can this browser record a canvas at all?
 *
 * Every clause is a real capability check, not a user-agent guess. If any of
 * them is missing the recap is never offered — an unsupported feature that
 * hides itself is honest, a button that throws is not.
 */
export function montageSupported(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (typeof MediaRecorder === 'undefined') return false;
  if (typeof HTMLCanvasElement === 'undefined') return false;
  if (typeof HTMLCanvasElement.prototype.captureStream !== 'function') return false;
  if (typeof createImageBitmap !== 'function') return false;
  try {
    return (
      MediaRecorder.isTypeSupported('video/webm') ||
      MediaRecorder.isTypeSupported('video/mp4')
    );
  } catch {
    return false;
  }
}

/** File name for the finished recap. */
export function recapFileName(prefix: string, ext: string): string {
  const clean = (prefix || 'recap').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${clean || 'recap'}-recap.${ext === 'mp4' ? 'mp4' : 'webm'}`;
}
