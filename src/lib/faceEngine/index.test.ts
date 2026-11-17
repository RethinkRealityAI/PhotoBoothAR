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
    mpInit: 'resolve' as 'resolve' | 'reject',
    mpReady: false,
    mpPolls: 0,
    mpBlendPolls: 0,
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
  createXr8Engine: (): FaceEngine => {
    const s = h.state;
    s.xr8Created++;
    s.xr8Alive++;
    s.xr8MaxAlive = Math.max(s.xr8MaxAlive, s.xr8Alive);
    let ready = false;
    let disposed = false;
    let running = false;
    const started = () => { ready = true; running = true; s.xr8Running++; };
    return {
      id: 'xr8',
      init: () => new Promise<void>((resolve, reject) => {
        if (s.xr8Init === 'resolve') { started(); resolve(); }
        else if (s.xr8Init === 'reject') reject(new Error('WebGL2 unavailable'));
        else if (s.xr8Init === 'manual') s.xr8Ctl.push({ resolve: () => { started(); resolve(); }, reject });
        // 'hang': never settles
      }),
      isReady: () => ready,
      poll: (_v, now) => (ready ? sample(now, null) : null),
      lastInferenceMs: () => -Infinity,
      dispose: () => {
        s.xr8Disposed++;
        if (!disposed) { disposed = true; s.xr8Alive--; }
        if (running) { running = false; s.xr8Running--; }
      },
    };
  },
}));

vi.mock('./mediapipeEngine', () => ({
  createMediapipeEngine: () => ({
    id: 'mediapipe',
    init: () => {
      h.state.mpInits++;
      if (h.state.mpInit === 'reject') return Promise.reject(new Error('model fetch failed'));
      h.state.mpReady = true;
      return Promise.resolve();
    },
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
type Mgr = typeof import('./index');
let m: Mgr;

beforeEach(async () => {
  Object.assign(h.state, {
    xr8Created: 0, xr8Alive: 0, xr8MaxAlive: 0, xr8Disposed: 0, xr8Running: 0, xr8Init: 'resolve', xr8Ctl: [],
    mpInits: 0, mpInit: 'resolve', mpReady: false, mpPolls: 0, mpBlendPolls: 0, reports: [],
  });
  vi.resetModules();
  // Pre-load the mocked 8th Wall module into the fresh registry: the manager's
  // own dynamic import then resolves from cache in a microtask, instead of
  // racing the module runner's resolution latency against the waits below.
  await import('./xr8Engine');
  m = await import('./index');
});
afterEach(() => { vi.useRealTimers(); });

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
});
