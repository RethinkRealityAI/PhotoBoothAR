/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The booth's drawing budget. PURE apart from two tiny module-level slots
 * (the pre-composite hook and the counters), so it is tested in node.
 *
 * Why it exists: the booth's composite (StageCanvas) and its 3D canvas
 * (Overlay3D) used to redraw on EVERY screen refresh — 120 times a second on a
 * 120 Hz phone — while the camera delivers 30 new frames a second and, on 3D
 * looks, the picture only changes when the face tracker hands over a new frame.
 * Every extra redraw is GPU and main-thread time taken from the face tracker
 * and the video encoder. The gate below caps both at one budget, and the
 * pre-composite hook renders the 3D canvas in the SAME animation frame, right
 * before the composite reads it, so props never trail the picture by a frame.
 */

/** Default cap for platform booths: the camera's own rate. */
export const BOOTH_FPS_DEFAULT = 30;
/** Tester A/B: `?fps=0` = uncapped (the old behaviour), `?fps=24|30|60…` = that cap. */
export const BOOTH_FPS_URL_PARAM = 'fps';
/** Frames landing this close before the boundary still count (rAF jitter). */
const SLACK_MS = 2;

/** `?fps=` value → cap (0 = uncapped), or null when absent/invalid. */
export function parseFpsCap(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v.trim() === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 240) return null;
  return Math.round(n);
}

/** The cap a platform booth runs at: URL override, else the default. */
export function resolveBoothFpsCap(search: string): number {
  let fromUrl: number | null = null;
  try {
    fromUrl = parseFpsCap(new URLSearchParams(search).get(BOOTH_FPS_URL_PARAM));
  } catch {
    fromUrl = null;
  }
  return fromUrl ?? BOOTH_FPS_DEFAULT;
}

export interface FrameGate {
  /** ms between draws; 0 = draw every frame. */
  interval: number;
  /** Earliest time (ms) of the next draw. */
  next: number;
}

export function createFrameGate(fps: number): FrameGate {
  return { interval: fps > 0 ? 1000 / fps : 0, next: Number.NEGATIVE_INFINITY };
}

/**
 * Call once per animation frame with its timestamp. True = draw this frame.
 * Keeps phase (a 60 Hz screen draws every 2nd frame, 120 Hz every 4th) and
 * re-syncs after a long gap instead of bursting to catch up.
 */
export function frameGateShouldDraw(g: FrameGate, now: number): boolean {
  if (g.interval <= 0) return true;
  if (now + SLACK_MS < g.next) return false;
  g.next = now - g.next > g.interval ? now + g.interval : g.next + g.interval;
  return true;
}

/* ------------------------------------------------------------------ */
/* Pre-composite render hook (one composited 3D canvas per booth)      */
/* ------------------------------------------------------------------ */

type PreComposite = (now: number) => void;
let preComposite: PreComposite | null = null;

/** Overlay3D registers its synchronous render here; returns the release. */
export function setPreCompositeRender(fn: PreComposite): () => void {
  preComposite = fn;
  return () => {
    if (preComposite === fn) preComposite = null;
  };
}

/** StageCanvas calls this right before it composites a frame. */
export function runPreCompositeRender(now: number): void {
  if (preComposite === null) return;
  try {
    preComposite(now);
  } catch (e) {
    console.warn('[frameBudget] 3D render failed', e);
  }
}

/* ------------------------------------------------------------------ */
/* Counters for the tester readout (?trackdebug)                       */
/* ------------------------------------------------------------------ */

/** Monotonic counts; the readout turns deltas into per-second rates. */
export const boothFrameCounters = { composite: 0, render3d: 0 };
