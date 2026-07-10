import { describe, it, expect } from 'vitest';
import {
  keyOutColor,
  fitOnCanvas,
  processFrameImage,
  FRAME_W,
  FRAME_H,
  type RgbaImage,
} from './chromaKey';

/** Build a solid-colour RGBA buffer. */
function solid(w: number, h: number, [r, g, b, a]: [number, number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return { data, width: w, height: h };
}

function px(img: RgbaImage, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

const GREEN: [number, number, number, number] = [0, 255, 0, 255];

describe('keyOutColor', () => {
  it('makes a solid pure-green buffer fully transparent', () => {
    const out = keyOutColor(solid(4, 4, GREEN));
    for (let i = 3; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(0);
    }
  });

  it('keeps a red square on green fully opaque, keys the green', () => {
    // 3×3 green with a red centre pixel.
    const img = solid(3, 3, GREEN);
    const ci = (1 * 3 + 1) * 4;
    img.data[ci] = 255;
    img.data[ci + 1] = 0;
    img.data[ci + 2] = 0;
    const out = keyOutColor(img);
    expect(px(out, 1, 1)).toEqual([255, 0, 0, 255]); // red survives, alpha 255
    expect(px(out, 0, 0)[3]).toBe(0); // green corner keyed out
  });

  it('produces an intermediate alpha in the soft band', () => {
    // (100,255,100) sits at chroma distance ≈53 from #00FF00 → between the
    // default tolerance (40) and tolerance+softness (65).
    const img = solid(1, 1, [100, 255, 100, 255]);
    const out = keyOutColor(img);
    const a = px(out, 0, 0)[3];
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(255);
  });

  it('despills — reduces the green channel on a semi-transparent edge pixel', () => {
    const img = solid(1, 1, [100, 255, 100, 255]);
    const out = keyOutColor(img);
    const [, g] = px(out, 0, 0);
    expect(g).toBeLessThan(255); // clamped down to max(R,B)=100
    expect(g).toBeLessThanOrEqual(100);
  });

  it('leaves non-green content untouched when nothing matches', () => {
    const img = solid(2, 2, [0, 0, 255, 255]); // pure blue
    const before = Uint8ClampedArray.from(img.data);
    const out = keyOutColor(img);
    expect(out.data).toEqual(before); // rgb + alpha all preserved
  });

  it('does not mutate the input buffer', () => {
    const img = solid(2, 2, GREEN);
    const snapshot = Uint8ClampedArray.from(img.data);
    keyOutColor(img);
    expect(img.data).toEqual(snapshot);
  });
});

describe('fitOnCanvas', () => {
  it('contains + centres the art and keeps the padding transparent', () => {
    // 2×2 red source → 4×8 target. CONTAIN scale = 2, art = 4×4, offset y = 2.
    const out = fitOnCanvas(solid(2, 2, [255, 0, 0, 255]), 4, 8);
    expect(out.width).toBe(4);
    expect(out.height).toBe(8);
    // Top and bottom bands are transparent.
    expect(px(out, 0, 0)[3]).toBe(0);
    expect(px(out, 0, 7)[3]).toBe(0);
    // The centred 4×4 band is opaque red.
    expect(px(out, 2, 4)).toEqual([255, 0, 0, 255]);
    expect(px(out, 0, 2)[3]).toBe(255);
    expect(px(out, 3, 5)[3]).toBe(255);
  });

  it('preserves aspect ratio (never stretches a wide source to fill)', () => {
    // 4×1 wide source into a 4×4 square → scale 1, art height 1, centred at y=1.
    const out = fitOnCanvas(solid(4, 1, [255, 0, 0, 255]), 4, 4);
    expect(px(out, 0, 0)[3]).toBe(0); // row 0 padding
    expect(px(out, 0, 1)[3]).toBe(255); // the single art row
    expect(px(out, 0, 2)[3]).toBe(0); // padding below
  });
});

describe('processFrameImage', () => {
  it('keys green + fits onto the 1080×1920 booth canvas by default', () => {
    const out = processFrameImage(solid(10, 10, GREEN));
    expect(out.width).toBe(FRAME_W);
    expect(out.height).toBe(FRAME_H);
    // All-green source → the whole canvas ends up transparent. Scan into a
    // single boolean (2M+ expect() calls would take tens of seconds).
    let maxAlpha = 0;
    for (let i = 3; i < out.data.length; i += 4) {
      if (out.data[i] > maxAlpha) maxAlpha = out.data[i];
    }
    expect(maxAlpha).toBe(0);
  });
});
