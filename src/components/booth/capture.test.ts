import { describe, it, expect } from 'vitest';
import { computeCropRect, FRAME_W, FRAME_H } from './capture';

describe('computeCropRect', () => {
  it('cover-fits a portrait image to exactly fill the frame at zoom=1', () => {
    // Same 9:16 aspect → fills perfectly, no offset.
    const r = computeCropRect(1080, 1920, FRAME_W, FRAME_H, 1, 0, 0);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(0);
    expect(r.w).toBeCloseTo(FRAME_W);
    expect(r.h).toBeCloseTo(FRAME_H);
  });

  it('cover-fits a landscape image (crops the sides) and centres it', () => {
    // Wide image: scaled so height fills 1920, width overflows and is centred.
    const r = computeCropRect(1920, 1080, FRAME_W, FRAME_H, 1, 0, 0);
    expect(r.h).toBeCloseTo(FRAME_H);
    expect(r.w).toBeGreaterThan(FRAME_W); // overflows horizontally
    expect(r.x).toBeCloseTo((FRAME_W - r.w) / 2); // centred
    expect(r.y).toBeCloseTo(0);
  });

  it('grows the draw rect with zoom about the centre', () => {
    const base = computeCropRect(1080, 1920, FRAME_W, FRAME_H, 1, 0, 0);
    const zoomed = computeCropRect(1080, 1920, FRAME_W, FRAME_H, 2, 0, 0);
    expect(zoomed.w).toBeCloseTo(base.w * 2);
    expect(zoomed.h).toBeCloseTo(base.h * 2);
    // still centred about the frame centre
    expect(zoomed.x + zoomed.w / 2).toBeCloseTo(FRAME_W / 2);
    expect(zoomed.y + zoomed.h / 2).toBeCloseTo(FRAME_H / 2);
  });

  it('pans by a fraction of the frame dimensions', () => {
    const centered = computeCropRect(1080, 1920, FRAME_W, FRAME_H, 1.5, 0, 0);
    const panned = computeCropRect(1080, 1920, FRAME_W, FRAME_H, 1.5, 0.1, -0.2);
    expect(panned.x - centered.x).toBeCloseTo(0.1 * FRAME_W);
    expect(panned.y - centered.y).toBeCloseTo(-0.2 * FRAME_H);
  });

  it('guards against a zero/negative zoom', () => {
    const r = computeCropRect(1080, 1920, FRAME_W, FRAME_H, 0, 0, 0);
    expect(r.w).toBeGreaterThan(0);
    expect(r.h).toBeGreaterThan(0);
  });
});
