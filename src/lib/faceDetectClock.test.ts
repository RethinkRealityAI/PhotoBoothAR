import { describe, it, expect } from 'vitest';
import {
  createDetectGate,
  shouldDetect,
  markDetected,
  DEFAULT_MIN_INTERVAL_MS,
  DEFAULT_STALL_WATCHDOG_MS,
} from './faceDetectClock';

describe('shouldDetect', () => {
  it('runs on the very first frame', () => {
    expect(shouldDetect(createDetectGate(), 0, 0)).toBe(true);
  });

  it('never exceeds the configured cadence, however fast frames arrive', () => {
    const g = createDetectGate();
    markDetected(g, 1000, 10.0);
    // A 120fps camera delivers a new frame every ~8ms; most must be skipped.
    expect(shouldDetect(g, 1008, 10.008)).toBe(false);
    expect(shouldDetect(g, 1016, 10.016)).toBe(false);
    expect(shouldDetect(g, 1000 + DEFAULT_MIN_INTERVAL_MS, 10.033)).toBe(true);
  });

  it('does NOT re-analyse a frame the camera has not replaced', () => {
    // The shipped bug: a wall-clock-only gate re-ran blocking inference on the
    // identical frame whenever the timer elapsed first.
    const g = createDetectGate();
    markDetected(g, 1000, 10.0);
    expect(shouldDetect(g, 1000 + DEFAULT_MIN_INTERVAL_MS + 5, 10.0)).toBe(false);
  });

  it('runs as soon as a new frame exists past the interval', () => {
    const g = createDetectGate();
    markDetected(g, 1000, 10.0);
    expect(shouldDetect(g, 1040, 10.033)).toBe(true);
  });

  it('falls back to the watchdog when the video clock is stuck', () => {
    const g = createDetectGate();
    markDetected(g, 1000, 10.0);
    // Same currentTime the whole time — a frozen/omitted clock must not freeze
    // tracking permanently.
    expect(shouldDetect(g, 1000 + DEFAULT_STALL_WATCHDOG_MS - 1, 10.0)).toBe(false);
    expect(shouldDetect(g, 1000 + DEFAULT_STALL_WATCHDOG_MS, 10.0)).toBe(true);
  });

  it('treats a non-finite currentTime as no clock, and still recovers', () => {
    const g = createDetectGate();
    markDetected(g, 1000, 10.0);
    expect(shouldDetect(g, 1050, NaN)).toBe(false);
    expect(shouldDetect(g, 1000 + DEFAULT_STALL_WATCHDOG_MS, NaN)).toBe(true);
  });

  it('honours custom cadence and watchdog', () => {
    const g = createDetectGate();
    markDetected(g, 0, 1);
    expect(shouldDetect(g, 10, 2, { minIntervalMs: 16 })).toBe(false);
    expect(shouldDetect(g, 16, 2, { minIntervalMs: 16 })).toBe(true);
    expect(shouldDetect(g, 60, 1, { minIntervalMs: 16, stallWatchdogMs: 50 })).toBe(true);
  });

  it('analyses each frame of a steady 30fps stream exactly once', () => {
    const g = createDetectGate();
    let detections = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) {
      const now = i * 16.7;              // 60fps render loop
      const videoTime = Math.floor(i / 2) * 0.0333; // 30fps camera
      if (shouldDetect(g, now, videoTime)) {
        // Every detection must be of a frame we have not already analysed.
        expect(seen.has(videoTime)).toBe(false);
        seen.add(videoTime);
        detections++;
        markDetected(g, now, videoTime);
      }
    }
    // ~1s of a 30fps camera → in the high twenties, and never a repeat.
    expect(detections).toBeGreaterThan(24);
    expect(detections).toBe(seen.size);
  });
});

describe('markDetected', () => {
  it('records the frame so the next call can compare against it', () => {
    const g = createDetectGate();
    markDetected(g, 500, 3.5);
    expect(g.lastDetectMs).toBe(500);
    expect(g.lastVideoTime).toBe(3.5);
  });

  it('keeps the last GOOD video time when handed a non-finite one', () => {
    const g = createDetectGate();
    markDetected(g, 500, 3.5);
    markDetected(g, 600, NaN);
    expect(g.lastVideoTime).toBe(3.5);
    expect(g.lastDetectMs).toBe(600);
  });
});
