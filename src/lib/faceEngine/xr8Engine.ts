/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The 8th Wall face engine (types.ts FaceEngine). Loaded ONLY through
 * index.ts's dynamic import, so no session that never asks for 8th Wall ever
 * downloads it.
 *
 * How it runs:
 *  - init() loads the self-hosted engine (xr8Session.loadXr8), starts XR8 with
 *    OUR session manager (no second getUserMedia) on a small black placeholder
 *    canvas, and resolves on `facecontroller.facescanning` — the point where
 *    wasm, both tflite models and the GL pipeline have all come up. So a phone
 *    that cannot run 8th Wall rejects HERE (index.ts then falls back to
 *    MediaPipe), not silently later. The app's video only arrives with the
 *    first poll(), which swaps it in as the frame source.
 *  - Its own requestAnimationFrame loop drives XR8 manually
 *    (ownRunLoop:false → runPreRender / runRender / runPostRender). Frames are
 *    gated by the same DetectGate as MediaPipe (≤ ~30/s, new frames only). The
 *    loop idles when nobody has polled for XR8_IDLE_AFTER_MS and restarts on
 *    the next poll.
 *  - Results lag the staged frame by one loop tick (processGpu stages a frame
 *    in runPostRender; processCpu infers it in the NEXT runPreRender).
 *  - poll() hands over the newest unseen sample; it never throws.
 *
 * The canvas 8th Wall draws into is never attached to the DOM and is kept at
 * the source's exact size, so 8th Wall's intrinsics describe the FULL frame —
 * the precondition of xr8Pose.xr8ToFaceMatrix.
 *
 * XR8 is a page-wide singleton: at most one engine may be alive (index.ts
 * guarantees it; this file enforces it).
 */
import type { ExtraFace, FaceEngine, FaceSample } from './types';
import { createXr8SessionManager, loadXr8, type Xr8Global, type Xr8SessionManager } from './xr8Session';
import { xr8Keypoints, xr8LocalToHeadCm, xr8ToFaceMatrix, type Xr8Transform, type Xr8Uv, type Xr8Vec3 } from './xr8Pose';
import { createXr8ExpressionState, resetXr8ExpressionState, xr8Expressions } from './xr8Expressions';
import { createEarState, estimateEars, observeEars, resetEarState, type EarEstimate, type EarVec } from './earPoints';
import { createFaceSlotState, faceSlotsLost, faceSlotsObserve, parseMaxFaces, resetFaceSlots } from './multiFace';
import {
  analysedFrameAfterPass,
  analysedFrameHandOver,
  analysedFrameMarkHeld,
  analysedFrameNeedsHold,
  createAnalysedFrameSync,
  pickAnalysedFrame,
  resetAnalysedFrameSync,
} from './analysedFrame';

/** From XR8.run to facescanning (models + GL up). index.ts's outer 12 s race still applies. */
export const XR8_SCAN_TIMEOUT_MS = 10_000;
/** No poll for this long → the loop stops (no inference for a surface that left). */
export const XR8_IDLE_AFTER_MS = 1_000;
/** DetectGate spacing — the same ~30/s as MediaPipe's DETECT_INTERVAL_MS. */
export const XR8_DETECT_INTERVAL_MS = 33;
/** Multi-face: a slot whose id 8th Wall stopped reporting (without facelost) is freed after this. */
export const XR8_FACE_STALE_MS = 1_000;

/** The tracked mesh in the contract head frame (canonical cm), overwritten in place every frame. */
export interface Xr8FaceMesh {
  /** pointsPerDetection·3 floats, x,y,z per vertex. Same buffer every call — copy to keep. */
  vertices: Float32Array;
  /** performance.now() of the sample the vertices belong to. */
  t: number;
}
/** The mesh topology 8th Wall reports once per session (facescanning), for the FACE geometry. */
export interface Xr8FaceTopology {
  pointsPerDetection: number;
  /** Triangles, 3 indices each. */
  indices: Uint32Array;
  /** 8th Wall's STANDARD uvs (uvType default), u,v per vertex. */
  uvs: Float32Array;
}

/** Per-sample timing, for scripts/check-face-engines.mjs (performance.now() ms; videoTime in s). */
export interface Xr8Diagnostics {
  /** video.currentTime of the frame the latest sample was computed from. */
  analysedVideoTime: number;
  /** When that frame was uploaded to 8th Wall. */
  stagedMs: number;
  /** When the sample was emitted (sample.t). */
  emittedMs: number;
  /** Cumulative frame-upload cost (both textures) and count. */
  uploadMs: number;
  uploads: number;
  /** Of uploadMs: the draw-texture twin alone (what frame lock costs on upload). */
  drawUploadMs: number;
  /** performance.now() / video time of the most recent upload (-Infinity / -1 before the first). */
  lastStagedMs: number;
  lastStagedVideoTime: number;
}

/** How the manual 8th Wall pipeline is driven. Experiment knobs for scripts/check-face-engines.mjs;
 *  the defaults are the measured best. */
export interface Xr8EngineOptions {
  /** 'poll': after init, each poll() runs one pipeline pass and then returns (no own rAF: the
   *  sample cannot wait a frame for the app's rAF callback, and no poll = no inference).
   *  'raf': the engine's own requestAnimationFrame loop. Before init resolves it is always 'raf'. */
  drive?: 'poll' | 'raf';
  /** Default true. Right after a pass stages frame k, run a second pass: 8th Wall then infers
   *  frame k-1 (facecontroller.cc:152-160 — always the OLDER of two staged frames, whose deferred
   *  GPU read was issued a whole staging earlier, so this does not stall) in the same tick
   *  instead of the next one. No extra inference; one extra GlTextureRenderer draw. Measured
   *  (check-face-engines, same load): pose 3.25 vs 3.56 frames behind the newest frame. 'poll'
   *  drive measured WORSE than 'raf' (5.09 vs 3.25 frames), hence 'raf' is the default. */
  sameTickInference?: boolean;
  /** DetectGate spacing (default XR8_DETECT_INTERVAL_MS). */
  detectIntervalMs?: number;
  /** 8th Wall's dedicated ear model (lobe / canal / helix per ear). Default XR8_ENABLE_EARS.
   *  It can only be chosen BEFORE the pipeline runs: a later FaceController.configure is
   *  ignored (measured), so it is an engine option, not a runtime switch. */
  ears?: boolean;
  /** FaceController maxDetections, 1..3 (multiFace.ts). Default 1. Like `ears`, it is read
   *  only BEFORE the pipeline runs. Face 1 (the primary) drives every single-face API; the
   *  others are handed over through getExtraFaces(). */
  maxFaces?: number;
}

/** Ear tracking on by default: it is what puts earrings on the real ear (earPoints.ts). */
export const XR8_ENABLE_EARS = true;
/** Tester switch: `?ears=0` turns the ear model off for this page load (a phone
 *  A/B for its cost). Grants nothing; anything else keeps the default. */
function earsEnabledByUrl(): boolean {
  try {
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('ears') === '0') return false;
  } catch { /* no location (tests) */ }
  return XR8_ENABLE_EARS;
}

export interface Xr8FaceEngine extends FaceEngine {
  readonly id: 'xr8';
  /** The draw canvas holding the camera frame the latest sample was computed from (see types.ts). */
  getAnalysedFrame(): HTMLCanvasElement | null;
  /** Pipeline timing (sample fields NaN before the first sample); null before init starts the
   *  pipeline and after dispose. Diagnostics only. */
  diagnostics(): Xr8Diagnostics | null;
  /** Latest tracked mesh, or null when no face is tracked. Allocation-free. */
  getLatestFaceMesh(): Xr8FaceMesh | null;
  /** Static topology; null until init() has resolved. */
  getFaceMeshTopology(): Xr8FaceTopology | null;
  /** This guest's ear lobes in the contract head frame (earPoints.ts); null when no face is
   *  tracked. A fresh object per call. */
  getEarEstimate(): EarEstimate | null;
  /** The faces tracked beside the primary, handed over with the last sample poll() returned
   *  (same frame). Empty with maxFaces 1, when only one face is tracked, and when none is. */
  getExtraFaces(): readonly ExtraFace[];
  /**
   * OPTIONAL warm start: hand over the app's camera <video> before (or while) init() runs, so 8th
   * Wall starts on real frames instead of the black placeholder and the first pose does not wait
   * for the first poll(). poll() still rebinds if it is given a different video. Never throws.
   */
  prewarm(video: HTMLVideoElement): void;
}

interface FaceDetail {
  /** 8th Wall's face id (xr-face.js: `id: face.getId()`); stable while tracked. */
  id?: number;
  transform: Xr8Transform;
  vertices: Xr8Vec3[];
  uvsInCameraFrame: Xr8Uv[];
  /** Named face-local points. The ear model's points (…Lobe/…Canal) are {0,0,0} while lost. */
  attachmentPoints?: Record<string, { position?: Xr8Vec3 } | undefined>;
}

/** attachmentPoints read for the ears, in this order (left then right: lobe, canal, face edge). */
const EAR_POINT_NAMES = ['leftLobe', 'leftCanal', 'leftEar', 'rightLobe', 'rightCanal', 'rightEar'] as const;
interface ScanDetail {
  pointsPerDetection: number;
  indices: { a: number; b: number; c: number }[];
  uvs: { u: number; v: number }[];
}

let alive: object | null = null;
/**
 * The draw canvas outlives the engine and is reused by the next one. XR8 is a page singleton that
 * keeps GL objects of the canvas it last ran on (its GlTextureRenderer deletes them on the next
 * run), and every new canvas is a new WebGL context that only GC frees — measured: +1 context per
 * init → dispose cycle, plus "delete: object does not belong to this context" warnings, with a
 * fresh canvas each time. Dropped after a context loss (that context is unusable).
 */
let reusableCanvas: HTMLCanvasElement | null = null;

const PLACEHOLDER_W = 90;
const PLACEHOLDER_H = 160;

export function createXr8Engine(options: Xr8EngineOptions = {}): Xr8FaceEngine {
  const drive = options.drive ?? 'raf';
  const sameTick = options.sameTickInference ?? true;
  const token = {};
  let XR8: Xr8Global | null = null;
  let sm: Xr8SessionManager | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let placeholder: HTMLCanvasElement | null = null;
  let initPromise: Promise<void> | null = null;
  let ready = false;
  let disposed = false;
  let running = false;
  let contextLost = false;
  let raf = 0;
  let lastPollMs = -Infinity;
  let lastInference = -Infinity;
  let prewarmVideo: HTMLVideoElement | null = null;

  let pendingFace: FaceDetail | null = null;
  let pendingLost = false;
  let latest: FaceSample | null = null;
  let fresh = false;

  // MULTI-FACE (maxFaces > 1). Single-face keeps the exact pendingFace/pendingLost path above.
  const maxFaces = parseMaxFaces(options.maxFaces) ?? 1;
  const multi = maxFaces > 1;
  const slots = createFaceSlotState(maxFaces - 1);
  /** Every face reported this tick, by id (8th Wall dispatches one event per tracked face). */
  const tickFaces = new Map<number, FaceDetail>();
  const tickLost: number[] = [];
  /** The primary was promoted: flag the next primary sample and forget per-person state. */
  let subjectSwitched = false;
  /** Extras computed with `latest` (same pass), and those handed over with the last poll. */
  let latestExtras: readonly ExtraFace[] = [];
  let handedExtras: readonly ExtraFace[] = [];
  const NO_EXTRAS: readonly ExtraFace[] = [];
  /** performance.now() each tracked id was last reported (multi only). */
  const lastSeenById = new Map<number, number>();
  const faceId = (d: FaceDetail | undefined): number => (d && typeof d.id === 'number' && Number.isFinite(d.id) ? d.id : 0);

  let topology: Xr8FaceTopology | null = null;
  let meshBuf = new Float32Array(0);
  const mesh: Xr8FaceMesh = { vertices: meshBuf, t: 0 };
  let meshValid = false;
  const expr = createXr8ExpressionState();
  const ears = createEarState();
  const earIn: Xr8Vec3[] = EAR_POINT_NAMES.map(() => ({ x: 0, y: 0, z: 0 }));
  const earCm = new Float32Array(EAR_POINT_NAMES.length * 3);
  /** The draw canvas shows a real-video analysed frame (not the placeholder). */
  let frameValid = false;
  /** Pairs the drawn frame with the HANDED pose (analysedFrame.ts): the canvas is redrawn by every
   *  pass on our own rAF loop, so without the held copy it could lead the pose by one sample. */
  const frameSync = createAnalysedFrameSync();
  let held: HTMLCanvasElement | null = null;
  let heldCtx: CanvasRenderingContext2D | null = null;
  /** Set during a pass: the sample it emitted, and whether it drew a new (non-repeat) frame. */
  let passEmitT: number | null = null;
  let passDrew = false;
  const diag: Xr8Diagnostics = {
    analysedVideoTime: NaN, stagedMs: NaN, emittedMs: NaN, uploadMs: 0, uploads: 0,
    drawUploadMs: 0, lastStagedMs: -Infinity, lastStagedVideoTime: -1,
  };
  let diagValid = false;

  let scanResolve: (() => void) | null = null;
  let scanReject: ((e: Error) => void) | null = null;

  const fail = (e: unknown) => {
    const err = e instanceof Error ? e : new Error(String(e));
    scanReject?.(err);
    scanResolve = scanReject = null;
  };

  const lostSample = (now: number): FaceSample => ({ t: now, matrix: null, blendshapes: {}, keypoints: null });

  function captureTopology(d: ScanDetail | undefined): void {
    if (topology || !d || !Array.isArray(d.indices) || !Array.isArray(d.uvs)) return;
    const indices = new Uint32Array(d.indices.length * 3);
    d.indices.forEach((t, i) => { indices[i * 3] = t.a; indices[i * 3 + 1] = t.b; indices[i * 3 + 2] = t.c; });
    const uvs = new Float32Array(d.uvs.length * 2);
    d.uvs.forEach((p, i) => { uvs[i * 2] = p.u; uvs[i * 2 + 1] = p.v; });
    const n = Number.isFinite(d.pointsPerDetection) && d.pointsPerDetection > 0 ? d.pointsPerDetection : d.uvs.length;
    topology = { pointsPerDetection: n, indices, uvs };
    meshBuf = new Float32Array(n * 3);
    mesh.vertices = meshBuf;
  }

  /** `pre`: the primary's matrix when the multi-face path already computed it; `extras`: the
   *  other faces of the same pass, handed over with this sample. */
  function onFace(
    d: FaceDetail,
    intrinsics: ArrayLike<number> | undefined,
    feed: unknown,
    pre: Float32Array | null = null,
    extras: readonly { id: number; slot: number; matrix: Float32Array }[] = NO_EXTRAS,
  ): void {
    if (!sm || !intrinsics || !(sm.source instanceof HTMLVideoElement)) return; // placeholder frames carry no face
    const now = performance.now();
    const analysed = sm.frameForTexture(feed);
    diag.analysedVideoTime = analysed ? analysed.videoTime : NaN;
    diag.stagedMs = analysed ? analysed.stagedMs : NaN;
    diag.emittedMs = now;
    diagValid = true;
    const matrix = pre ?? xr8ToFaceMatrix(d.transform, intrinsics, sm.size.width, sm.size.height, new Float32Array(16));
    if (matrix === null) return;
    const verts = d.vertices;
    if (verts && verts.length * 3 > meshBuf.length) {
      meshBuf = new Float32Array(verts.length * 3); // only if 8th Wall ever reports more points than announced
      mesh.vertices = meshBuf;
    }
    const n = verts ? xr8LocalToHeadCm(verts, meshBuf) : 0;
    meshValid = n > 0;
    mesh.t = now;
    // A fresh object per sample (≤ ~30/s): consumers may hold on to a sample's map.
    const blendshapes = meshValid ? xr8Expressions(meshBuf, now, expr, {}) : null;
    observeEarPoints(d.attachmentPoints, now);
    latest = { t: now, matrix, blendshapes, keypoints: d.uvsInCameraFrame ? xr8Keypoints(d.uvsInCameraFrame) : null };
    if (analysed && Number.isFinite(analysed.stagedMs)) latest.frameMs = analysed.stagedMs;
    if (subjectSwitched) {
      latest.subjectChanged = true;
      subjectSwitched = false;
    }
    latestExtras = extras.length === 0 ? NO_EXTRAS : extras.map((e) => ({ id: e.id, slot: e.slot, t: now, matrix: e.matrix }));
    fresh = true;
    passEmitT = now;
  }

  /** facefound / faceupdated. Single-face: the latest detail wins (the shipped behaviour). */
  function onFaceEvent(d: FaceDetail | undefined): void {
    if (!d) return;
    if (multi) tickFaces.set(faceId(d), d);
    else pendingFace = d;
  }

  /** The primary was lost and another tracked face promoted: what we knew is the old person's. */
  function onSubjectSwitch(): void {
    subjectSwitched = true;
    meshValid = false;
    resetXr8ExpressionState(expr);
    resetEarState(ears);
  }

  /**
   * MULTI-FACE update (maxFaces > 1): `faces` = every face reported this tick by id, `lost` =
   * ids 8th Wall reported lost. The primary keeps the single-face contract; the others become
   * extras of the same sample. Same frame rules as the single-face path in onUpdate.
   */
  function onFacesUpdate(
    faces: Map<number, FaceDetail>,
    lost: readonly number[],
    processCpuResult: { facecontroller?: { intrinsics?: ArrayLike<number>; cameraFeedTexture?: unknown } } | undefined,
    frameStartResult: { repeatFrame?: boolean } | undefined,
  ): void {
    if (lost.length > 0) {
      for (const id of lost) lastSeenById.delete(id);
      const hadPrimary = slots.primary !== null;
      const r = faceSlotsLost(slots, lost);
      if (r.primaryChanged) {
        if (slots.primary === null) {
          if (hadPrimary) onLost(); // nobody left: exactly the single-face "lost"
        } else {
          onSubjectSwitch();
        }
      }
    }
    if (!frameStartResult || frameStartResult.repeatFrame === true) return;
    passDrew = true;
    if (sm && sm.source instanceof HTMLVideoElement && processCpuResult?.facecontroller) frameValid = true;
    if (faces.size === 0) return;
    const intrinsics = processCpuResult?.facecontroller?.intrinsics;
    if (!sm || !intrinsics || !(sm.source instanceof HTMLVideoElement)) return;
    const matrices = new Map<number, Float32Array>();
    const seen: { id: number; depthCm: number }[] = [];
    for (const [id, d] of faces) {
      const m = new Float32Array(16);
      if (xr8ToFaceMatrix(d.transform, intrinsics, sm.size.width, sm.size.height, m) === null) continue;
      matrices.set(id, m);
      seen.push({ id, depthCm: -m[14] });
    }
    // A tracked id that stops being reported without a facelost (8th Wall restarted after a
    // context loss) must not hold its slot forever: drop it after XR8_FACE_STALE_MS.
    const now = performance.now();
    for (const f of seen) lastSeenById.set(f.id, now);
    const stale: number[] = [];
    for (const id of [slots.primary, ...slots.extras]) {
      if (id !== null && !matrices.has(id) && now - (lastSeenById.get(id) ?? now) > XR8_FACE_STALE_MS) stale.push(id);
    }
    if (stale.length > 0) {
      for (const id of stale) lastSeenById.delete(id);
      const hadPrimary = slots.primary !== null;
      if (faceSlotsLost(slots, stale).primaryChanged && hadPrimary) onSubjectSwitch();
    }
    faceSlotsObserve(slots, seen);
    const pid = slots.primary;
    const primary = pid === null ? undefined : faces.get(pid);
    const pm = pid === null ? undefined : matrices.get(pid);
    if (pid === null || primary === undefined || pm === undefined) return;
    const extras: { id: number; slot: number; matrix: Float32Array }[] = [];
    for (let i = 0; i < slots.extras.length; i++) {
      const id = slots.extras[i];
      const m = id === null ? undefined : matrices.get(id);
      if (id !== null && m !== undefined) extras.push({ id, slot: i + 1, matrix: m });
    }
    onFace(primary, intrinsics, processCpuResult?.facecontroller?.cameraFeedTexture, pm, extras);
  }

  /** Fold this frame's ear sightings into the per-guest averages. A missing or all-zero point
   *  (8th Wall's "lost") is passed as null; earPoints range-checks the rest. Never throws. */
  function observeEarPoints(ap: FaceDetail['attachmentPoints'], now: number): void {
    if (!ap) return;
    const found: boolean[] = [];
    for (let i = 0; i < EAR_POINT_NAMES.length; i++) {
      const p = ap[EAR_POINT_NAMES[i]]?.position;
      const ok = !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) && (p.x !== 0 || p.y !== 0 || p.z !== 0);
      found.push(ok);
      earIn[i].x = ok ? p.x : 0; earIn[i].y = ok ? p.y : 0; earIn[i].z = ok ? p.z : 0;
    }
    xr8LocalToHeadCm(earIn, earCm);
    const at = (i: number): EarVec | null => (found[i] ? [earCm[i * 3], earCm[i * 3 + 1], earCm[i * 3 + 2]] : null);
    observeEars(ears, now, { lobe: at(0), canal: at(1), edge: at(2) }, { lobe: at(3), canal: at(4), edge: at(5) });
  }

  function onLost(): void {
    meshValid = false;
    resetXr8ExpressionState(expr);
    latest = lostSample(performance.now());
    latestExtras = NO_EXTRAS;
    fresh = true;
  }

  const module = {
    name: 'beamwall-face-engine',
    sessionManager: () => sm?.manager,
    listeners: [
      {
        event: 'facecontroller.facescanning',
        process: ({ detail }: { detail: ScanDetail }) => {
          captureTopology(detail);
          scanResolve?.();
          scanResolve = scanReject = null;
        },
      },
      { event: 'facecontroller.facefound', process: ({ detail }: { detail: FaceDetail }) => { onFaceEvent(detail); } },
      { event: 'facecontroller.faceupdated', process: ({ detail }: { detail: FaceDetail }) => { onFaceEvent(detail); } },
      {
        event: 'facecontroller.facelost',
        process: ({ detail }: { detail?: { id?: number } }) => {
          if (multi) tickLost.push(faceId(detail as FaceDetail | undefined));
          else pendingLost = true;
        },
      },
    ],
    // Listener events are dispatched before onUpdate on the same tick. The face
    // module RE-DISPATCHES the previous face on a repeat frame, so only a
    // non-repeat frame produces a sample.
    // The result is for the OLDER of the two frames staged so far (facecontroller.cc:152-160:
    // GPU reads are deferred one staging), handed back with that frame's draw texture
    // (cameraFeedTexture), which GlTextureRenderer draws in this pass's runRender: the sample
    // and the draw canvas are the same frame.
    onUpdate: ({ processCpuResult, frameStartResult }: {
      processCpuResult?: { facecontroller?: { intrinsics?: ArrayLike<number>; cameraFeedTexture?: unknown } };
      frameStartResult?: { repeatFrame?: boolean };
    }) => {
      try {
        if (multi) {
          const lost = tickLost.splice(0, tickLost.length);
          try {
            onFacesUpdate(tickFaces, lost, processCpuResult, frameStartResult);
          } finally {
            tickFaces.clear();
          }
          return;
        }
        const face = pendingFace;
        pendingFace = null;
        if (pendingLost) {
          pendingLost = false;
          onLost();
        }
        if (!frameStartResult || frameStartResult.repeatFrame === true) return;
        passDrew = true;
        if (sm && sm.source instanceof HTMLVideoElement && processCpuResult?.facecontroller) frameValid = true;
        if (!face) return;
        onFace(face, processCpuResult?.facecontroller?.intrinsics, processCpuResult?.facecontroller?.cameraFeedTexture);
      } catch (e) {
        console.warn('[xr8Engine] face update failed', e);
      }
    },
    onException: (e: unknown) => {
      if (!ready) fail(e);
      else console.warn('[xr8Engine] 8th Wall exception', e);
    },
  };

  function syncCanvasSize(): void {
    if (!sm || !canvas) return;
    const s = sm.source;
    const w = s instanceof HTMLVideoElement ? s.videoWidth : s.width;
    const h = s instanceof HTMLVideoElement ? s.videoHeight : s.height;
    // Same size as the source: 8th Wall's intrinsics then describe the full frame.
    if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  /** Copy the draw canvas (8th Wall creates it with preserveDrawingBuffer, so its pixels persist
   *  between passes) into the held slot. On any failure the slot stays unmarked and
   *  getAnalysedFrame keeps returning the live canvas — the pre-hold behaviour. */
  function holdCanvas(): void {
    if (!canvas || !(canvas.width > 0) || !(canvas.height > 0)) return;
    try {
      if (held === null) {
        held = document.createElement('canvas');
        heldCtx = held.getContext('2d');
      }
      if (heldCtx === null) return;
      if (held.width !== canvas.width || held.height !== canvas.height) {
        held.width = canvas.width;
        held.height = canvas.height;
      }
      heldCtx.drawImage(canvas, 0, 0);
      analysedFrameMarkHeld(frameSync);
    } catch {
      /* keep the live canvas */
    }
  }

  /** 8th Wall skips a pass whose timestamp equals the previous pass's (camera-loop.ts:274-277). */
  let lastPassTs = -Infinity;

  /** One manual pipeline pass (camera-loop.ts:479-531): infer the frame staged last pass, emit,
   *  upload a new frame if the gate allows, draw the analysed frame, stage the upload. */
  function pass(ts: number): void {
    if (!XR8 || !sm) return;
    const t = ts > lastPassTs ? ts : lastPassTs + 0.001;
    lastPassTs = t;
    const consumed = sm.stagedPending; // the frame processCpu will infer in this runPreRender
    sm.stagedPending = false;
    // About to redraw a canvas that shows the frame of the pose the app holds: keep a copy.
    if (analysedFrameNeedsHold(frameSync)) holdCanvas();
    passEmitT = null;
    passDrew = false;
    try {
      XR8.runPreRender(t);
      XR8.runRender();
      XR8.runPostRender();
    } catch (e) {
      if (!ready) fail(e);
    }
    analysedFrameAfterPass(frameSync, passEmitT, passDrew);
    // The blocking main-thread work (inference, then staging) just ran: handRig's lockout reads this.
    if (consumed || sm.stagedPending) lastInference = performance.now();
  }

  /** A pass, plus (sameTickInference) the follow-up pass that infers what the first one staged. */
  function step(ts: number): void {
    if (!XR8 || !sm) return;
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    sm.enabled = !hidden && !contextLost;
    if (contextLost || hidden) return;
    syncCanvasSize();
    pass(ts);
    if (sameTick && ready && sm.stagedPending && sm.source instanceof HTMLVideoElement) pass(performance.now());
  }

  function tick(ts: number): void {
    raf = 0;
    if (disposed || !XR8 || !sm || !running) return;
    if (ready && drive === 'poll') return; // poll() drives from here on
    const now = performance.now();
    if (ready && now - lastPollMs > XR8_IDLE_AFTER_MS) return; // idle until the next poll
    raf = requestAnimationFrame(tick);
    step(ts);
  }

  function ensureLoop(): void {
    if (ready && drive === 'poll') return;
    if (raf === 0 && running && !disposed && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(tick);
  }

  function startXr8(): void {
    if (!XR8 || !canvas) return;
    XR8.run({
      canvas,
      ownRunLoop: false,
      allowedDevices: XR8.XrConfig.device().ANY,
      webgl2: true,
      cameraConfig: { direction: XR8.XrConfig.camera().FRONT },
    });
    running = true;
    ensureLoop();
  }

  function stopXr8(): void {
    running = false;
    if (raf !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
    raf = 0;
    try { XR8?.stop(); } catch { /* already stopped */ }
  }

  const onContextLost = (ev: Event) => {
    ev.preventDefault(); // allow restoration
    contextLost = true;
    resetFaceSlots(slots); // the restarted pipeline reports new ids and never "loses" the old ones
    lastSeenById.clear();
    if (ready) onLost();
  };
  const onContextRestored = () => {
    contextLost = false;
    if (disposed || !ready) return;
    // XR8 re-creates its GL state on run (camera-loop createContext); restart the pipeline.
    stopXr8();
    try {
      startXr8();
    } catch (e) {
      console.warn('[xr8Engine] restart after context loss failed', e);
    }
  };

  function cleanup(): void {
    stopXr8();
    try { XR8?.clearCameraPipelineModules(); } catch { /* engine gone */ }
    if (canvas) {
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      // Keep it (small) for the next engine unless its context was lost.
      canvas.width = 1;
      canvas.height = 1;
      reusableCanvas = contextLost ? null : canvas;
    }
    canvas = null;
    placeholder = null;
    prewarmVideo = null;
    sm = null;
    ready = false;
    latest = null;
    fresh = false;
    resetFaceSlots(slots);
    lastSeenById.clear();
    tickFaces.clear();
    tickLost.length = 0;
    subjectSwitched = false;
    latestExtras = handedExtras = NO_EXTRAS;
    meshValid = false;
    frameValid = false;
    diagValid = false;
    resetAnalysedFrameSync(frameSync);
    held = null;
    heldCtx = null;
    if (alive === token) alive = null;
  }

  const engine: Xr8FaceEngine = {
    id: 'xr8',
    init() {
      if (initPromise) return initPromise;
      initPromise = (async () => {
        if (disposed) throw new Error('8th Wall engine was disposed');
        if (alive !== null && alive !== token) throw new Error('another 8th Wall engine is already running');
        alive = token;
        XR8 = await loadXr8();
        if (disposed) throw new Error('8th Wall engine was disposed');

        placeholder = document.createElement('canvas');
        placeholder.width = PLACEHOLDER_W;
        placeholder.height = PLACEHOLDER_H;
        const g = placeholder.getContext('2d');
        if (g) { g.fillStyle = '#000'; g.fillRect(0, 0, PLACEHOLDER_W, PLACEHOLDER_H); }
        canvas = reusableCanvas ?? document.createElement('canvas');
        reusableCanvas = null;
        canvas.width = PLACEHOLDER_W;
        canvas.height = PLACEHOLDER_H;
        canvas.addEventListener('webglcontextlost', onContextLost);
        canvas.addEventListener('webglcontextrestored', onContextRestored);
        sm = createXr8SessionManager(prewarmVideo ?? placeholder, options.detectIntervalMs ?? XR8_DETECT_INTERVAL_MS);

        let timer: ReturnType<typeof setTimeout> | undefined;
        const scanned = new Promise<void>((resolve, reject) => {
          scanResolve = resolve;
          scanReject = reject;
          timer = setTimeout(() => fail(new Error(`8th Wall face models did not start within ${XR8_SCAN_TIMEOUT_MS / 1000}s`)), XR8_SCAN_TIMEOUT_MS);
        });
        try {
          XR8.FaceController.configure({
            meshGeometry: [XR8.FaceController.MeshGeometry.FACE],
            coordinates: { mirroredDisplay: false, axes: 'RIGHT_HANDED' },
            maxDetections: maxFaces, // BEFORE run, like enableEars (a later configure is ignored)
            enableEars: options.ears ?? earsEnabledByUrl(),
          });
          XR8.clearCameraPipelineModules();
          // GlTextureRenderer draws, every runRender, the texture FaceController pairs with its
          // result (its provider is set in FaceController.onAttach) into our draw canvas — the
          // analysed frame, unmirrored (mirroredDisplay:false, flipY:false = upright, verified by
          // pixel comparison in scripts/check-face-engines.mjs).
          XR8.GlTextureRenderer.configure({ mirroredDisplay: false, flipY: false });
          XR8.addCameraPipelineModules([XR8.FaceController.pipelineModule(), XR8.GlTextureRenderer.pipelineModule(), module]);
          startXr8();
          await scanned;
        } finally {
          clearTimeout(timer);
        }
        if (disposed) throw new Error('8th Wall engine was disposed');
        ready = true;
        lastPollMs = performance.now();
      })();
      initPromise.catch(() => cleanup());
      return initPromise;
    },
    isReady() {
      return ready && !disposed;
    },
    poll(video, now) {
      void now;
      try {
        lastPollMs = performance.now();
        if (!ready || disposed || !sm) return null;
        if (video && sm.source !== video) {
          // Rebind (first poll, or the surface swapped its <video>). Its size is
          // picked up by syncCanvasSize + 8th Wall's own per-frame size check.
          sm.bind(video);
          pendingFace = null;
          tickFaces.clear();
        }
        if (drive === 'poll') {
          if (running) step(performance.now());
        } else {
          ensureLoop();
        }
        if (!fresh) return null;
        fresh = false;
        if (latest !== null) analysedFrameHandOver(frameSync, latest.t);
        handedExtras = latestExtras; // the extras of THIS sample's frame (frame-lock consistent)
        return latest;
      } catch {
        return null;
      }
    },
    lastInferenceMs() {
      return lastInference;
    },
    getLatestFaceMesh() {
      return meshValid && ready ? mesh : null;
    },
    getFaceMeshTopology() {
      return topology;
    },
    getEarEstimate() {
      return meshValid && ready ? estimateEars(ears) : null;
    },
    getExtraFaces() {
      return ready && !disposed ? handedExtras : NO_EXTRAS;
    },
    prewarm(video) {
      try {
        if (disposed || !(video instanceof HTMLVideoElement)) return;
        prewarmVideo = video;
        if (sm && sm.source !== video) {
          sm.bind(video);
          pendingFace = null;
          tickFaces.clear();
        }
      } catch { /* a warm start is only an optimisation */ }
    },
    getAnalysedFrame() {
      if (!(ready && !disposed && !contextLost && frameValid && diagValid)) return null;
      // The frame of the pose poll() last handed over, never one a later pass has already drawn.
      return pickAnalysedFrame(frameSync) === 'held' && held !== null ? held : canvas;
    },
    diagnostics() {
      if (!sm) return null;
      diag.uploadMs = sm.uploadMs;
      diag.uploads = sm.uploads;
      diag.drawUploadMs = sm.drawUploadMs;
      diag.lastStagedMs = sm.lastStagedMs;
      diag.lastStagedVideoTime = sm.lastStagedVideoTime;
      return diag;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      fail(new Error('8th Wall engine was disposed'));
      cleanup();
    },
  };
  return engine;
}
