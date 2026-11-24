import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FaceEngine, FaceSample } from './types';

/* The manager is module-global state: every test re-imports a fresh copy with
 * vi.resetModules(), and the two engines + telemetry are replaced by fakes so
 * fallback / timeout / switching can be driven deterministically in node. */

const h = vi.hoisted(() => {
  type Ctl = { resolve: () => void; reject: (e: unknown) => void };
  const state = {
    xr8Created: 0,
    xr8Alive: 0,
    xr8MaxAlive: 0,
    xr8Disposed: 0,
    /** Engines whose init FINISHED and that were not disposed after that. A
     *  real engine may ignore a dispose that lands mid-init and start its loop
     *  when init completes — only a dispose AFTER init can stop it. */
    xr8Running: 0,
    xr8Init: 'resolve' as 'resolve' | 'reject' | 'hang' | 'manual',
    xr8Ctl: [] as Ctl[],
    mpInits: 0,
    mpInit: 'resolve' as 'resolve' | 'reject' | 'manual',
    mpCtl: [] as Ctl[],
    mpReady: false,
    mpPolls: 0,
    mpBlendPolls: 0,
    /** Last setPlatformPath / setFrameSnapshot values the manager pushed. */
    mpPlatform: null as boolean | null,
    mpSnapshot: false,
    mpOnLost: null as ((reason: string) => void) | null,
    /** What the fake engines hand over as their analysed frame. */
    mpFrame: { width: 1080, height: 1920, tag: 'mp' } as unknown,
    xr8Frame: { width: 1280, height: 720, tag: 'xr8' } as unknown,
    xr8Mesh: { vertices: new Float32Array(478 * 3), t: 5 },
    /** Videos handed to the 8th Wall engine's prewarm(), and whether init had started. */
    xr8Prewarms: [] as { video: unknown; beforeInit: boolean }[],
    /** When true, each xr8 poll() runs an inference (lastInferenceMs advances). */
    xr8Infers: false,
    xr8LastInf: -Infinity,
    xr8Topology: { pointsPerDetection: 478, indices: new Uint32Array(852 * 3), uvs: new Float32Array(478 * 2) },
    reports: [] as string[],
  };
  return { state };
});

const sample = (t: number, blend: Record<string, number> | null = {}): FaceSample => ({
  t,
  matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -40, 1],
  blendshapes: blend,
  keypoints: null,
});

vi.mock('./xr8Engine', () => ({
  createXr8Engine: (): FaceEngine & { getLatestFaceMesh(): unknown; getFaceMeshTopology(): unknown; prewarm(v: HTMLVideoElement): void } => {
    const s = h.state;
    s.xr8Created++;
    s.xr8Alive++;
    s.xr8MaxAlive = Math.max(s.xr8MaxAlive, s.xr8Alive);
    let ready = false;
    let disposed = false;
    let running = false;
    let initCalled = false;
    const started = () => { ready = true; running = true; s.xr8Running++; };
    return {
      id: 'xr8',
      init: () => new Promise<void>((resolve, reject) => {
        initCalled = true;
        if (s.xr8Init === 'resolve') { started(); resolve(); }
        else if (s.xr8Init === 'reject') reject(new Error('WebGL2 unavailable'));
        else if (s.xr8Init === 'manual') s.xr8Ctl.push({ resolve: () => { started(); resolve(); }, reject });
        // 'hang': never settles
      }),
      isReady: () => ready,
      poll: (_v, now) => {
        if (ready && s.xr8Infers) s.xr8LastInf = now;
        return ready ? sample(now, null) : null;
      },
      lastInferenceMs: () => s.xr8LastInf,
      prewarm: (v: HTMLVideoElement) => { s.xr8Prewarms.push({ video: v, beforeInit: !initCalled }); },
      getAnalysedFrame: () => (ready ? (s.xr8Frame as HTMLCanvasElement) : null),
      getLatestFaceMesh: () => (ready ? s.xr8Mesh : null),
      getFaceMeshTopology: () => (ready ? s.xr8Topology : null),
      dispose: () => {
        s.xr8Disposed++;
        if (!disposed) { disposed = true; s.xr8Alive--; }
        if (running) { running = false; s.xr8Running--; }
      },
    };
  },
}));

vi.mock('./mediapipeEngine', () => ({
  createMediapipeEngine: (opts: { onLost?: (reason: string) => void } = {}) => ({
    id: 'mediapipe',
    init: () => {
      h.state.mpOnLost = opts.onLost ?? null;
      h.state.mpInits++;
      if (h.state.mpInit === 'reject') return Promise.reject(new Error('model fetch failed'));
      if (h.state.mpInit === 'manual') {
        return new Promise<void>((resolve, reject) => {
          h.state.mpCtl.push({ resolve: () => { h.state.mpReady = true; resolve(); }, reject });
        });
      }
      h.state.mpReady = true;
      return Promise.resolve();
    },
    setPlatformPath: (on: boolean) => { h.state.mpPlatform = on; },
    setFrameSnapshot: (on: boolean) => { h.state.mpSnapshot = on; },
    getAnalysedFrame: () => (h.state.mpSnapshot ? (h.state.mpFrame as HTMLCanvasElement) : null),
    getDetectionCanvas: () => null,
    lastStagingMs: () => 0,
    isReady: () => h.state.mpReady,
    poll: (_v: unknown, now: number) => { h.state.mpPolls++; return h.state.mpReady ? sample(now, { smile: 1 }) : null; },
    pollBlendshapes: (_v: unknown, now: number) => { h.state.mpBlendPolls++; return h.state.mpReady ? sample(now, { smile: 0.5 }) : null; },
    lastInferenceMs: () => 77,
    dispose: () => {},
  }),
}));

vi.mock('../errorReport', () => ({
  reportError: (e: unknown) => { h.state.reports.push(String(e)); },
}));

/* The module runner's dynamic import costs REAL I/O time, not a fixed number
 * of ticks, so waits are condition-based and bounded by wall time (performance
 * .now is never faked here — only setTimeout/clearTimeout are, in one test). */
const tick = () => new Promise((r) => setImmediate(r));
const until = async (cond: () => boolean, ms = 2000) => {
  const end = performance.now() + ms;
  while (!cond()) {
    if (performance.now() > end) throw new Error('until(): condition never became true');
    await tick();
  }
};
/** For "nothing else happens" checks: let ~50ms of real async work run. */
const flush = async () => {
  const end = performance.now() + 50;
  while (performance.now() < end) await tick();
};
const video = {} as HTMLVideoElement;
/** A minimal window so the URL overrides (?faceEngine / ?framelock) can be driven. */
function setSearch(search: string): void {
  const data: Record<string, string> = {};
  (globalThis as { window?: unknown }).window = {
    location: { search },
    sessionStorage: { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; } },
  };
}
type Mgr = typeof import('./index');
let m: Mgr;

beforeEach(async () => {
  Object.assign(h.state, {
    xr8Created: 0, xr8Alive: 0, xr8MaxAlive: 0, xr8Disposed: 0, xr8Running: 0, xr8Init: 'resolve', xr8Ctl: [],
    mpInits: 0, mpInit: 'resolve', mpCtl: [], mpReady: false, mpPolls: 0, mpBlendPolls: 0,
    mpPlatform: null, mpSnapshot: false, mpOnLost: null,
    mpFrame: { width: 1080, height: 1920, tag: 'mp' }, xr8Frame: { width: 1280, height: 720, tag: 'xr8' },
    xr8Prewarms: [], xr8Infers: false, xr8LastInf: -Infinity,
    reports: [],
  });
  setSearch('');
  vi.resetModules();
  // Pre-load the mocked 8th Wall module into the fresh registry: the manager's
  // own dynamic import then resolves from cache in a microtask, instead of
  // racing the module runner's resolution latency against the waits below.
  await import('./xr8Engine');
  m = await import('./index');
});
afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { window?: unknown }).window;
});

describe('face-engine manager', () => {
  it('platform default is xr8 and loads nothing until a surface asks', async () => {
    expect(m.getActiveFaceEngineInfo().requested).toBe('xr8');
    await flush();
    expect(h.state.xr8Created).toBe(0);
    expect(h.state.mpInits).toBe(0);
  });

  it('xr8: 8th Wall becomes active; MediaPipe is never downloaded', async () => {
    await m.initFaceEngine();
    expect(m.getActiveFaceEngineInfo()).toMatchObject({ requested: 'xr8', active: 'xr8', ready: true, fellBack: false });
    expect(h.state.mpInits).toBe(0);
    expect(m.pollFaceEngine(video, 5)).toMatchObject({ poseHasExpr: true, expr: null });
  });

  it('mode mediapipe never imports 8th Wall and polls only MediaPipe', async () => {
    m.setFaceTrackingMode('mediapipe');
    await m.initFaceEngine();
    expect(h.state.xr8Created).toBe(0);
    expect(m.getActiveFaceEngineInfo().active).toBe('mediapipe');
    const p = m.pollFaceEngine(video, 10);
    expect(p.pose?.blendshapes).toEqual({ smile: 1 });
    expect(p.poseHasExpr).toBe(true);
    expect(h.state.mpBlendPolls).toBe(0);
    expect(m.faceInferenceMs()).toBe(77);
  });

  it('a mode set in the same tick as init wins (no stray 8th Wall start)', async () => {
    const p = m.initFaceEngine(); // child effect (FaceRig) first…
    m.setFaceTrackingMode('mediapipe'); // …parent effect (Booth) after
    await p;
    await flush();
    expect(h.state.xr8Created).toBe(0);
  });

  it('xr8 init REJECT → automatic MediaPipe fallback, reason recorded, reported once', async () => {
    h.state.xr8Init = 'reject';
    await m.initFaceEngine(); // resolves: the guest is tracked by the fallback
    const info = m.getActiveFaceEngineInfo();
    expect(info).toMatchObject({ requested: 'xr8', active: 'mediapipe', fellBack: true, ready: true, failed: false });
    expect(info.reason).toContain('WebGL2 unavailable');
    expect(h.state.xr8Alive).toBe(0);
    await until(() => h.state.reports.length === 1);
    expect(h.state.reports).toHaveLength(1);
    // Sticky: switching filters back to an 8th Wall mode neither re-inits nor re-reports.
    m.setFaceTrackingMode('mediapipe');
    m.setFaceTrackingMode('hybrid');
    await m.initFaceEngine();
    await flush();
    expect(h.state.xr8Created).toBe(1);
    expect(h.state.reports).toHaveLength(1);
    expect(m.getActiveFaceEngineInfo().active).toBe('mediapipe');
  });

  it('a FAST-rejecting 8th Wall (in-app browser) falls back at once — the guest never waits for the 12s timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    h.state.xr8Init = 'reject';
    await m.initFaceEngine(); // fake clock never advanced: only the rejection can have settled this
    expect(m.getActiveFaceEngineInfo()).toMatchObject({ active: 'mediapipe', fellBack: true, ready: true });
    expect(m.getActiveFaceEngineInfo().reason).toContain('WebGL2 unavailable');
    expect(m.getActiveFaceEngineInfo().reason).not.toContain('timed out');
  });

  it('8th Wall is prewarmed with the polled <video> BEFORE its init, and again for a video that arrives while it loads', async () => {
    const v1 = { id: 'v1' } as unknown as HTMLVideoElement;
    m.pollFaceEngine(v1, 1); // the surface's video is known before anything loads
    h.state.xr8Init = 'manual';
    const ready = m.initFaceEngine();
    await until(() => h.state.xr8Created === 1);
    expect(h.state.xr8Prewarms).toEqual([{ video: v1, beforeInit: true }]);
    const v2 = { id: 'v2' } as unknown as HTMLVideoElement; // a camera flip mid-load
    m.pollFaceEngine(v2, 2);
    m.pollFaceEngine(v2, 3); // same element again: no repeat
    expect(h.state.xr8Prewarms.map((p) => p.video)).toEqual([v1, v2]);
    h.state.xr8Ctl[0].resolve();
    await ready;
    const v3 = { id: 'v3' } as unknown as HTMLVideoElement; // adopted engine: poll() rebinds by itself
    m.pollFaceEngine(v3, 4);
    expect(h.state.xr8Prewarms).toHaveLength(2);
  });

  it('hybrid: a frame in which 8th Wall inferred holds the frame inference token (no MediaPipe blend pass / hand inference that tick)', async () => {
    const g = globalThis as { document?: unknown };
    const timeline = { currentTime: 1000 };
    g.document = { timeline };
    try {
      m.setFaceTrackingMode('hybrid');
      await m.initFaceEngine();
      await until(() => m.getActiveFaceEngineInfo().active === 'hybrid');
      h.state.xr8Infers = true;
      timeline.currentTime = 1016;
      m.pollFaceEngine(video, 1016);
      expect(m.claimFrameInference('hand')).toBe(false); // 8th Wall already ran this frame
      timeline.currentTime = 1033;
      h.state.xr8Infers = false; // 8th Wall had nothing new this frame
      m.pollFaceEngine(video, 1033);
      // MediaPipe's blend pass may claim it (the fake does not) — but 8th Wall did NOT:
      expect(m.claimFrameInference('hand')).toBe(true);
    } finally {
      delete g.document;
    }
  });

  it('xr8 init HANG → falls back after the timeout; a late finish is disposed, never adopted', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    h.state.xr8Init = 'manual';
    const ready = m.initFaceEngine();
    await until(() => h.state.xr8Created === 1);
    expect(h.state.xr8Created).toBe(1);
    expect(m.getActiveFaceEngineInfo().ready).toBe(false); // "Loading face tracker"
    await vi.advanceTimersByTimeAsync(m.XR8_INIT_TIMEOUT_MS);
    await flush();
    await ready;
    expect(m.getActiveFaceEngineInfo()).toMatchObject({ active: 'mediapipe', fellBack: true, ready: true });
    expect(m.getActiveFaceEngineInfo().reason).toContain('timed out');
    expect(h.state.xr8Alive).toBe(0);
    h.state.xr8Ctl[0].resolve(); // 8th Wall finally finishes, too late
    await until(() => h.state.xr8Disposed >= 2);
    expect(h.state.xr8Alive).toBe(0);
    expect(h.state.xr8Running).toBe(0); // the late finisher was stopped, not left looping
    expect(m.getActiveFaceEngineInfo().active).toBe('mediapipe');
  });

  it('even the fallback failing is reported as failed (no infinite loading state)', async () => {
    h.state.xr8Init = 'reject';
    h.state.mpInit = 'reject';
    await expect(m.initFaceEngine()).rejects.toThrow('face tracker unavailable');
    expect(m.getActiveFaceEngineInfo()).toMatchObject({ ready: false, failed: true });
    // A later init retries MediaPipe (initializeFaceLandmarker allowed this too).
    h.state.mpInit = 'resolve';
    await m.initFaceEngine();
    expect(h.state.mpInits).toBe(2);
    expect(m.getActiveFaceEngineInfo().ready).toBe(true);
  });

  it('switch xr8 → mediapipe disposes 8th Wall; back again works; never two alive', async () => {
    await m.initFaceEngine();
    m.setFaceTrackingMode('mediapipe');
    await until(() => m.getActiveFaceEngineInfo().active === 'mediapipe' && h.state.xr8Alive === 0);
    expect(h.state.xr8Alive).toBe(0);
    expect(m.getActiveFaceEngineInfo().active).toBe('mediapipe');
    m.setFaceTrackingMode('xr8');
    await until(() => m.getActiveFaceEngineInfo().active === 'xr8');
    expect(m.getActiveFaceEngineInfo().active).toBe('xr8');
    m.setFaceTrackingMode('mediapipe');
    m.setFaceTrackingMode('xr8');
    await flush();
    expect(h.state.xr8MaxAlive).toBe(1);
    expect(m.getActiveFaceEngineInfo().active).toBe('xr8');
  });

  it('xr8 ↔ hybrid keeps the SAME 8th Wall engine; hybrid takes blendshapes from MediaPipe', async () => {
    await m.initFaceEngine();
    m.setFaceTrackingMode('hybrid');
    await until(() => m.getActiveFaceEngineInfo().active === 'hybrid');
    expect(h.state.xr8Created).toBe(1);
    expect(m.getActiveFaceEngineInfo().active).toBe('hybrid');
    const p = m.pollFaceEngine(video, 20);
    expect(p.poseHasExpr).toBe(false);
    expect(p.pose?.blendshapes).toBeNull();
    expect(p.expr?.blendshapes).toEqual({ smile: 0.5 });
    m.setFaceTrackingMode('xr8');
    await flush();
    expect(h.state.xr8Created).toBe(1);
  });

  it('hybrid before 8th Wall is up: plain MediaPipe drives the pose meanwhile', async () => {
    h.state.xr8Init = 'manual';
    m.setFaceTrackingMode('hybrid');
    void m.initFaceEngine();
    await until(() => m.getActiveFaceEngineInfo().active === 'mediapipe' && h.state.xr8Ctl.length === 1);
    expect(m.getActiveFaceEngineInfo().active).toBe('mediapipe');
    const p = m.pollFaceEngine(video, 30);
    expect(p.poseHasExpr).toBe(true);
    expect(p.pose?.blendshapes).toEqual({ smile: 1 });
    h.state.xr8Ctl[0].resolve();
    await until(() => m.getActiveFaceEngineInfo().active === 'hybrid');
    expect(m.getActiveFaceEngineInfo().active).toBe('hybrid');
  });

  it('switching away while 8th Wall is loading: no second init, disposed on arrival', async () => {
    h.state.xr8Init = 'manual';
    void m.initFaceEngine();
    await until(() => h.state.xr8Ctl.length === 1);
    m.setFaceTrackingMode('mediapipe');
    await flush();
    m.setFaceTrackingMode('xr8'); // back while the first is still loading
    await flush();
    expect(h.state.xr8Created).toBe(1);
    m.setFaceTrackingMode('mediapipe');
    await flush();
    h.state.xr8Ctl[0].resolve();
    await until(() => h.state.xr8Alive === 0);
    expect(h.state.xr8Running).toBe(0);
    expect(m.getActiveFaceEngineInfo().active).toBe('mediapipe');
  });

  it('subscribers fire on change only, with a stable snapshot between changes', async () => {
    const seen: unknown[] = [];
    const off = m.subscribeFaceEngine(() => seen.push(m.getActiveFaceEngineInfo()));
    const before = m.getActiveFaceEngineInfo();
    expect(m.getActiveFaceEngineInfo()).toBe(before);
    m.setFaceTrackingMode('xr8'); // no-op (already xr8)
    expect(seen).toHaveLength(0);
    await m.initFaceEngine();
    expect(seen.length).toBeGreaterThan(0);
    off();
  });

  it('face mesh: passes through ONLY while 8th Wall is the active pose engine', async () => {
    expect(m.faceMeshAvailable()).toBe(false);
    expect(m.getTrackedFaceMesh()).toBeNull();
    await m.initFaceEngine();
    expect(m.faceMeshAvailable()).toBe(true);
    expect(m.getTrackedFaceMesh()).toBe(h.state.xr8Mesh);
    expect(m.getTrackedFaceMeshTopology()).toBe(h.state.xr8Topology);
    m.setFaceTrackingMode('hybrid');
    await flush();
    expect(m.getTrackedFaceMesh()).toBe(h.state.xr8Mesh); // hybrid: pose is still 8th Wall
    m.setFaceTrackingMode('mediapipe');
    // Same tick: 8th Wall is still alive (disposal is a microtask away) but no longer the pose engine.
    expect(m.faceMeshAvailable()).toBe(false);
    expect(m.getTrackedFaceMesh()).toBeNull();
    await until(() => m.getActiveFaceEngineInfo().active === 'mediapipe');
    expect(m.faceMeshAvailable()).toBe(false);
    expect(m.getTrackedFaceMesh()).toBeNull();
    expect(m.getTrackedFaceMeshTopology()).toBeNull();
  });

  it('face mesh: null after an 8th Wall fallback', async () => {
    h.state.xr8Init = 'reject';
    await m.initFaceEngine();
    expect(m.getActiveFaceEngineInfo()).toMatchObject({ active: 'mediapipe', fellBack: true });
    expect(m.faceMeshAvailable()).toBe(false);
    expect(m.getTrackedFaceMesh()).toBeNull();
    expect(m.getTrackedFaceMeshTopology()).toBeNull();
  });

  describe('frame-lock', () => {
    it('is OFF until a compositor retains it, then follows the 8th Wall pose engine', async () => {
      await m.initFaceEngine();
      m.pollFaceEngine(video, 41);
      expect(m.getActiveFaceEngineInfo()).toMatchObject({ active: 'xr8', frameLock: false, frameLockSource: 'xr8' });
      expect(m.getTrackedFrame()).toBeNull();
      const release = m.retainFrameLock();
      expect(m.isFrameLockActive()).toBe(true);
      const f = m.getTrackedFrame();
      expect(f).not.toBeNull();
      expect(f!.source).toBe(h.state.xr8Frame);
      expect([f!.width, f!.height]).toEqual([1280, 720]);
      expect(f!.key).toBe(41); // identity = the pose sample the rig is showing
      m.pollFaceEngine(video, 75);
      expect(m.getTrackedFrame()!.key).toBe(75);
      release();
      release(); // idempotent
      expect(m.getTrackedFrame()).toBeNull();
      expect(h.state.mpSnapshot).toBe(false); // MediaPipe never paid for a copy in xr8 mode
    });

    it('MediaPipe pose: off by default (one constant flips it); ?framelock=1 turns it on and only THEN does MediaPipe snapshot', async () => {
      m.setFaceTrackingMode('mediapipe');
      await m.initFaceEngine();
      const release = m.retainFrameLock();
      expect(m.getActiveFaceEngineInfo()).toMatchObject({ frameLock: false, frameLockSource: 'mediapipe-default' });
      expect(h.state.mpSnapshot).toBe(false);
      release();
      setSearch('?framelock=1');
      const release2 = m.retainFrameLock();
      expect(m.getActiveFaceEngineInfo()).toMatchObject({ frameLock: true, frameLockSource: 'url' });
      expect(h.state.mpSnapshot).toBe(true);
      m.pollFaceEngine(video, 50); // a pose sample exists (before one, frame-lock shows the live camera)
      expect(m.getTrackedFrame()!.source).toBe(h.state.mpFrame);
      release2();
      expect(h.state.mpSnapshot).toBe(false);
    });

    it('a legacy surface is never frame-locked and keeps the shipped detection path, whatever the URL says', async () => {
      setSearch('?framelock=1&faceEngine=xr8');
      m.setFaceTrackingMode('mediapipe', { legacy: true });
      await m.initFaceEngine();
      m.retainFrameLock();
      expect(m.isLegacyFaceSession()).toBe(true);
      expect(m.getActiveFaceEngineInfo()).toMatchObject({ frameLock: false, frameLockSource: 'legacy' });
      expect(m.getTrackedFrame()).toBeNull();
      expect(h.state.mpPlatform).toBe(false);
      expect(h.state.mpSnapshot).toBe(false);
      expect(h.state.xr8Created).toBe(0);
      // Back on a platform surface the detection path switches over.
      m.setFaceTrackingMode('mediapipe');
      expect(h.state.mpPlatform).toBe(true);
    });

    it('after a fallback to MediaPipe the lock follows the ACTIVE engine, not the requested one', async () => {
      h.state.xr8Init = 'reject';
      m.retainFrameLock();
      await m.initFaceEngine();
      expect(m.getActiveFaceEngineInfo()).toMatchObject({ requested: 'xr8', active: 'mediapipe', frameLock: false });
      expect(m.getTrackedFrame()).toBeNull();
    });
  });

  describe('init deadline and landmarker loss', () => {
    it('nothing ready by the deadline → every surface sees failed + a reason; a late success recovers', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      // 8th Wall hangs → its 12s timeout falls back to MediaPipe, which is
      // still loading at 15s: ONLY the deadline can make this `failed` (the
      // MediaPipe init bound would not fire until 12 + 15 = 27s).
      h.state.xr8Init = 'manual';
      h.state.mpInit = 'manual';
      // Capture the outcome NOW: it rejects inside the timer advance below.
      const outcome = m.initFaceEngine().then(() => 'resolved', (e: Error) => e.message);
      await until(() => h.state.xr8Ctl.length === 1);
      expect(m.getActiveFaceEngineInfo()).toMatchObject({ ready: false, failed: false });
      await vi.advanceTimersByTimeAsync(m.XR8_INIT_TIMEOUT_MS);
      await until(() => h.state.mpCtl.length === 1);
      expect(m.getActiveFaceEngineInfo()).toMatchObject({ ready: false, failed: false });
      await vi.advanceTimersByTimeAsync(m.TRACKER_INIT_DEADLINE_MS - m.XR8_INIT_TIMEOUT_MS);
      expect(await outcome).toBe('face tracker unavailable');
      const info = m.getActiveFaceEngineInfo();
      expect(info).toMatchObject({ ready: false, failed: true });
      expect(info.error).toBe('face tracker did not start in time');
      h.state.mpCtl[0].resolve(); // the network finally delivers
      await until(() => m.getActiveFaceEngineInfo().ready);
      expect(m.getActiveFaceEngineInfo()).toMatchObject({ ready: true, failed: false, error: null });
    });

    it('a MediaPipe init that never settles is bounded (and a retry can then start)', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      h.state.mpInit = 'manual';
      m.setFaceTrackingMode('mediapipe');
      const outcome = m.initFaceEngine().then(() => 'resolved', (e: Error) => e.message);
      await until(() => h.state.mpCtl.length === 1);
      await vi.advanceTimersByTimeAsync(m.MP_INIT_TIMEOUT_MS);
      expect(await outcome).toBe('face tracker unavailable');
      expect(m.getActiveFaceEngineInfo().error).toContain('MediaPipe init timed out');
      h.state.mpInit = 'resolve';
      await m.initFaceEngine(); // the retry the old unbounded 'loading' state made impossible
      expect(h.state.mpInits).toBe(2);
      expect(m.getActiveFaceEngineInfo()).toMatchObject({ ready: true, failed: false, error: null });
    });

    it('a landmarker that stops responding is rebuilt and the gap is visible; repeated loss gives up as failed', async () => {
      m.setFaceTrackingMode('mediapipe');
      await m.initFaceEngine();
      expect(h.state.mpInits).toBe(1);
      for (let i = 1; i <= m.MAX_MP_RECOVERIES; i++) {
        h.state.mpOnLost!('face landmarker stopped responding');
        expect(m.getActiveFaceEngineInfo()).toMatchObject({ ready: false });
        expect(m.getActiveFaceEngineInfo().error).toContain('stopped responding');
        await until(() => m.getActiveFaceEngineInfo().ready);
        expect(h.state.mpInits).toBe(1 + i);
      }
      h.state.mpOnLost!('face landmarker stopped responding');
      await flush();
      expect(m.getActiveFaceEngineInfo()).toMatchObject({ ready: false, failed: true });
      expect(h.state.mpInits).toBe(1 + m.MAX_MP_RECOVERIES);
      await until(() => h.state.reports.some((r) => r.includes('stopped responding')));
      expect(h.state.reports.filter((r) => r.includes('stopped responding'))).toHaveLength(1);
    });
  });
});

describe('isLegacyFaceSurface (the one legacy predicate, shared with the resolver)', () => {
  it('platform build: only a coded event is legacy', () => {
    expect(m.isLegacyFaceSurface(true)).toBe(true);
    expect(m.isLegacyFaceSurface(false)).toBe(false);
    // The resolver reads the same predicate: a coded surface pins MediaPipe.
    expect(m.resolveSurfaceFaceMode({ legacy: true }).source).toBe('legacy');
    expect(m.resolveSurfaceFaceMode({ legacy: false }).source).not.toBe('legacy');
  });

  it('a frozen VITE_EVENT build is legacy even for a db event', async () => {
    vi.stubEnv('VITE_EVENT', 'hope-gala');
    try {
      vi.resetModules();
      const legacy = await import('./index');
      expect(legacy.isLegacyFaceSurface(false)).toBe(true);
      expect(legacy.resolveSurfaceFaceMode({ legacy: false }).source).toBe('legacy');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
