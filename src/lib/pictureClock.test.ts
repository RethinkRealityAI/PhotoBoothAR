import { describe, it, expect } from 'vitest';
import {
  CAMERA_DELAY_FALLBACK_MS,
  PICTURE_AGE_TAU_MS,
  cameraDelayMs,
  createPictureClock,
  liveAgeMs,
  lockedAgeMs,
  noteCameraFrame,
  notePictureAge,
  smoothedPictureAgeMs,
} from './pictureClock';

describe('camera delay', () => {
  it('uses the fallback until the browser reports a capture time', () => {
    const c = createPictureClock();
    expect(cameraDelayMs(c)).toBe(CAMERA_DELAY_FALLBACK_MS);
    noteCameraFrame(c, 1000); // no captureTime (Safari, older browsers)
    expect(cameraDelayMs(c)).toBe(CAMERA_DELAY_FALLBACK_MS);
    expect(c.cameraSamples).toBe(0);
  });

  it('takes the first reading whole, then smooths', () => {
    const c = createPictureClock();
    noteCameraFrame(c, 1000, 900);
    expect(cameraDelayMs(c)).toBe(100);
    noteCameraFrame(c, 1033, 833); // a 200 ms outlier moves it only a tenth of the way
    expect(cameraDelayMs(c)).toBeCloseTo(110, 5);
  });

  it('ignores a capture time from another clock (negative or absurd delay)', () => {
    const c = createPictureClock();
    noteCameraFrame(c, 1000, 5000);
    noteCameraFrame(c, 1000, -90_000);
    noteCameraFrame(c, 1000, Number.NaN);
    expect(c.cameraSamples).toBe(0);
    expect(cameraDelayMs(c)).toBe(CAMERA_DELAY_FALLBACK_MS);
  });
});

describe('picture age', () => {
  it('live = camera delay + how long the frame has been on the page', () => {
    const c = createPictureClock();
    noteCameraFrame(c, 1000, 920); // 80 ms camera delay
    expect(liveAgeMs(c, 1010)).toBe(90);
  });

  it('live without a frame clock assumes half a camera frame of hold', () => {
    const c = createPictureClock();
    expect(liveAgeMs(c, 5000)).toBe(CAMERA_DELAY_FALLBACK_MS + 16);
    noteCameraFrame(c, 1000, 920);
    expect(liveAgeMs(c, 9000)).toBe(80 + 16); // the clock stalled: don't count 8 s of hold
  });

  it('locked = camera delay + time since the tracker took the frame', () => {
    const c = createPictureClock();
    noteCameraFrame(c, 1000, 920);
    expect(lockedAgeMs(c, 1200, 1050)).toBe(80 + 150);
    expect(lockedAgeMs(c, 1200, Number.NaN)).toBe(liveAgeMs(c, 1200));
  });

  it('averages with a time constant and reports null when stale', () => {
    const c = createPictureClock();
    expect(smoothedPictureAgeMs(c, 0)).toBeNull();
    notePictureAge(c, 0, 100, true);
    expect(smoothedPictureAgeMs(c, 0)).toBe(100);
    notePictureAge(c, PICTURE_AGE_TAU_MS, 300, true); // one time constant: 63% of the way
    expect(smoothedPictureAgeMs(c, PICTURE_AGE_TAU_MS)).toBeCloseTo(100 + 200 * (1 - Math.exp(-1)), 5);
    expect(c.lastAgeMs).toBe(300);
    expect(smoothedPictureAgeMs(c, PICTURE_AGE_TAU_MS + 5000)).toBeNull();
  });

  it('restarts the average after a long gap and ignores bad readings', () => {
    const c = createPictureClock();
    notePictureAge(c, 0, 400, true);
    notePictureAge(c, 10_000, 90, false);
    expect(smoothedPictureAgeMs(c, 10_000)).toBe(90);
    expect(c.locked).toBe(false);
    notePictureAge(c, 10_010, Number.NaN, true);
    notePictureAge(c, 10_010, -5, true);
    expect(smoothedPictureAgeMs(c, 10_010)).toBe(90);
  });
});
