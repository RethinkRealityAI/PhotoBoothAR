import { describe, expect, it } from 'vitest';
import { INFERENCE_MAX_SIDE_PX, inferenceSize } from './trackingFrame';

describe('inferenceSize', () => {
  it('passes a feed at or under the cap through untouched', () => {
    expect(inferenceSize(1280, 720)).toBeNull();
    expect(inferenceSize(640, 480)).toBeNull();
    expect(inferenceSize(720, 1280)).toBeNull();
  });

  it('downscales 1080p to the cap with the aspect preserved exactly', () => {
    expect(inferenceSize(1920, 1080)).toEqual([1280, 720]);
    expect(inferenceSize(1080, 1920)).toEqual([720, 1280]);
  });

  it('keeps the long side exact and rounds the short side once', () => {
    const [w, h] = inferenceSize(1920, 1440) as [number, number]; // 4:3
    expect(w).toBe(INFERENCE_MAX_SIDE_PX);
    expect(h).toBe(960);
    const odd = inferenceSize(4032, 3024) as [number, number]; // phone photo 4:3
    expect(odd[0]).toBe(INFERENCE_MAX_SIDE_PX);
    expect(Math.abs(odd[0] / odd[1] - 4032 / 3024)).toBeLessThan(1e-3);
  });

  it('refuses a feed with no dimensions yet', () => {
    expect(inferenceSize(0, 0)).toBeNull();
    expect(inferenceSize(NaN, 720)).toBeNull();
    expect(inferenceSize(-1, 720)).toBeNull();
  });

  it('honours a caller-supplied cap', () => {
    expect(inferenceSize(1920, 1080, 960)).toEqual([960, 540]);
  });
});
