/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Live filter thumbnails — the imperative half of "every orb shows YOUR face
 * through THAT filter".
 *
 * ONE module-level engine for the whole page, deliberately not a hook's local
 * state and not a React context: the invariant that matters is "exactly one
 * WebGL context, ever", and a module singleton is the only structure that
 * guarantees it across two independent surfaces (the control deck's orb row
 * AND the "All filters" sheet, which can be mounted at the same time).
 *
 * WHAT IT COSTS, precisely:
 *   • one extra WebGL context, 96x96 (9,216 px), created lazily on the first
 *     subscriber and released — including `loseContext()` via
 *     `ShaderRunner.dispose()` — the moment the last one leaves;
 *   • exactly ONE shader draw per tick, round-robin, at 8 ticks/second. Not one
 *     per orb, not one per frame. With N filters each orb refreshes every
 *     N/8 seconds;
 *   • per tick: a 96x96 cover-crop `drawImage` of the video, a 96x96
 *     `texImage2D` (36 KB), one full-screen triangle over 9,216 fragments, and
 *     one 96x96 `drawImage` per orb showing that filter (normally 1).
 *
 * WHAT IT MUST NOT COST: anything on the booth's own render path. This engine
 * shares NOTHING with `StageCanvas` — not the runner, not the canvas, not the
 * rAF loop. `StageCanvas.drawFrame`, the capture runner and the ShadeGate are
 * untouched, so the photo a guest keeps is bit-for-bit what it was before this
 * file existed.
 *
 * It degrades to the orbs' existing static gradients whenever `thumbsEnabled`
 * says no — no WebGL, camera off, `prefers-reduced-motion`, hidden tab, or no
 * orb on screen.
 */
import { ShaderRunner } from '../../lib/shaders';
import {
  THUMB_PX, nextThumbIndex, shouldTick, thumbsEnabled,
} from '../../lib/filterThumbs';

interface Target {
  shaderId: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  /** Flips true after this canvas has real pixels, so the orb can cross-fade
   *  from its gradient instead of flashing an empty black square. */
  painted: boolean;
  onPaint?: () => void;
}

const targets = new Set<Target>();

let runner: ShaderRunner | null = null;
let raf = 0;
let index = 0;
let lastTick: number | null = null;

/** Source video + whether it is actually producing frames. Owned by the Booth,
 *  pushed in rather than looked up, so this module never guesses a DOM id. */
let video: HTMLVideoElement | null = null;
let cameraReady = false;
let mirrored = true;

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function documentHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden === true;
}

/** Distinct shader ids currently on screen, in a stable order. */
function shaderList(): string[] {
  const seen: string[] = [];
  for (const t of targets) if (!seen.includes(t.shaderId)) seen.push(t.shaderId);
  return seen;
}

function ensureRunner(): ShaderRunner | null {
  if (runner) return runner;
  try {
    runner = new ShaderRunner(THUMB_PX, THUMB_PX);
  } catch {
    runner = null; // no WebGL — every orb stays on its gradient
    return null;
  }
  if (!runner.available) {
    runner.dispose();
    runner = null;
    return null;
  }
  return runner;
}

function teardown() {
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  runner?.dispose();
  runner = null;
  lastTick = null;
  index = 0;
}

function gateOpen(): boolean {
  return thumbsEnabled({
    webgl: runner?.available ?? false,
    cameraReady,
    reducedMotion: reducedMotion(),
    documentHidden: documentHidden(),
    subscribers: targets.size,
  });
}

function loop(now: number) {
  raf = requestAnimationFrame(loop);
  if (!gateOpen()) return;
  if (!shouldTick(lastTick, now)) return;

  const v = video;
  // readyState < 2 means no decodable frame yet; skip WITHOUT consuming the
  // slot, so the round-robin does not silently drop a filter on a slow start.
  if (!v || v.readyState < 2) return;

  const ids = shaderList();
  if (ids.length === 0) return;
  lastTick = now;
  if (index >= ids.length) index = 0;
  const shaderId = ids[index];
  index = nextThumbIndex(index, ids.length);

  const r = runner;
  if (!r) return;
  const out = r.draw(v, shaderId);
  if (!out) return;

  for (const t of targets) {
    if (t.shaderId !== shaderId || !t.ctx) continue;
    const c = t.ctx;
    c.save();
    // Match the viewfinder: the front camera is shown mirrored, so a thumbnail
    // that was not would read as somebody else's face.
    if (mirrored) { c.translate(THUMB_PX, 0); c.scale(-1, 1); }
    c.drawImage(out, 0, 0, THUMB_PX, THUMB_PX);
    c.restore();
    if (!t.painted) {
      t.painted = true;
      t.onPaint?.();
    }
  }
}

function start() {
  if (raf) return;
  if (!ensureRunner()) return;
  raf = requestAnimationFrame(loop);
}

function sync() {
  if (targets.size === 0) {
    teardown();
    return;
  }
  start();
}

/**
 * Point the engine at the booth's video element.
 *
 * `ready` is the camera hook's own readiness flag rather than anything this
 * module infers — one source of truth for "is there a picture".
 */
export function setThumbSource(el: HTMLVideoElement | null, ready: boolean, mirror: boolean): void {
  video = el;
  cameraReady = ready;
  mirrored = mirror;
  // A source change invalidates whatever is on the orbs; let them repaint.
  if (!ready) for (const t of targets) t.painted = false;
  sync();
}

/**
 * Subscribe one orb canvas to one shader. Returns the unsubscribe function.
 *
 * The caller owns the <canvas> element; this only writes pixels into it and
 * never removes it, so React stays the sole owner of the DOM.
 */
export function registerThumbTarget(
  shaderId: string,
  canvas: HTMLCanvasElement,
  onPaint?: () => void,
): () => void {
  canvas.width = THUMB_PX;
  canvas.height = THUMB_PX;
  const target: Target = {
    shaderId,
    canvas,
    ctx: canvas.getContext('2d'),
    painted: false,
    onPaint,
  };
  targets.add(target);
  sync();
  return () => {
    targets.delete(target);
    sync();
  };
}

/** Test/diagnostic seam — the live subscriber count. */
export function thumbTargetCount(): number {
  return targets.size;
}
