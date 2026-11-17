/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The face-engine manager: which engine produces head poses right now, and the
 * one place faceRig.ts asks for samples. Everything above it (FaceRig,
 * triggers, capture, hands) never learns which engine runs.
 *
 * Modes (engineSelect.ts owns the policy):
 *   'mediapipe' — today's path, byte-for-byte (mediapipeEngine.ts).
 *   'xr8'       — 8th Wall pose + its own coarse expressions.
 *   'hybrid'    — 8th Wall pose + MediaPipe blendshapes at ~15/s. Until 8th
 *                 Wall is up, plain MediaPipe drives the pose so the guest is
 *                 never untracked while it loads.
 *
 * 8th Wall is loaded ONLY via a dynamic import, so a session that never asks
 * for it (every legacy site, every 'mediapipe' filter) never downloads it.
 * Its init is raced against XR8_INIT_TIMEOUT_MS; a rejection OR a timeout
 * falls back to MediaPipe for the rest of the session (sticky: a phone that
 * cannot run 8th Wall must not re-hang for 12s on every filter switch), the
 * reason is recorded for the readout, and reported once via client_errors.
 * At most ONE 8th Wall engine is ever alive or initializing.
 */
import type { FaceEngine, FaceSample, FaceTrackingMode } from './types';
import { createMediapipeEngine, type MediapipeFaceEngine } from './mediapipeEngine';
import {
  hasFaceExpressionTrigger,
  modeNeedsMediapipe,
  modeNeedsXr8,
  readFaceEngineOverride,
  resolveFaceTrackingMode,
  type ResolvedMode,
} from './engineSelect';

export type { FaceTrackingMode, FaceSample } from './types';

/** Long enough for a cold 8th Wall download + wasm compile on a mid phone over
 *  venue wifi; short enough that a guest is not left untracked for long. */
export const XR8_INIT_TIMEOUT_MS = 12_000;

/** A frozen single-event build (same test as App.tsx LEGACY_EVENT). */
export const IS_LEGACY_BUILD = ((import.meta.env.VITE_EVENT as string | undefined) ?? '').trim() !== '';
const ENV_FACE_ENGINE = import.meta.env.VITE_FACE_ENGINE as string | undefined;

function sessionStore(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}
function urlOverride(): FaceTrackingMode | null {
  if (typeof window === 'undefined') return null;
  return readFaceEngineOverride(window.location.search, sessionStore());
}

/**
 * Resolve the mode for a surface. `legacy` adds a coded (`source !== 'db'`)
 * event to the build-level legacy test; `config` is the selected experience's
 * raw `config.tracking`; `triggers` drive the default's auto-hybrid upgrade.
 */
export function resolveSurfaceFaceMode(opts: {
  legacy?: boolean;
  config?: unknown;
  triggers?: readonly { source: string }[] | null;
} = {}): ResolvedMode {
  return resolveFaceTrackingMode({
    legacy: IS_LEGACY_BUILD || opts.legacy === true,
    url: urlOverride(),
    config: opts.config,
    env: ENV_FACE_ENGINE,
    hasFaceTriggers: hasFaceExpressionTrigger(opts.triggers),
  });
}

export interface FaceEngineInfo {
  /** The mode surfaces asked for. */
  requested: FaceTrackingMode;
  /** The mode producing poses right now; null while nothing is ready yet. */
  active: FaceTrackingMode | null;
  /** 8th Wall was requested but could not start → MediaPipe runs instead. */
  fellBack: boolean;
  reason: string | null;
  /** Some engine can produce poses (drives "loading tracker" UI). */
  ready: boolean;
  /** Even the final fallback (MediaPipe) failed to start. */
  failed: boolean;
}

type Status = 'idle' | 'loading' | 'ready' | 'failed';

let requested: FaceTrackingMode = resolveSurfaceFaceMode().mode;
let mp: MediapipeFaceEngine | null = null;
let mpStatus: Status = 'idle';
let xr8: FaceEngine | null = null;
let xr8Status: Status = 'idle';
let xr8Reason: string | null = null;
/** A surface has asked for tracking at least once (nothing loads before that). */
let wanted = false;
let reportedFallback = false;
let warnedUnwanted = false;

const listeners = new Set<() => void>();
let info: FaceEngineInfo = computeInfo();

function getMp(): MediapipeFaceEngine {
  if (mp === null) mp = createMediapipeEngine();
  return mp;
}

/** The mode that actually runs: an 8th Wall mode whose engine failed → MediaPipe. */
function effectiveMode(): FaceTrackingMode {
  return modeNeedsXr8(requested) && xr8Status === 'failed' ? 'mediapipe' : requested;
}

function computeInfo(): FaceEngineInfo {
  const eff = effectiveMode();
  const mpReady = mpStatus === 'ready';
  const xrReady = xr8Status === 'ready' && xr8 !== null;
  let active: FaceTrackingMode | null = null;
  if (eff === 'mediapipe') active = mpReady ? 'mediapipe' : null;
  else if (eff === 'xr8') active = xrReady ? 'xr8' : null;
  else active = xrReady ? 'hybrid' : mpReady ? 'mediapipe' : null;
  const fellBack = modeNeedsXr8(requested) && xr8Status === 'failed';
  return {
    requested,
    active,
    fellBack,
    reason: fellBack ? xr8Reason : null,
    ready: active !== null,
    failed: active === null && eff === 'mediapipe' && mpStatus === 'failed',
  };
}

function emit(): void {
  const next = computeInfo();
  const same =
    next.requested === info.requested && next.active === info.active && next.fellBack === info.fellBack &&
    next.reason === info.reason && next.ready === info.ready && next.failed === info.failed;
  if (same) return;
  info = next; // a NEW object only on change → a stable useSyncExternalStore snapshot
  for (const l of [...listeners]) {
    try { l(); } catch { /* a listener must not break the manager */ }
  }
}

function describe(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.slice(0, 200) || 'unknown error';
}

function reportFallbackOnce(reason: string): void {
  if (reportedFallback) return;
  reportedFallback = true;
  console.warn(`[faceEngine] 8th Wall unavailable, using MediaPipe: ${reason}`);
  // Dynamic: errorReport pulls the supabase client, which node tests of
  // faceRig must not construct. Fire-and-forget; telemetry never throws here.
  void import('../errorReport')
    .then((m) => m.reportError(new Error(`face engine fallback xr8 -> mediapipe: ${reason}`), {
      faceEngine: { requested, reason },
    }))
    .catch(() => {});
}

function startMp(): void {
  if (mpStatus !== 'idle') return;
  mpStatus = 'loading';
  getMp()
    .init()
    .then(() => { mpStatus = 'ready'; })
    .catch((e) => {
      console.warn('[faceEngine] MediaPipe face tracker init failed', e);
      mpStatus = 'failed';
    })
    .finally(emit);
}

function startXr8(): void {
  if (xr8Status !== 'idle') return; // loading/ready = never a second engine; failed = sticky
  xr8Status = 'loading';
  let engine: FaceEngine | null = null;
  let abandoned = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`8th Wall init timed out after ${XR8_INIT_TIMEOUT_MS / 1000}s`)),
      XR8_INIT_TIMEOUT_MS,
    );
  });
  const boot = (async () => {
    const { createXr8Engine } = await import('./xr8Engine');
    engine = createXr8Engine();
    await engine.init();
    // Finished after the timeout already gave up on it: stop it, do not leak it.
    if (abandoned) engine.dispose();
  })();
  boot.catch(() => {}); // a late rejection after the timeout is not unhandled
  Promise.race([boot, timeout])
    .then(() => {
      if (!modeNeedsXr8(effectiveMode())) {
        // The guest switched to a MediaPipe filter while 8th Wall was loading.
        safeDispose(engine);
        xr8Status = 'idle';
        return;
      }
      xr8 = engine;
      xr8Status = 'ready';
    })
    .catch((e) => {
      abandoned = true;
      safeDispose(engine);
      xr8 = null;
      xr8Status = 'failed';
      xr8Reason = describe(e);
      reportFallbackOnce(xr8Reason);
    })
    .finally(() => {
      clearTimeout(timer);
      if (wanted) ensureEngines();
      emit();
    });
}

function safeDispose(e: FaceEngine | null): void {
  if (!e) return;
  try { e.dispose(); } catch { /* dispose must not break a mode switch */ }
}

/** Start what the effective mode needs; stop 8th Wall when it no longer does. */
function ensureEngines(): void {
  const eff = effectiveMode();
  if (!modeNeedsXr8(eff) && xr8Status === 'ready') {
    safeDispose(xr8);
    xr8 = null;
    xr8Status = 'idle';
  }
  if (modeNeedsXr8(eff)) startXr8();
  if (modeNeedsMediapipe(eff)) startMp();
}

/**
 * Engine starts are deferred to a microtask and coalesced. React runs a
 * CHILD's effects before its parent's, so FaceRig's self-init fires before the
 * Booth's setFaceTrackingMode — starting synchronously would begin an 8th Wall
 * download for a coded (always-MediaPipe) event in the gap. A microtask runs
 * after the whole effect flush, so it sees the mode the parent just set.
 */
let ensureQueued = false;
function scheduleEnsure(): void {
  if (ensureQueued) return;
  ensureQueued = true;
  queueMicrotask(() => {
    ensureQueued = false;
    if (wanted) ensureEngines();
    emit();
  });
}

/**
 * Pick the engine for the surface's current filter. Idempotent; switching
 * between 'xr8' and 'hybrid' keeps the running 8th Wall engine, leaving the
 * 8th Wall family disposes it, and MediaPipe's landmarker stays cached.
 */
export function setFaceTrackingMode(mode: FaceTrackingMode): void {
  if (mode === requested) return;
  requested = mode;
  emit();
  scheduleEnsure();
}

/**
 * Start face tracking for the current mode (replaces direct
 * initializeFaceLandmarker() calls on face surfaces). Idempotent. Resolves
 * once SOME engine produces poses — after an automatic fallback too — and
 * rejects only when even MediaPipe cannot start (a later call retries it,
 * exactly as initializeFaceLandmarker allowed).
 */
export function initFaceEngine(): Promise<void> {
  wanted = true;
  if (mpStatus === 'failed') mpStatus = 'idle';
  emit(); // clear a stale `failed` before the check below, so a retry waits
  scheduleEnsure();
  return new Promise<void>((resolve, reject) => {
    let off: () => void = () => {};
    const check = (): boolean => {
      if (info.ready) { off(); resolve(); return true; }
      if (info.failed) { off(); reject(new Error('face tracker unavailable')); return true; }
      return false;
    };
    if (check()) return;
    off = subscribeFaceEngine(() => { check(); });
  });
}

export function subscribeFaceEngine(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Snapshot for the readout / loading states (stable until something changes). */
export function getActiveFaceEngineInfo(): FaceEngineInfo {
  return info;
}

export function isFaceEngineReady(): boolean {
  return info.ready;
}

/** performance.now() of the last blocking face inference on the main thread
 *  (hybrid: the later of both engines), or -Infinity. */
export function faceInferenceMs(): number {
  const a = mp !== null ? mp.lastInferenceMs() : -Infinity;
  const b = xr8 !== null ? safeLast(xr8) : -Infinity;
  return Math.max(a, b);
}
function safeLast(e: FaceEngine): number {
  try {
    const v = e.lastInferenceMs();
    return Number.isFinite(v) || v === -Infinity ? v : -Infinity;
  } catch {
    return -Infinity;
  }
}

export interface FacePoll {
  /** New pose sample (matrix, keypoints, and blendshapes when poseHasExpr). */
  pose: FaceSample | null;
  /** Hybrid only: a MediaPipe blendshape sample (its pose is discarded). */
  expr: FaceSample | null;
  /** false in hybrid: the pose sample's own blendshapes are ignored. */
  poseHasExpr: boolean;
}
const _poll: FacePoll = { pose: null, expr: null, poseHasExpr: true };

function pollXr8(video: HTMLVideoElement, now: number): FaceSample | null {
  if (xr8 === null) return null;
  try {
    return xr8.poll(video, now);
  } catch {
    return null; // contract says never throws; a defect there must not stop the frame
  }
}

/**
 * The samples for this render frame. Reuses one result object (zero alloc).
 * Mode 'mediapipe' is exactly the old inline detection: one gated poll.
 */
export function pollFaceEngine(video: HTMLVideoElement, now: number): FacePoll {
  _poll.pose = null;
  _poll.expr = null;
  _poll.poseHasExpr = true;
  const eff = effectiveMode();
  if (eff === 'mediapipe') {
    _poll.pose = getMp().poll(video, now);
    return _poll;
  }
  if (!wanted && !warnedUnwanted) {
    warnedUnwanted = true;
    console.warn('[faceEngine] polled but initFaceEngine() was never called — face tracking will not work on this surface.');
  }
  const xrReady = xr8Status === 'ready' && xr8 !== null;
  if (eff === 'xr8') {
    if (xrReady) _poll.pose = pollXr8(video, now);
    return _poll;
  }
  // hybrid
  if (xrReady) {
    _poll.pose = pollXr8(video, now);
    _poll.poseHasExpr = false;
    if (mp !== null) _poll.expr = mp.pollBlendshapes(video, now);
  } else if (mp !== null) {
    _poll.pose = mp.poll(video, now); // interim: plain MediaPipe while 8th Wall loads
  }
  return _poll;
}
