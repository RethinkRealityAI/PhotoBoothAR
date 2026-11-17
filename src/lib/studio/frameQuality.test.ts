import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import {
  FAINT_SOLID_MIN,
  retryCorrectionCode,
  solidShare,
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

/* ── Faint ("ghost") frames — the live 2026-11-17 art-deco take ─────────────
 * Its border was full width but almost entirely translucent: of the pixels
 * that showed, 72% sat at alpha 1–31, 19% at 32–63, 8% at 64–95, ~1% solid —
 * and the old gate passed it (`ok:true, codes:['border_thin'], score 0.9`)
 * because a mask cell under alpha 64 counts as clear, so a ghost border reads
 * as "thin", a warning. Synthesised here with that measured distribution. */
const NAVY: [number, number, number] = [32, 32, 64];
function ghostClassic(): RgbaImage {
  const img = classic();
  const w = FRAME_GEOMETRY['classic-border'].windows[0];
  const inWindow = rect(w.cx - w.rx, w.cy - w.ry, w.cx + w.rx, w.cy + w.ry);
  paint(img, (fx, fy) => !inWindow(fx, fy), (x, y) => {
    const k = (x * 7 + y * 13) % 100;
    const a = k < 72 ? 6 + ((x + y) % 26) : k < 91 ? 32 + (x % 32) : k < 99 ? 64 + (y % 32) : 255;
    return [...NAVY, a];
  });
  return img;
}

/** Minimal 8-bit RGBA, non-interlaced PNG decoder (node:zlib only) — enough
 *  for the shipped guide frames, all colour type 6. */
function decodePng(buf: Buffer): RgbaImage {
  const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20);
  if (buf[24] !== 8 || buf[25] !== 6 || buf[28] !== 0) throw new Error('unsupported png');
  const idat: Buffer[] = [];
  for (let p = 8; p < buf.length;) {
    const len = buf.readUInt32BE(p);
    if (buf.toString('ascii', p + 4, p + 8) === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = new Uint8ClampedArray(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    for (let i = 0; i < stride; i++) {
      const left = i >= 4 ? out[y * stride + i - 4] : 0;
      const up = y > 0 ? out[(y - 1) * stride + i] : 0;
      const ul = y > 0 && i >= 4 ? out[(y - 1) * stride + i - 4] : 0;
      let pred = 0;
      if (f === 1) pred = left;
      else if (f === 2) pred = up;
      else if (f === 3) pred = (left + up) >> 1;
      else if (f === 4) {
        const pa = Math.abs(up - ul), pb = Math.abs(left - ul), pc = Math.abs(left + up - 2 * ul);
        pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
      }
      out[y * stride + i] = (raw[src + i] + pred) & 255;
    }
  }
  return { data: out, width, height };
}

describe('faint art (ghost frame)', () => {
  it('reproduces: the old checks alone saw only a thin border — now it FAILS as faint_art', () => {
    const r = assessFrame({ fitted: ghostClassic(), layout: 'classic-border', source: { width: 768, height: 1344 } });
    expect(solidShare(ghostClassic())).toBeLessThan(0.05);
    expect(codes(r)).toContain('border_thin');
    expect(r.reasons.find((x) => x.code === 'faint_art')?.severity).toBe('fail');
    expect(r.ok).toBe(false);
  });

  it('a faint take goes down the free auto-retry with the flat-green correction', () => {
    const r = assessFrame({ fitted: ghostClassic(), layout: 'classic-border', source: { width: 768, height: 1344 } });
    expect(retryCorrectionCode(r)).toBe('unkeyed');
    expect(shouldAutoRetry(r, 0)).toBe(true);
    expect(autoRetryCode({ keyed: true, quality: r })).toBe('unkeyed');
    expect(takeUsable({ keyed: true, quality: r })).toBe(false);
  });

  it('a solid border is untouched by the check', () => {
    expect(codes(assessFrame({ fitted: classic(), layout: 'classic-border', source: { width: 768, height: 1344 } }))).not.toContain('faint_art');
  });

  it('end to end: dark art on the model’s sage backdrop now keys SOLID (keyer guard) and passes', () => {
    // The live raw: backdrop (108,161,85), border art navy / black / gold.
    const raw = canvas([108, 161, 85, 255]);
    const w = FRAME_GEOMETRY['classic-border'].windows[0];
    const inWindow = rect(w.cx - w.rx, w.cy - w.ry, w.cx + w.rx, w.cy + w.ry);
    const ART: Px[] = [[32, 32, 64, 255], [20, 20, 24, 255], [160, 128, 64, 255]];
    paint(raw, (fx, fy) => !inWindow(fx, fy), (x, y) => ART[(Math.floor(x / 9) + Math.floor(y / 9)) % 3]);
    const p = prepareFrame(raw, { claimsTransparent: false, fromGreenScreen: true }, { layout: 'classic-border' });
    expect(p.keyed).toBe(true);
    expect(solidShare(p.image)).toBeGreaterThan(0.9);
    expect(codes(p.quality!)).not.toContain('faint_art');
    expect(p.quality!.ok).toBe(true);
  });

  it('no shipped guide frame regresses (all 14 measured 0.929–1.000 solid)', () => {
    const dir = new URL('../../../public/guides/frames/', import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith('.png'));
    expect(files.length).toBe(14);
    for (const f of files) {
      const img = decodePng(readFileSync(new URL(f, dir)));
      const share = solidShare(img);
      expect(share, f).toBeGreaterThanOrEqual(0.9);
      expect(share, f).toBeGreaterThan(FAINT_SOLID_MIN);
    }
  });
});
