import { describe, it, expect } from 'vitest';
import { coverCropRect } from './shaders';

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
