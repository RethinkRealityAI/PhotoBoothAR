import { describe, it, expect } from 'vitest';
import {
  keyOutColor,
  keyOutColorWithStats,
  detectKeyColor,
  fitOnCanvas,
  processFrameImage,
  DEFAULT_KEY,
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

  it('neutralizes the RGB of fully-keyed pixels (no green retained under alpha 0)', () => {
    // W5 audit HIGH#1: green left behind alpha 0 poisoned straight-alpha
    // resampling into an olive fringe. Keyed pixels must be (0,0,0,0).
    const out = keyOutColor(solid(2, 2, GREEN));
    expect(px(out, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it('never despills pre-existing semi-transparent content far from the key', () => {
    // W5 audit #7: a kept teal (far from #00FF00) with inherited source alpha
    // must keep its green channel — despill gates on the KEY factor now.
    const img = solid(1, 1, [0, 200, 150, 128]);
    const out = keyOutColor(img);
    expect(px(out, 0, 0)).toEqual([0, 200, 150, 128]);
  });
});

describe('fringe regression (audit HIGH#1 probe)', () => {
  it('scaling a keyed image never produces olive/green seam pixels', () => {
    // 4×4: left half red on right half green, keyed, then scaled ×1.5 (≠1 —
    // forces interpolation across the kept/keyed seam like real Gemini output).
    const img = solid(4, 4, GREEN);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) {
      const i = (y * 4 + x) * 4;
      img.data[i] = 255; img.data[i + 1] = 0; img.data[i + 2] = 0;
    }
    const keyed = keyOutColor(img);
    const fitted = fitOnCanvas(keyed, 6, 6);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) {
      const [r, g, , a] = px(fitted, x, y);
      if (a === 0) continue; // fully transparent — colour irrelevant
      // Any visible pixel must be red-dominant — never green-tinted (olive
      // was r≈g from blending retained green under alpha 0).
      expect(g).toBeLessThanOrEqual(r);
    }
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
    const { image: out } = processFrameImage(solid(10, 10, GREEN));
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

/** Build an RGBA buffer from a per-pixel colour function. */
function generate(
  w: number,
  h: number,
  fn: (x: number, y: number) => [number, number, number, number],
): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const [r, g, b, a] = fn(x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { data, width: w, height: h };
}

describe('detectKeyColor + adaptive processFrameImage', () => {
  const OFF_GREEN: [number, number, number] = [0, 177, 64]; // #00B140

  it('(a) detects an off-green (#00B140) backdrop and keys it, art intact', () => {
    // Flat #00B140 backdrop, magenta art in the centre.
    const img = generate(40, 40, (x, y) => {
      const inArt = x >= 16 && x < 24 && y >= 16 && y < 24;
      return inArt ? [255, 0, 255, 255] : [...OFF_GREEN, 255];
    });
    const det = detectKeyColor(img);
    expect(det).not.toBeNull();
    expect(det!.key[0]).toBeLessThan(30); // ≈ #00B140
    expect(det!.key[1]).toBeGreaterThan(150);
    expect(det!.key[2]).toBeLessThan(100);
    const { image, keyedFraction } = keyOutColorWithStats(img, { key: det!.key });
    expect(keyedFraction).toBeGreaterThan(0.5); // most of the backdrop keyed
    expect(px(image, 20, 20)).toEqual([255, 0, 255, 255]); // magenta art survives
    expect(px(image, 0, 0)[3]).toBe(0); // #00B140 corner keyed out
  });

  it('(a2) the legacy fixed #00FF00 key barely touches #00B140 — the bug the fix closes', () => {
    // Proves the root cause: a flat off-shade green is < the 3% honesty gate
    // under the OLD fixed key, so the panel would have shipped it green.
    const { keyedFraction } = keyOutColorWithStats(solid(40, 40, [...OFF_GREEN, 255]));
    expect(keyedFraction).toBeLessThan(0.03);
  });

  it('(b) keys a constant-chroma green gradient uniformly (luminance-invariant)', () => {
    // Adding the same offset to R,G,B shifts luminance but keeps (Cb,Cr) fixed
    // — a true shaded green screen. The whole gradient must key uniformly.
    const img = generate(30, 30, (_x, y) => {
      const t = -25 + Math.round((y / 29) * 60); // luminance shift only
      return [30 + t, 180 + t, 30 + t, 255];
    });
    const det = detectKeyColor(img);
    expect(det).not.toBeNull();
    expect(det!.key[1]).toBeGreaterThan(det!.key[0]); // green-dominant
    const { keyedFraction } = keyOutColorWithStats(img, { key: det!.key });
    expect(keyedFraction).toBeGreaterThan(0.98); // top-to-bottom, not just one band
  });

  it('(c) exact #00FF00 backdrop keys identically to the legacy fixed-key path', () => {
    const img = generate(40, 40, (x, y) => {
      const inArt = x >= 16 && x < 24 && y >= 16 && y < 24;
      return inArt ? [255, 0, 0, 255] : [0, 255, 0, 255];
    });
    // Detection lands exactly on pure green, so the adaptive keyer feeds the
    // identical key to the identical pipeline as the old fixed-key path.
    const det = detectKeyColor(img);
    expect(det!.key).toEqual([0, 255, 0]);
    expect(processFrameImage(img).keyColor).toEqual([0, 255, 0]);
    // Compare the keyed buffers at SOURCE resolution (a 40×40 compare; a full
    // 1080×1920 toEqual is ~8M elements and takes a minute). fitOnCanvas is
    // deterministic, so identical keyed input ⇒ identical fitted output.
    const adaptiveKeyed = keyOutColor(img, { key: det!.key });
    const legacyKeyed = keyOutColor(img, { key: DEFAULT_KEY });
    expect(adaptiveKeyed.data).toEqual(legacyKeyed.data);
  });

  it('(d) reports keyedFraction ≈ 0 on a green-free image (honesty gate)', () => {
    // Blue art on white — nothing green. Detection returns null → DEFAULT_KEY →
    // the keyer removes ~nothing → below AiFramePanel's 3% threshold.
    const img = generate(40, 40, (x, y) => {
      const inArt = x >= 16 && x < 24 && y >= 16 && y < 24;
      return inArt ? [30, 60, 200, 255] : [255, 255, 255, 255];
    });
    expect(detectKeyColor(img)).toBeNull();
    const { keyedFraction } = processFrameImage(img);
    expect(keyedFraction).toBeLessThan(0.03);
  });

  it('(e) detects the key on a sticker layout (green surround, centred subject)', () => {
    // Skin-toned subject centred; #00C846-ish green surrounds it.
    const img = generate(40, 40, (x, y) => {
      const inSubject = x >= 12 && x < 28 && y >= 12 && y < 28;
      return inSubject ? [210, 170, 120, 255] : [0, 200, 70, 255];
    });
    const det = detectKeyColor(img);
    expect(det).not.toBeNull();
    expect(det!.key[1]).toBeGreaterThan(150); // green-channel dominant surround
    const { image, keyedFraction } = keyOutColorWithStats(img, { key: det!.key });
    expect(keyedFraction).toBeGreaterThan(0.4); // the surround keyed
    expect(px(image, 20, 20)[3]).toBe(255); // subject survives
  });

  it('(f) locks onto the dominant backdrop hue over green-family art; distant art survives', () => {
    // Pure #00FF00 backdrop with dark forest-green art in the centre. Forest
    // green is green-family too, but the backdrop cluster is far denser so
    // detection locks onto #00FF00; forest green's chroma is distant enough
    // (far less saturated) to survive keying.
    // LIMITATION: art whose chroma lands within `tolerance` of the detected
    // backdrop hue IS eaten — this is the "avoid near-key art" UI tip.
    const FOREST: [number, number, number] = [20, 70, 30];
    const img = generate(40, 40, (x, y) => {
      const inArt = x >= 16 && x < 24 && y >= 16 && y < 24;
      return inArt ? [...FOREST, 255] : [0, 255, 0, 255];
    });
    const det = detectKeyColor(img);
    expect(det).not.toBeNull();
    expect(det!.key[0]).toBeLessThan(20); // ≈ pure green, not forest
    expect(det!.key[1]).toBeGreaterThan(240);
    const { image } = keyOutColorWithStats(img, { key: det!.key });
    expect(px(image, 20, 20)[3]).toBeGreaterThan(0); // forest art survives
    expect(px(image, 0, 0)[3]).toBe(0); // #00FF00 backdrop keyed
  });
});
