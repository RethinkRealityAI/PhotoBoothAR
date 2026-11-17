import { describe, it, expect } from 'vitest';
import {
  assessFrame,
  alphaMask,
  components,
  diagnoseFill,
  retryCorrection,
  shouldAutoRetry,
  rekeyOptions,
  prepareFrame,
  takeUsable,
  rankTakes,
  autoRetryCode,
  paintingCopy,
  type QualityResult,
} from './frameQuality';
import type { RgbaImage } from './chromaKey';
import { FRAME_GEOMETRY } from '../assetPrompt';

/* Synthetic frames at 540×960 — the same 9:16 fractions as 1080×1920. */
const W = 540;
const H = 960;
const GOLD: [number, number, number, number] = [212, 175, 55, 255];
const CLEAR: [number, number, number, number] = [0, 0, 0, 0];

function canvas(fill: [number, number, number, number] = GOLD): RgbaImage {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { data, width: W, height: H };
}

type Px = [number, number, number, number];
function paint(img: RgbaImage, test: (fx: number, fy: number) => boolean, colour: Px | ((x: number, y: number) => Px)) {
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const fx = (x + 0.5) / img.width, fy = (y + 0.5) / img.height;
      if (test(fx, fy)) img.data.set(typeof colour === 'function' ? colour(x, y) : colour, (y * img.width + x) * 4);
    }
  }
}
const rect = (x0: number, y0: number, x1: number, y1: number) => (fx: number, fy: number) =>
  fx >= x0 && fx < x1 && fy >= y0 && fy < y1;
const ellipse = (cx: number, cy: number, rx: number, ry: number) => (fx: number, fy: number) =>
  ((fx - cx) / rx) ** 2 + ((fy - cy) / ry) ** 2 <= 1;

/** A good classic border: art band, the geometry window clear. */
function classic(): RgbaImage {
  const img = canvas();
  const w = FRAME_GEOMETRY['classic-border'].windows[0];
  paint(img, rect(w.cx - w.rx, w.cy - w.ry, w.cx + w.rx, w.cy + w.ry), CLEAR);
  return img;
}

/** A good full scene: art everywhere except the requested ellipse(s). */
function scene(layout: 'full-scene' | 'duo-scene' = 'full-scene'): RgbaImage {
  const img = canvas();
  for (const w of FRAME_GEOMETRY[layout].windows) paint(img, ellipse(w.cx, w.cy, w.rx, w.ry), CLEAR);
  return img;
}

const SRC = { width: 768, height: 1344 }; // Gemini 2.5's real 9:16 output
const codes = (r: QualityResult) => r.reasons.map((x) => x.code);
const fails = (r: QualityResult) => r.reasons.filter((x) => x.severity === 'fail').map((x) => x.code);

describe('mask + components', () => {
  it('downsamples alpha into cells and labels 4-connected regions', () => {
    const img = scene('duo-scene');
    const m = alphaMask(img);
    expect(m.w).toBe(68);
    expect(m.h).toBe(120);
    const { comps } = components(m, 1);
    expect(comps.filter((c) => !c.touchesEdge)).toHaveLength(2);
  });
});

describe('assessFrame — classic border', () => {
  it('passes a clean border', () => {
    const r = assessFrame({ fitted: classic(), layout: 'classic-border', source: SRC });
    expect(fails(r)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.score).toBeGreaterThan(0.8);
  });

  it('fails a window painted black, naming it', () => {
    const img = classic();
    paint(img, rect(0.2, 0.2, 0.8, 0.7), [8, 8, 10, 255]);
    const r = assessFrame({ fitted: img, layout: 'classic-border', source: SRC });
    expect(fails(r)).toContain('window_painted');
    expect(r.reasons.find((x) => x.code === 'window_painted')!.message).toMatch(/black/);
  });

  it('fails a grey checkerboard window ("transparent" as a model paints it)', () => {
    const img = classic();
    paint(img, rect(0.15, 0.15, 0.85, 0.8), (x, y) =>
      ((Math.floor(x / 12) + Math.floor(y / 12)) % 2 === 0 ? [255, 255, 255, 255] : [204, 204, 204, 255]));
    const r = assessFrame({ fitted: img, layout: 'classic-border', source: SRC });
    expect(r.reasons.find((x) => x.code === 'window_painted')?.message).toMatch(/checkerboard/);
  });

  it('fails a face drawn in the window', () => {
    const img = classic();
    paint(img, ellipse(0.5, 0.42, 0.14, 0.1), [224, 172, 140, 255]);
    const r = assessFrame({ fitted: img, layout: 'classic-border', source: SRC });
    expect(fails(r)).toContain('face_in_window');
  });

  it('a sparkle in the window is not a face', () => {
    const img = classic();
    paint(img, ellipse(0.3, 0.15, 0.01, 0.006), [255, 240, 200, 255]);
    const r = assessFrame({ fitted: img, layout: 'classic-border', source: SRC });
    expect(r.ok).toBe(true);
  });

  it('warns when the border is a few hairlines', () => {
    const img = canvas(CLEAR);
    paint(img, rect(0, 0, 1, 0.015), GOLD);
    paint(img, rect(0, 0.985, 1, 1), GOLD);
    const r = assessFrame({ fitted: img, layout: 'classic-border', source: SRC });
    expect(codes(r)).toContain('border_thin');
  });
});

describe('assessFrame — cut-out scenes', () => {
  it('passes a scene whose ellipse is where it was asked for', () => {
    expect(assessFrame({ fitted: scene(), layout: 'full-scene', source: SRC }).ok).toBe(true);
    expect(assessFrame({ fitted: scene('duo-scene'), layout: 'duo-scene', source: SRC }).ok).toBe(true);
  });

  it('fails a misplaced cut-out', () => {
    const img = canvas();
    paint(img, ellipse(0.5, 0.75, 0.17, 0.105), CLEAR);
    expect(fails(assessFrame({ fitted: img, layout: 'full-scene', source: SRC }))).toContain('window_misplaced');
  });

  it('fails a face painted inside the cut-out', () => {
    const img = scene();
    paint(img, ellipse(0.5, 0.38, 0.08, 0.05), [224, 172, 140, 255]);
    expect(fails(assessFrame({ fitted: img, layout: 'full-scene', source: SRC }))).toContain('face_in_window');
  });

  it('fails a duo scene with one opening, and a scene with none', () => {
    expect(fails(assessFrame({ fitted: scene(), layout: 'duo-scene', source: SRC }))).toContain('window_count');
    expect(fails(assessFrame({ fitted: canvas(), layout: 'full-scene', source: SRC }))).toContain('unkeyed');
  });

  it('fails a "scene" that came back as a border', () => {
    expect(fails(assessFrame({ fitted: classic(), layout: 'full-scene', source: SRC }))).toContain('not_full_scene');
  });
});

describe('assessFrame — corner + lower third', () => {
  it('passes clean corners; fails art in the centre', () => {
    const img = canvas(CLEAR);
    paint(img, rect(0, 0, 0.4, 0.25), GOLD);
    paint(img, rect(0.6, 0.75, 1, 1), GOLD);
    expect(assessFrame({ fitted: img, layout: 'corner-overlay', source: SRC }).ok).toBe(true);
    paint(img, rect(0.35, 0.4, 0.65, 0.6), GOLD);
    expect(fails(assessFrame({ fitted: img, layout: 'corner-overlay', source: SRC }))).toContain('art_in_window');
  });

  it('a lower third passes, and honestly warns that the booth controls hide most of it', () => {
    const img = canvas(CLEAR);
    paint(img, rect(0, 0.66, 1, 1), GOLD);
    const r = assessFrame({ fitted: img, layout: 'bottom-third', source: SRC });
    expect(r.ok).toBe(true);
    expect(codes(r)).toContain('hidden_by_controls');
  });
});

describe('assessFrame — aspect', () => {
  it('accepts Gemini 768×1344, warns on a slight mismatch, fails a square', () => {
    expect(codes(assessFrame({ fitted: classic(), layout: 'classic-border', source: SRC }))).not.toContain('aspect');
    const slight = assessFrame({ fitted: classic(), layout: 'classic-border', source: { width: 800, height: 1300 } });
    expect(slight.reasons.find((x) => x.code === 'aspect')?.severity).toBe('warn');
    expect(fails(assessFrame({ fitted: classic(), layout: 'classic-border', source: { width: 1024, height: 1024 } })))
      .toContain('aspect');
  });
});

describe('assessFrame — stray-hole repair', () => {
  const hole = rect(0.03, 0.5, 0.06, 0.52); // inside the left border band, ~0.06% of canvas

  it('restores textured art the keyer ate', () => {
    const original = classic();
    paint(original, hole, (x) => (x % 2 ? [180, 60, 40, 255] : [40, 30, 140, 255]));
    const fitted = classic();
    paint(fitted, hole, CLEAR);
    const r = assessFrame({ fitted, layout: 'classic-border', source: SRC, original });
    expect(r.repairedHoles).toBe(1);
    const i = (Math.floor(0.51 * H) * W + Math.floor(0.045 * W)) * 4;
    expect(r.repaired!.data[i + 3]).toBe(255);
    expect(r.repaired!.data[i]).toBe(original.data[i]); // real source pixel back
    expect(r.ok).toBe(true);
  });

  it('fills a flat green speck from its surroundings instead of restoring green', () => {
    const original = classic();
    paint(original, hole, [0, 255, 0, 255]);
    const fitted = classic();
    paint(fitted, hole, CLEAR);
    const r = assessFrame({ fitted, layout: 'classic-border', source: SRC, original, keyColor: [0, 255, 0] });
    const i = (Math.floor(0.51 * H) * W + Math.floor(0.045 * W)) * 4;
    expect(Array.from(r.repaired!.data.slice(i, i + 4))).toEqual([212, 175, 55, 255]);
  });

  it('never "repairs" the design window itself, and without the original reports nothing', () => {
    const r = assessFrame({ fitted: scene(), layout: 'full-scene', source: SRC, original: canvas() });
    expect(r.repairedHoles).toBe(0);
    const fitted = classic();
    paint(fitted, hole, CLEAR);
    expect(assessFrame({ fitted, layout: 'classic-border', source: SRC }).repaired).toBeUndefined();
  });
});

describe('diagnoseFill', () => {
  it('tells art from black from a checkerboard', () => {
    expect(diagnoseFill(canvas(), { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 })).toBe('art');
    expect(diagnoseFill(canvas([5, 5, 5, 255]), { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 })).toBe('black');
    expect(diagnoseFill(canvas(CLEAR), { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 })).toBe('art');
  });
});

describe('retry policy', () => {
  it('retries once with the most severe correction, never twice', () => {
    const img = scene();
    paint(img, ellipse(0.5, 0.38, 0.08, 0.05), [224, 172, 140, 255]);
    const r = assessFrame({ fitted: img, layout: 'full-scene', source: SRC });
    expect(retryCorrection(r)).toMatch(/drew a face inside the opening/);
    expect(shouldAutoRetry(r, 0)).toBe(true);
    expect(shouldAutoRetry(r, 1)).toBe(false);
  });

  it('does not retry a clean result or a shape-only failure no prompt can fix', () => {
    const clean = assessFrame({ fitted: classic(), layout: 'classic-border', source: SRC });
    expect(retryCorrection(clean)).toBe(null);
    const square = assessFrame({ fitted: classic(), layout: 'classic-border', source: { width: 1024, height: 1024 } });
    expect(square.ok).toBe(false);
    expect(retryCorrection(square)).toBe(null);
    expect(shouldAutoRetry(square, 0)).toBe(false);
  });

  it('re-keying the same image is offered exactly once', () => {
    expect(rekeyOptions(0)).not.toBe(null);
    expect(rekeyOptions(1)).toBe(null);
  });
});

describe('prepareFrame — the one function both the worker and the fallback run', () => {
  const GREEN: Px = [0, 255, 0, 255];
  const greenClassic = () => {
    const img = canvas();
    const w = FRAME_GEOMETRY['classic-border'].windows[0];
    paint(img, rect(w.cx - w.rx, w.cy - w.ry, w.cx + w.rx, w.cy + w.ry), GREEN);
    return img;
  };
  const GS = { claimsTransparent: false, fromGreenScreen: true };

  it('keys, fits to 1080×1920 and passes a clean green-screen border', () => {
    const out = prepareFrame(greenClassic(), GS, { layout: 'classic-border' });
    expect(out.keyed).toBe(true);
    expect(out.alreadyTransparent).toBe(false);
    expect([out.image.width, out.image.height]).toEqual([1080, 1920]);
    expect(out.quality?.ok).toBe(true);
    expect(out.keyColor).not.toBeNull();
  });

  it('reports keyed:false when nothing green was there to key', () => {
    const out = prepareFrame(canvas(), GS, { layout: 'classic-border' });
    expect(out.keyed).toBe(false);
    expect(out.quality?.ok).toBe(false);
  });

  it('skips keying for a genuinely transparent source, but still gates it', () => {
    const out = prepareFrame(classic(), { claimsTransparent: true, fromGreenScreen: false }, { layout: 'classic-border' });
    expect(out.alreadyTransparent).toBe(true);
    expect(out.keyed).toBe(true);
    expect(out.quality?.ok).toBe(true);
  });

  it('runs no gate without a layout (stickers)', () => {
    expect(prepareFrame(greenClassic(), GS).quality).toBeNull();
  });
});

describe('takes — which one the host sees first, and when to retry', () => {
  const q = (ok: boolean, score: number, code: Parameters<typeof retryCorrection>[0]['reasons'][number]['code'] = 'face_in_window'): QualityResult => ({
    ok, score, repairedHoles: 0, reasons: ok ? [] : [{ code, severity: 'fail', message: '' }],
  });
  const t = (name: string, keyed: boolean, quality: QualityResult | null) => ({ name, keyed, quality });

  it('usable = keyed and not failed; a sticker (no gate) counts when keyed', () => {
    expect(takeUsable(t('a', true, q(true, 1)))).toBe(true);
    expect(takeUsable(t('b', true, q(false, 0.6)))).toBe(false);
    expect(takeUsable(t('c', false, null))).toBe(false);
    expect(takeUsable(t('d', true, null))).toBe(true);
  });

  it('ranks usable takes first, then by score, keeping ties in order', () => {
    const ranked = rankTakes([t('bad', true, q(false, 0.6)), t('ok2', true, q(true, 0.9)), t('ok1', true, q(true, 1)), t('ok3', true, q(true, 0.9))]);
    expect(ranked.map((x) => x.name)).toEqual(['ok1', 'ok2', 'ok3', 'bad']);
  });

  it('retries an unkeyed take with the unkeyed correction, a clean one never', () => {
    expect(autoRetryCode(t('x', false, null))).toBe('unkeyed');
    expect(autoRetryCode(t('y', true, q(false, 0.6, 'window_painted')))).toBe('window_painted');
    expect(autoRetryCode(t('z', true, q(true, 1)))).toBe(null);
    // A failure no sentence can fix is not worth a regeneration.
    expect(autoRetryCode(t('w', true, q(false, 0.6, 'aspect')))).toBe(null);
  });

  it('waiting copy moves on honestly with time', () => {
    const lines = [0, 20, 50, 100].map(paintingCopy);
    expect(new Set(lines).size).toBe(4);
    expect(paintingCopy(100)).toMatch(/two minutes/);
    for (const l of lines) expect(l).not.toMatch(/%|\d+ ?s\b/);
  });
});
