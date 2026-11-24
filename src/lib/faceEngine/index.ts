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
  needsMediapipeExpressions,
  modeNeedsMediapipe,
  modeNeedsXr8,
  readFaceEngineOverride,
  readFrameLockOverride,
  resolveFaceTrackingMode,
  resolveFrameLock,
  type FrameLockSource,
  type ResolvedMode,
} from './engineSelect';

export type { FaceTrackingMode, FaceSample, ExtraFace } from './types';
import type { ExtraFace } from './types';
import { claimFrameInference } from './inferenceToken';
import { estimateEars, type EarEstimate } from './earPoints';
import { readMaxFacesOverride, resolveMaxFaces } from './multiFace';
import { createFrameLockGuard, frameLockShouldUseLive, resetFrameLockGuard } from './frameLockGuard';
export { claimFrameInference, FRAME_INFERENCE_TOKEN } from './inferenceToken';

/** Long enough for a cold 8th Wall download + wasm compile on a mid phone over
 *  venue wifi; short enough that a guest is not left untracked for long. */
export const XR8_INIT_TIMEOUT_MS = 12_000;
/**
 * MediaPipe's own init bound. Its wasm/model fetches have no timeout of their
 * own, so a blackholed network left `mpStatus` 'loading' forever and no later
 * initFaceEngine() could retry it.
 */
export const MP_INIT_TIMEOUT_MS = 15_000;
/**
 * The guest-facing promise: if NO engine produces poses this long after a
 * surface asked, every surface shows its failed state (info.failed) instead of
 * an endless "Loading face tracker". Loading carries on behind it, and a late
 * success still flips the surface to ready.
 */
export const TRACKER_INIT_DEADLINE_MS = 15_000;
/** Landmarker resets (DETECT_THROWS_BEFORE_RESET each) before MediaPipe is given up as failed. */
export const MAX_MP_RECOVERIES = 3;

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
function urlFrameLock(): boolean | null {
  if (typeof window === 'undefined') return null;
  return readFrameLockOverride(window.location.search, sessionStore());
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
  /** The scene paints on the face mesh (Living Face Paint) → needs 8th Wall. */
  facePaint?: boolean;
} = {}): ResolvedMode {
  return resolveFaceTrackingMode({
    legacy: isLegacyFaceSurface(opts.legacy === true),
    url: urlOverride(),
    config: opts.config,
    env: ENV_FACE_ENGINE,
    hasFaceTriggers: needsMediapipeExpressions(opts.triggers),
    requiresFaceMesh: opts.facePaint === true,
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
  /** Even the final fallback (MediaPipe) failed to start, or nothing was ready by
   *  TRACKER_INIT_DEADLINE_MS. Clears again if an engine comes up later. */
  failed: boolean;
  /** Last tracker problem worth surfacing (init failure/timeout, landmarker lost), or null. */
  error: string | null;
  /** The compositor draws the tracked frame (see getTrackedFrame). */
  frameLock: boolean;
  frameLockSource: FrameLockSource;
}

type Status = 'idle' | 'loading' | 'ready' | 'failed';

let requested: FaceTrackingMode = resolveSurfaceFaceMode().mode;
/** The surface is a coded (`source !== 'db'`) event — legacy rules apply (see setFaceTrackingMode). */
let legacySurface = false;
let mp: MediapipeFaceEngine | null = null;
let mpStatus: Status = 'idle';
let mpRecoveries = 0;
let mpError: string | null = null;
let deadlineHit = false;
let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
/** StageCanvases that composite 3D and so want the tracked frame (ref count). */
let frameLockHolders = 0;
/** t of the last POSE sample handed to faceRig — the tracked frame's identity. */
let lastPoseT = Number.NaN;
/** `now` of the last pollFaceEngine call (performance.now() in the app): the frame-lock guard's clock. */
let lastPollNow = Number.NaN;
/** Frame-lock falls back to the live camera while the tracker has stalled (frameLockGuard.ts). */
const lockGuard = createFrameLockGuard();
let xr8: FaceEngine | null = null;
let xr8Status: Status = 'idle';
let xr8Reason: string | null = null;
/** maxFaces the current/last 8th Wall engine was created with (multiFace.ts). */
let xr8MaxFaces = 1;
/** A surface has asked for tracking at least once (nothing loads before that). */
let wanted = false;
let reportedFallback = false;
let warnedUnwanted = false;

const listeners = new Set<() => void>();
let info: FaceEngineInfo = computeInfo();

/**
 * THE legacy test for a surface, shared by the mode resolver (resolveSurfaceFaceMode)
 * and every caller that gates platform-only behaviour on the same rule: a frozen
 * `VITE_EVENT` build, or a coded event (`codedEvent` = `source !== 'db'`).
 */
export function isLegacyFaceSurface(codedEvent: boolean): boolean {
  return IS_LEGACY_BUILD || codedEvent;
}

/** Legacy rules for this session: a frozen build, or a coded event surface. */
export function isLegacyFaceSession(): boolean {
  return IS_LEGACY_BUILD || legacySurface;
}

function getMp(): MediapipeFaceEngine {
  if (mp === null) {
    mp = createMediapipeEngine({ onLost: handleMpLost });
    mp.setPlatformPath(!isLegacyFaceSession());
  }
  return mp;
}

/** The landmarker went bad (every inference threw) and was closed: rebuild it, say so. */
function handleMpLost(reason: string): void {
  mpRecoveries++;
  mpError = reason;
  console.warn(`[faceEngine] ${reason} — re-initialising (${mpRecoveries}/${MAX_MP_RECOVERIES})`);
  reportOnce('mp-lost', reason);
  mpStatus = mpRecoveries > MAX_MP_RECOVERIES ? 'failed' : 'idle';
  emit();
  scheduleEnsure();
}

/** The mode that actually runs: an 8th Wall mode whose engine failed → MediaPipe. */
function effectiveMode(): FaceTrackingMode {
  return modeNeedsXr8(requested) && xr8Status === 'failed' ? 'mediapipe' : requested;
}

function activeMode(): FaceTrackingMode | null {
  const eff = effectiveMode();
  const mpReady = mpStatus === 'ready';
  const xrReady = xr8Status === 'ready' && xr8 !== null;
  if (eff === 'mediapipe') return mpReady ? 'mediapipe' : null;
  if (eff === 'xr8') return xrReady ? 'xr8' : null;
  return xrReady ? 'hybrid' : mpReady ? 'mediapipe' : null;
}

function computeInfo(): FaceEngineInfo {
  const eff = effectiveMode();
  const active = activeMode();
  const fellBack = modeNeedsXr8(requested) && xr8Status === 'failed';
  const lock = resolveFrameLock({ legacy: isLegacyFaceSession(), mode: active ?? eff, url: urlFrameLock() });
  return {
    requested,
    active,
    fellBack,
    reason: fellBack ? xr8Reason : null,
    ready: active !== null,
    failed: active === null && ((eff === 'mediapipe' && mpStatus === 'failed') || deadlineHit),
    error: active === null && deadlineHit && mpError === null ? 'face tracker did not start in time' : mpError,
    frameLock: lock.on && frameLockHolders > 0,
    frameLockSource: lock.source,
  };
}

/** Only MediaPipe pays for a full-res copy per detection, and only while it is the pose engine of a frame-locked surface. */
function applyFrameSnapshot(): void {
  if (mp === null) return;
  mp.setFrameSnapshot(info.frameLock && info.active === 'mediapipe');
}

function emit(): void {
  const next = computeInfo();
  const same =
    next.requested === info.requested && next.active === info.active && next.fellBack === info.fellBack &&
    next.reason === info.reason && next.ready === info.ready && next.failed === info.failed &&
    next.error === info.error && next.frameLock === info.frameLock && next.frameLockSource === info.frameLockSource;
  if (same) return;
  info = next; // a NEW object only on change → a stable useSyncExternalStore snapshot
  if (info.ready) deadlineHit = false; // a late success clears the deadline failure for good
  applyFrameSnapshot();
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
  reportOnce('fallback', `face engine fallback xr8 -> mediapipe: ${reason}`);
}

const reported = new Set<string>();
/** client_errors, once per kind per session. */
function reportOnce(kind: string, message: string): void {
  if (reported.has(kind)) return;
  reported.add(kind);
  // Dynamic: errorReport pulls the supabase client, which node tests of
  // faceRig must not construct. Fire-and-forget; telemetry never throws here.
  void import('../errorReport')
    .then((m) => m.reportError(new Error(message), { faceEngine: { requested, kind } }))
    .catch(() => {});
}

function startMp(): void {
  if (mpStatus !== 'idle') return;
  mpStatus = 'loading';
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(`MediaPipe init timed out after ${MP_INIT_TIMEOUT_MS / 1000}s`));
    }, MP_INIT_TIMEOUT_MS);
  });
  const boot = getMp().init();
  // A boot that finishes after the timeout gave up still makes the landmarker:
  // adopt it (the guest gets tracking late rather than never).
  boot.then(
    () => {
      if (timedOut && mpStatus === 'failed') {
        mpStatus = 'ready';
        mpError = null;
        emit();
      }
    },
    () => {},
  );
  Promise.race([boot, timeout])
    .then(() => {
      mpStatus = 'ready';
      mpError = null;
    })
    .catch((e) => {
      console.warn('[faceEngine] MediaPipe face tracker init failed', e);
      mpStatus = 'failed';
      mpError = describe(e);
      reportOnce('mp-init', `face tracker init failed: ${mpError}`);
    })
    .finally(() => {
      clearTimeout(timer);
      emit();
    });
}

/** The camera <video> faceRig last polled with (for the 8th Wall warm start). */
let lastVideo: HTMLVideoElement | null = null;
/** An 8th Wall engine created but not yet adopted (init still running). */
let pendingXr8: (FaceEngine & { prewarm?(video: HTMLVideoElement): void }) | null = null;

/** Hand the loading 8th Wall engine the real camera so it starts on real frames
 *  (measured by Agent A: time-to-first-pose 1616 → 888 ms). Never throws. */
function prewarmPending(): void {
  if (pendingXr8 === null || lastVideo === null) return;
  try { pendingXr8.prewarm?.(lastVideo); } catch { /* a warm start is only an optimisation */ }
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
  // Fixed per engine: 8th Wall reads maxDetections only before it runs.
  const maxFaces = resolveMaxFaces({
    legacy: isLegacyFaceSession(),
    url: typeof window !== 'undefined' ? readMaxFacesOverride(window.location.search) : null,
  });
  const boot = (async () => {
    const { createXr8Engine } = await import('./xr8Engine');
    engine = createXr8Engine({ maxFaces });
    xr8MaxFaces = maxFaces;
    pendingXr8 = engine;
    prewarmPending(); // before init(): the session binds the real <video>, not a placeholder
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
      if (pendingXr8 === engine) pendingXr8 = null;
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
export function setFaceTrackingMode(mode: FaceTrackingMode, opts: { legacy?: boolean } = {}): void {
  // `legacy` = a coded (`source !== 'db'`) event surface: its detection input,
  // pose filter and frame stay on the shipped path (the resolver already pins
  // its MODE to MediaPipe). Absent = platform, which every non-booth surface is.
  const legacy = opts.legacy === true;
  if (mode === requested && legacy === legacySurface) return;
  requested = mode;
  if (legacy !== legacySurface) {
    legacySurface = legacy;
    mp?.setPlatformPath(!isLegacyFaceSession());
  }
  emit();
  scheduleEnsure();
}

/**
 * A StageCanvas that composites 3D asks for the tracked frame. Returns the
 * release. Whether frame-lock is actually ON is the resolver's call
 * (legacy / URL / mode); this only says somebody would draw it.
 */
export function retainFrameLock(): () => void {
  frameLockHolders++;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    frameLockHolders = Math.max(0, frameLockHolders - 1);
    emit();
  };
}

export interface TrackedFrame {
  /** Full video frame, UNMIRRORED, at video pixel size — draw it exactly like the <video>. */
  source: HTMLCanvasElement | OffscreenCanvas;
  width: number;
  height: number;
  /** Changes when (and only when) the frame changes: t of the pose sample it belongs to. */
  key: number;
}
const _tracked: TrackedFrame = { source: null as unknown as HTMLCanvasElement, width: 0, height: 0, key: Number.NaN };

/**
 * The camera frame the CURRENT pose was computed from, when frame-lock is on
 * and the pose engine can hand one over; else null (draw the live <video>).
 * Reuses one result object (called per composite frame).
 */
export function getTrackedFrame(): TrackedFrame | null {
  if (!info.frameLock) return null;
  const a = info.active;
  let src: HTMLCanvasElement | OffscreenCanvas | null = null;
  try {
    if (a === 'mediapipe') src = mp !== null ? mp.getAnalysedFrame() : null;
    else if (a === 'xr8' || a === 'hybrid') src = xr8?.getAnalysedFrame?.() ?? null;
  } catch {
    src = null;
  }
  if (src === null || !(src.width > 0) || !(src.height > 0)) return null;
  // The tracker has stalled (fast move, no new sample): a held frame is a frozen
  // picture. Show the live camera until samples flow again.
  if (frameLockShouldUseLive(lockGuard, lastPollNow, lastPoseT)) return null;
  _tracked.source = src;
  _tracked.width = src.width;
  _tracked.height = src.height;
  _tracked.key = lastPoseT;
  return _tracked;
}

/** Times frame-lock fell back to the live camera because tracking stalled (tester readout). */
export function getFrameLockFallbacks(): number {
  return lockGuard.fallbacks;
}

/** The tracked frame's image, or null (see getTrackedFrame). */
export function getTrackedFrameSource(): CanvasImageSource | null {
  return getTrackedFrame()?.source ?? null;
}

/** Is the compositor currently frame-locked? */
export function isFrameLockActive(): boolean {
  return info.frameLock;
}

/** The reused downscaled MediaPipe detection input (platform), or null. HANDOFF for handRig. */
export function getFaceDetectionCanvas(): HTMLCanvasElement | null {
  return mp !== null ? mp.getDetectionCanvas() : null;
}

/** The xr8 engine's optional mesh surface (structural: the manager holds a plain FaceEngine). */
interface MeshSource {
  getLatestFaceMesh?(): { vertices: Float32Array; t: number } | null;
  getFaceMeshTopology?(): { pointsPerDetection: number; indices: Uint32Array; uvs: Float32Array } | null;
}

/** True only while an 8th Wall engine is the ACTIVE pose engine (xr8 or hybrid, after any fallback). */
export function faceMeshAvailable(): boolean {
  return xr8 !== null && (info.active === 'xr8' || info.active === 'hybrid');
}

/**
 * The live tracked face mesh: 478×3 floats in the contract HEAD frame (cm), so
 * a mesh parented to the tracked head group lands on the face. The buffer is
 * the engine's own, overwritten in place every frame — copy to keep. null in
 * MediaPipe mode, after a fallback, or before the first sample.
 */
export function getTrackedFaceMesh(): { vertices: Float32Array; t: number } | null {
  if (!faceMeshAvailable()) return null;
  try {
    return (xr8 as MeshSource).getLatestFaceMesh?.() ?? null;
  } catch {
    return null;
  }
}

/** The mesh topology (triangles + 8th Wall standard uvs), or null whenever the mesh is. */
export function getTrackedFaceMeshTopology(): {
  pointsPerDetection: number;
  indices: Uint32Array;
  uvs: Float32Array;
} | null {
  if (!faceMeshAvailable()) return null;
  try {
    return (xr8 as MeshSource).getFaceMeshTopology?.() ?? null;
  } catch {
    return null;
  }
}

/** The xr8 engine's optional ear surface (structural, like MeshSource). */
interface EarSource {
  getEarEstimate?(): EarEstimate | null;
}

/**
 * Where this guest's ear lobes are, in the contract HEAD frame (cm), subject's
 * left at +x. While an 8th Wall engine is the active pose engine this is its
 * per-guest estimate (tracked ears, averaged — see earPoints.ts); otherwise
 * (MediaPipe mode, a fallback, no face yet, the studio's orbit view) it is the
 * measured default, so a caller always gets a usable point.
 */
export function getTrackedEars(): EarEstimate {
  if (faceMeshAvailable()) {
    try {
      const e = (xr8 as EarSource).getEarEstimate?.();
      if (e) return e;
    } catch {
      /* fall through to the default */
    }
  }
  return estimateEars(null);
}

/** The xr8 engine's optional multi-face surface (structural, like MeshSource). */
interface ExtraFaceSource {
  getExtraFaces?(): readonly ExtraFace[];
}
const NO_EXTRA_FACES: readonly ExtraFace[] = [];

/**
 * MULTI-FACE: how many extra faces (beside the primary) can be tracked right now —
 * 0 unless an 8th Wall engine created with maxFaces > 1 is the ACTIVE pose engine,
 * and always 0 on a legacy session. Surfaces size their extra rigs from this.
 */
export function extraFaceSlotCount(): number {
  if (isLegacyFaceSession() || !faceMeshAvailable()) return 0;
  return Math.max(0, xr8MaxFaces - 1);
}

/**
 * The faces tracked beside the primary, handed over with the last pose sample
 * (same frame), in the contract convention. Empty outside the 8th Wall family,
 * on legacy, and when only one face is tracked. Never throws.
 */
export function getExtraFaces(): readonly ExtraFace[] {
  if (extraFaceSlotCount() === 0) return NO_EXTRA_FACES;
  try {
    return (xr8 as ExtraFaceSource).getExtraFaces?.() ?? NO_EXTRA_FACES;
  } catch {
    return NO_EXTRA_FACES;
  }
}

/** Main-thread ms of MediaPipe's latest frame staging (snapshot + downscale). Diagnostics. */
export function faceStagingMs(): number {
  return mp !== null ? mp.lastStagingMs() : 0;
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
  if (mpStatus === 'failed' && mpRecoveries <= MAX_MP_RECOVERIES) mpStatus = 'idle';
  if (!info.ready) {
    // (Re)arm the visible-failure deadline for this ask.
    deadlineHit = false;
    clearTimeout(deadlineTimer);
    deadlineTimer = setTimeout(() => {
      if (info.ready) return;
      deadlineHit = true;
      reportOnce('deadline', `face tracker not ready after ${TRACKER_INIT_DEADLINE_MS / 1000}s (requested ${requested})`);
      emit();
    }, TRACKER_INIT_DEADLINE_MS);
  }
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

/**
 * Poll 8th Wall and, when it ran an inference during the call, claim this
 * frame's inference token for it: 8th Wall cannot claim it itself (its
 * pipeline runs inside poll), and without the claim MediaPipe's hybrid
 * blendshape pass or the hand landmarker could block the same tick
 * (measured worst single blocks 99 ms + 373 ms, uncoordinated).
 */
function pollXr8Claimed(engine: FaceEngine, video: HTMLVideoElement, now: number): FaceSample | null {
  const before = safeLast(engine);
  const s = pollXr8(video, now);
  if (safeLast(engine) !== before) claimFrameInference('face');
  return s;
}

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
  lastPollNow = now;
  if (video !== lastVideo) {
    lastVideo = video;
    resetFrameLockGuard(lockGuard);
    prewarmPending(); // first poll (or a new camera element) while 8th Wall is still loading
  }
  pollEngines(video, now);
  if (_poll.pose !== null) lastPoseT = _poll.pose.t;
  return _poll;
}

function pollEngines(video: HTMLVideoElement, now: number): void {
  const eff = effectiveMode();
  if (eff === 'mediapipe') {
    _poll.pose = getMp().poll(video, now);
    return;
  }
  if (!wanted && !warnedUnwanted) {
    warnedUnwanted = true;
    console.warn('[faceEngine] polled but initFaceEngine() was never called — face tracking will not work on this surface.');
  }
  const xrReady = xr8Status === 'ready' && xr8 !== null;
  if (eff === 'xr8') {
    if (xrReady) _poll.pose = pollXr8Claimed(xr8 as FaceEngine, video, now);
    return;
  }
  // hybrid
  if (xrReady) {
    _poll.pose = pollXr8Claimed(xr8 as FaceEngine, video, now);
    _poll.poseHasExpr = false;
    // Skipped (gate untouched, retried next frame) when 8th Wall inferred this
    // frame: its token claim below makes pollBlendshapes' own claim fail.
    if (mp !== null) _poll.expr = mp.pollBlendshapes(video, now);
  } else if (mp !== null) {
    _poll.pose = mp.poll(video, now); // interim: plain MediaPipe while 8th Wall loads
  }
}
