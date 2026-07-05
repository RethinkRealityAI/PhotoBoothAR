import { describe, it, expect } from 'vitest';
import { cropImageStyle } from './framePreview';
import { DEFAULT_CROP } from '../booth/capture';

/** Parse a "12.5%" string back to a number. */
function pct(v: unknown): number {
  return parseFloat(String(v).replace('%', ''));
}

describe('cropImageStyle (WYSIWYG preview transform)', () => {
  it('a 9:16 image at defaults exactly fills the frame box', () => {
    const s = cropImageStyle(DEFAULT_CROP, 1080, 1920);
    expect(pct(s.left)).toBeCloseTo(0);
    expect(pct(s.top)).toBeCloseTo(0);
    expect(pct(s.width)).toBeCloseTo(100);
    expect(pct(s.height)).toBeCloseTo(100);
    expect(s.transform).toBeUndefined(); // no rotation → no transform
  });

  it('a landscape image overflows horizontally and stays centered', () => {
    const s = cropImageStyle(DEFAULT_CROP, 1920, 1080, );
    expect(pct(s.width)).toBeGreaterThan(100);
    expect(pct(s.height)).toBeCloseTo(100);
    // centered: left + width/2 = 50%
    expect(pct(s.left) + pct(s.width) / 2).toBeCloseTo(50);
    expect(pct(s.top)).toBeCloseTo(0);
  });

  it('zoom scales the drawn size about the centre', () => {
    const base = cropImageStyle({ ...DEFAULT_CROP, zoom: 1 }, 1080, 1920);
    const zoomed = cropImageStyle({ ...DEFAULT_CROP, zoom: 2 }, 1080, 1920);
    expect(pct(zoomed.width)).toBeCloseTo(pct(base.width) * 2);
    expect(pct(zoomed.height)).toBeCloseTo(pct(base.height) * 2);
    // still centred
    expect(pct(zoomed.left) + pct(zoomed.width) / 2).toBeCloseTo(50);
    expect(pct(zoomed.top) + pct(zoomed.height) / 2).toBeCloseTo(50);
  });

  it('pan shifts by the requested fraction of the frame', () => {
    const centered = cropImageStyle({ ...DEFAULT_CROP, zoom: 1.5 }, 1080, 1920);
    const panned = cropImageStyle({ ...DEFAULT_CROP, zoom: 1.5, offsetX: 0.1, offsetY: -0.2 }, 1080, 1920);
    expect(pct(panned.left) - pct(centered.left)).toBeCloseTo(10); // +0.1 frame width
    expect(pct(panned.top) - pct(centered.top)).toBeCloseTo(-20);  // -0.2 frame height
  });

  it('carries a CSS rotation for quarter turns', () => {
    const s = cropImageStyle({ ...DEFAULT_CROP, rotation: 90 }, 1920, 1080);
    expect(s.transform).toBe('rotate(90deg)');
    expect(s.transformOrigin).toBe('center center');
  });
});
