import { describe, it, expect } from 'vitest';
import {
  coverCropRect, defaultParams, defaultParamsFrozen, SHADER_MAP,
  createShadeGate, canReuseShade, markShaded, invalidateShadeGate,
} from './shaders';

/**
 * coverCropRect drives ShaderRunner's aspect correction — the guarantee that a
 * live camera frame (4:3 / 16:9) is CENTER-CROPPED into the 9:16 stage, never
 * stretched, matching StageCanvas.coverFit and the raw video's object-cover.
 */
describe('coverCropRect', () => {
  const A9_16 = 9 / 16;

  it('landscape 16:9 source into 9:16 → crops width, full height, centered', () => {
    const r = coverCropRect(1280, 720, A9_16);
    expect(r.sh).toBe(720);
    expect(r.sw).toBeCloseTo(720 * A9_16, 6); // 405
    expect(r.sx).toBeCloseTo((1280 - 405) / 2, 6);
    expect(r.sy).toBe(0);
  });

  it('4:3 source into 9:16 → crops width, centered', () => {
    const r = coverCropRect(640, 480, A9_16);
    expect(r.sh).toBe(480);
    expect(r.sw).toBeCloseTo(480 * A9_16, 6); // 270
    expect(r.sx).toBeCloseTo((640 - 270) / 2, 6);
    expect(r.sy).toBe(0);
  });

  it('taller-than-target source → crops height, centered', () => {
    const r = coverCropRect(900, 3200, A9_16); // 9:32, taller than 9:16
    expect(r.sw).toBe(900);
    expect(r.sh).toBeCloseTo(900 / A9_16, 6); // 1600
    expect(r.sy).toBeCloseTo((3200 - 1600) / 2, 6);
    expect(r.sx).toBe(0);
  });

  it('matching aspect → identity rect (capture dissolve passthrough)', () => {
    const r = coverCropRect(1080, 1920, A9_16);
    expect(r).toEqual({ sx: 0, sy: 0, sw: 1080, sh: 1920 });
  });

  it('crop rect always preserves the destination aspect', () => {
    for (const [w, h] of [[1280, 720], [640, 480], [1920, 1080], [720, 1280], [500, 3000]] as const) {
      const { sw, sh } = coverCropRect(w, h, A9_16);
      expect(sw / sh).toBeCloseTo(A9_16, 6);
      expect(sw).toBeLessThanOrEqual(w);
      expect(sh).toBeLessThanOrEqual(h);
    }
  });
});

/**
 * The hot render path reads the SHARED frozen defaults instead of rebuilding
 * them every frame. `defaultParams` must keep handing out a fresh, mutable copy
 * — several callers store it on a draft/experience and then mutate it.
 */
describe('defaultParamsFrozen / defaultParams', () => {
  it('returns the identical instance on every call (no per-frame allocation)', () => {
    expect(defaultParamsFrozen('champagne-sparkle')).toBe(defaultParamsFrozen('champagne-sparkle'));
  });

  it('the shared instance is frozen so a caller cannot corrupt every later frame', () => {
    expect(Object.isFrozen(defaultParamsFrozen('velvet-film'))).toBe(true);
  });

  it('defaultParams still returns a fresh, mutable copy', () => {
    const a = defaultParams('champagne-sparkle');
    const b = defaultParams('champagne-sparkle');
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
    a.uSparkle = 0.123;
    expect(defaultParams('champagne-sparkle').uSparkle).not.toBe(0.123);
    expect(defaultParamsFrozen('champagne-sparkle').uSparkle).not.toBe(0.123);
  });

  it('matches each shader definition, for every shader', () => {
    for (const def of Object.values(SHADER_MAP)) {
      const expected = Object.fromEntries(def.params.map((p) => [p.key, p.default]));
      expect(defaultParams(def.id)).toEqual(expected);
      expect(defaultParamsFrozen(def.id)).toEqual(expected);
    }
  });

  it('unknown shader id yields an empty map (unchanged behaviour)', () => {
    expect(defaultParams('no-such-shader')).toEqual({});
    expect(defaultParamsFrozen('no-such-shader')).toEqual({});
  });
});

/**
 * ShadeGate decides whether the runner's preserved drawing buffer can be
 * composited again instead of re-shading a video frame that has not advanced.
 */
describe('ShadeGate', () => {
  it('a fresh gate never reuses', () => {
    expect(canReuseShade(createShadeGate(), 1.5, 'velvet-film', 720, 1280)).toBe(false);
  });

  it('reuses only when clock, shader and buffer size all match', () => {
    const g = createShadeGate();
    markShaded(g, 1.5, 'velvet-film', 720, 1280);
    expect(canReuseShade(g, 1.5, 'velvet-film', 720, 1280)).toBe(true);
    expect(canReuseShade(g, 1.5333, 'velvet-film', 720, 1280)).toBe(false); // new frame
    expect(canReuseShade(g, 1.5, 'neon-pulse', 720, 1280)).toBe(false);     // filter changed
    expect(canReuseShade(g, 1.5, 'velvet-film', 1080, 1920)).toBe(false);   // capture size
    expect(canReuseShade(g, 1.5, 'velvet-film', 720, 1281)).toBe(false);
  });

  it('never reuses without a usable video clock', () => {
    const g = createShadeGate();
    markShaded(g, 0, 'velvet-film', 720, 1280);
    expect(canReuseShade(g, 0, 'velvet-film', 720, 1280)).toBe(false);
    expect(canReuseShade(g, NaN, 'velvet-film', 720, 1280)).toBe(false);
    expect(canReuseShade(g, Infinity, 'velvet-film', 720, 1280)).toBe(false);
    expect(canReuseShade(g, -1, 'velvet-film', 720, 1280)).toBe(false);
  });

  it('a non-finite mark leaves the gate unusable rather than stale', () => {
    const g = createShadeGate();
    markShaded(g, NaN, 'velvet-film', 720, 1280);
    expect(g.time).toBe(-1);
    expect(canReuseShade(g, NaN, 'velvet-film', 720, 1280)).toBe(false);
  });

  it('invalidate forces the next frame to shade again', () => {
    const g = createShadeGate();
    markShaded(g, 2.25, 'aurora-lumina', 720, 1280);
    expect(canReuseShade(g, 2.25, 'aurora-lumina', 720, 1280)).toBe(true);
    invalidateShadeGate(g);
    expect(canReuseShade(g, 2.25, 'aurora-lumina', 720, 1280)).toBe(false);
  });
});
