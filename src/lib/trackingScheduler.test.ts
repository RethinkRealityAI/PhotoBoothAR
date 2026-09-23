import { describe, expect, it } from 'vitest';
import {
  CHEAP_INFERENCE_MS,
  DEMAND_TTL_MS,
  createTrackingScheduler,
  isHeld,
  effectiveIntervalMs,
  recordRun,
  requestInference,
  resetTask,
  type TrackTask,
  type TrackingScheduler,
} from './trackingScheduler';

const FLOOR: Record<TrackTask, number> = { face: 33, hand: 66 };

/**
 * Drive the scheduler the way the app does: rendered frames `frameMs` apart;
 * in each frame every caller in `order` asks once; a granted inference blocks
 * for `cost[t]` ms, pushing the clock forward inside the frame. The camera
 * delivers a new frame every 33.3ms (videoTime in seconds).
 */
function simulate(
  s: TrackingScheduler,
  { frames, frameMs, order, cost }: { frames: number; frameMs: number; order: TrackTask[]; cost: Record<TrackTask, number> },
): Record<TrackTask, number> {
  const runs: Record<TrackTask, number> = { face: 0, hand: 0 };
  let now = 1000;
  for (let f = 0; f < frames; f++) {
    const frameKey = f;
    const frameStart = now;
    for (const t of order) {
      const videoTime = Math.floor(now / 33.333) * 0.033333;
      if (requestInference(s, t, now, videoTime, frameKey, FLOOR[t])) {
        const end = now + cost[t];
        recordRun(s, t, now, end, videoTime, frameKey);
        now = end;
        runs[t]++;
      }
    }
    // The next frame starts at the next vsync after this one's work.
    now = Math.max(frameStart + frameMs, now + 1);
  }
  return runs;
}

describe('trackingScheduler — fairness', () => {
  it('the reported bug: face asked FIRST every frame on a slow device no longer starves the hand', () => {
    // Trigger-loop order (face then hand), 20/25ms inferences, frames stretched
    // to ~33ms+ by the blocking calls: the old lockout ran the hand 0 times.
    const s = createTrackingScheduler();
    const runs = simulate(s, { frames: 300, frameMs: 33, order: ['face', 'hand'], cost: { face: 20, hand: 25 } });
    expect(runs.hand).toBeGreaterThan(40);
    expect(runs.face).toBeGreaterThan(80);
  });

  it('holds whichever order the callers arrive in', () => {
    const a = simulate(createTrackingScheduler(), { frames: 300, frameMs: 33, order: ['face', 'hand'], cost: { face: 20, hand: 25 } });
    const b = simulate(createTrackingScheduler(), { frames: 300, frameMs: 33, order: ['hand', 'face'], cost: { face: 20, hand: 25 } });
    expect(Math.abs(a.face - b.face)).toBeLessThanOrEqual(3);
    expect(Math.abs(a.hand - b.hand)).toBeLessThanOrEqual(3);
  });

  it('never runs two EXPENSIVE inferences in one rendered frame', () => {
    const s = createTrackingScheduler();
    // Prime costs: both expensive.
    recordRun(s, 'face', 0, 20, 0, -1);
    recordRun(s, 'hand', 100, 125, 0.1, -2);
    const t0 = 1000;
    expect(requestInference(s, 'face', t0, 1.0, 7, 33)).toBe(true);
    recordRun(s, 'face', t0, t0 + 20, 1.0, 7);
    // Same frame, hand is due and new video exists — still no.
    expect(requestInference(s, 'hand', t0 + 20, 1.0, 7, 66)).toBe(false);
    // Next frame — yes.
    expect(requestInference(s, 'hand', t0 + 34, 1.033, 8, 66)).toBe(true);
  });

  it('lets a fast machine run both in one frame when the first was cheap', () => {
    const s = createTrackingScheduler();
    const runs = simulate(s, { frames: 120, frameMs: 16.7, order: ['face', 'hand'], cost: { face: 3, hand: 4 } });
    // ~2s: face near its 30Hz floor, hand near its 15Hz floor.
    expect(runs.face).toBeGreaterThan(50);
    expect(runs.hand).toBeGreaterThan(25);
    expect(CHEAP_INFERENCE_MS).toBeGreaterThan(4);
  });
});

describe('trackingScheduler — demand, cadence and cost', () => {
  it('an inactive task never blocks the active one', () => {
    const s = createTrackingScheduler();
    const runs = simulate(s, { frames: 120, frameMs: 16.7, order: ['face'], cost: { face: 5, hand: 0 } });
    expect(runs.hand).toBe(0);
    expect(runs.face).toBeGreaterThan(55); // ~30Hz over 2s
  });

  it('a task stops counting as active DEMAND_TTL_MS after its last request', () => {
    const s = createTrackingScheduler();
    requestInference(s, 'hand', 0, 0, 1, 66); // registers hand demand at t=0
    // Hand asked at t=0; at t=DEMAND_TTL_MS+1 face alone decides its interval.
    recordRun(s, 'face', 0, 20, 0, 2);
    expect(effectiveIntervalMs(s, 'face', 10)).toBeCloseTo(20 / 0.35, 6);
    expect(effectiveIntervalMs(s, 'face', DEMAND_TTL_MS + 1)).toBeCloseTo(Math.max(33, 20 / 0.6), 6);
  });

  it('never re-analyses a camera frame it has already seen', () => {
    const s = createTrackingScheduler();
    expect(requestInference(s, 'face', 0, 5.0, 1, 33)).toBe(true);
    recordRun(s, 'face', 0, 5, 5.0, 1);
    expect(requestInference(s, 'face', 40, 5.0, 2, 33)).toBe(false); // same video frame
    expect(requestInference(s, 'face', 41, 5.033, 3, 33)).toBe(true);
  });

  it('stretches intervals to keep the pair inside the duty budget', () => {
    const s = createTrackingScheduler();
    requestInference(s, 'face', 0, 0, 1, 33);
    requestInference(s, 'hand', 0, 0, 1, 66);
    recordRun(s, 'face', 0, 20, 0, 1);
    recordRun(s, 'hand', 40, 60, 0.04, 2);
    // Both active: face 20/0.35, hand 20/0.25; each above its own floor.
    expect(effectiveIntervalMs(s, 'face', 61)).toBeCloseTo(57.142857, 4);
    expect(effectiveIntervalMs(s, 'hand', 61)).toBeCloseTo(80, 6);
    // Cheap inferences keep the floors.
    const f = createTrackingScheduler();
    recordRun(f, 'face', 0, 4, 0, 1);
    expect(effectiveIntervalMs(f, 'face', 5)).toBe(33);
  });

  it('resetTask lets the next request run immediately', () => {
    const s = createTrackingScheduler();
    expect(requestInference(s, 'hand', 0, 1, 1, 66)).toBe(true);
    recordRun(s, 'hand', 0, 10, 1, 1);
    expect(requestInference(s, 'hand', 20, 1.02, 2, 66)).toBe(false);
    resetTask(s, 'hand');
    expect(requestInference(s, 'hand', 21, 1.021, 3, 66)).toBe(true);
  });
});

describe('isHeld — lost means an inference said so', () => {
  it('holds a target no inference has contradicted, however long the gap (up to stale)', () => {
    expect(isHeld(1000 + 1700, 1000, null, 500)).toBe(true); // 1.7s with no face inference: still held
    expect(isHeld(1000 + 2600, 1000, null, 500)).toBe(false); // tracker stalled past STALE_MS
  });
  it('drops it holdMs after the first inference that came back without it', () => {
    expect(isHeld(1300, 1000, 1200, 500)).toBe(true);
    expect(isHeld(1700, 1000, 1200, 500)).toBe(false);
  });
  it('never holds what was never seen', () => {
    expect(isHeld(0, -Infinity, null, 500)).toBe(false);
  });
});
