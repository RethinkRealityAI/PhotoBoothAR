/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FACE_POINTS, FACE_TRIANGLES, STANDARD_FACE_INDICES, STANDARD_FACE_UVS } from './faceTopology';
import { FACE_LANDMARKS, faceFrameFromUvs, frameUvFromNdc, mirrorPairs, outerRingDistance } from './features';
import { FACE_PAINT_DESIGNS, FACE_PAINT_DESIGN_IDS, defaultColorsFor, DEFAULT_THEME } from './designs';
import { logoSlots, paintFacePaint, drawFaceBase } from './painter';
import { facePaintKey, normalizeFacePaint, isSafeLogoUrl, FACE_PAINT_OPACITY, type FacePaintSpec } from './spec';
import type { PaintContext } from './shapes';

/** A recorded-calls stand-in for CanvasRenderingContext2D. */
interface Call { op: string; args: unknown[] }
function fakeCtx(): { ctx: PaintContext; calls: Call[] } {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return (...args: unknown[]) => { calls.push({ op: prop, args }); };
    },
    set(target, prop: string, value) {
      target[prop] = value;
      calls.push({ op: `=${prop}`, args: [value] });
      return true;
    },
  }) as unknown as PaintContext;
  return { ctx, calls };
}

const SIZE = 1024;
const frame = faceFrameFromUvs(STANDARD_FACE_UVS, SIZE);
const spec = (design: string, extra: Partial<FacePaintSpec> = {}): FacePaintSpec => ({
  design, colors: defaultColorsFor(design), opacity: 0.88, ...extra,
});

describe('the captured 8th Wall topology', () => {
  it('has 478 points, 852 triangles, indices in range, iris points unused', () => {
    expect(FACE_POINTS).toBe(478);
    expect(FACE_TRIANGLES).toBe(852);
    expect(STANDARD_FACE_UVS).toHaveLength(FACE_POINTS * 2);
    expect(STANDARD_FACE_INDICES).toHaveLength(FACE_TRIANGLES * 3);
    expect(Math.max(...STANDARD_FACE_INDICES)).toBe(467);
    for (let i = 468; i < 478; i++) expect(STANDARD_FACE_INDICES).not.toContain(i);
  });

  it('puts the MediaPipe landmarks where the brief says they are', () => {
    const uv = (i: number) => ({ u: STANDARD_FACE_UVS[i * 2], v: STANDARD_FACE_UVS[i * 2 + 1] });
    // v points UP: forehead top above the nose above the chin.
    expect(uv(10).v).toBeGreaterThan(uv(1).v);
    expect(uv(1).v).toBeGreaterThan(uv(152).v);
    // Midline landmarks sit on u = 0.5.
    for (const i of [10, 152, 1, 4]) expect(uv(i).u).toBeCloseTo(0.5, 2);
    // Paired landmarks are mirror images about u = 0.5, eye corners above cheeks above mouth.
    for (const [a, b] of [[50, 280], [61, 291], [33, 263]]) {
      expect(uv(a).u + uv(b).u).toBeCloseTo(1, 2);
      expect(uv(a).v).toBeCloseTo(uv(b).v, 2);
      expect(uv(a).u).toBeLessThan(0.5);
    }
    expect(uv(33).v).toBeGreaterThan(uv(50).v);
    expect(uv(50).v).toBeGreaterThan(uv(61).v);
  });

  it('mirrorPairs is an exact involution that keeps every pair on the mirrored uv', () => {
    const pair = mirrorPairs(STANDARD_FACE_UVS, STANDARD_FACE_INDICES, FACE_POINTS);
    let self = 0;
    for (let i = 0; i < FACE_POINTS; i++) {
      expect(pair[pair[i]]).toBe(i);
      if (pair[i] === i) self++;
      if (i < 468) {
        expect(Math.abs(STANDARD_FACE_UVS[pair[i] * 2] - (1 - STANDARD_FACE_UVS[i * 2]))).toBeLessThan(0.005);
      }
    }
    // Landmark pairs from the brief.
    expect(pair[33]).toBe(263);
    expect(pair[61]).toBe(291);
    expect(pair[10]).toBe(10);
    // Midline (28 on the capture) + the 10 unused iris points.
    expect(self).toBe(28 + 10);
  });

  it('faceFrameFromUvs maps landmarks into canvas px with y down', () => {
    expect(frame.foreheadTop.y).toBeLessThan(frame.chin.y);
    expect(frame.eyeOuterL.x).toBeLessThan(frame.eyeOuterR.x);
    expect(frame.eyeSpan).toBeGreaterThan(SIZE * 0.4);
    expect(Object.keys(FACE_LANDMARKS).every((k) => k in frame)).toBe(true);
  });
});

describe('the design registry', () => {
  it('ships the eight briefed designs, each with 1-3 colour slots', () => {
    expect(FACE_PAINT_DESIGN_IDS).toEqual([
      'game-day', 'flag-cheeks', 'eye-black', 'glitter-freckles', 'hearts', 'stars', 'tiger', 'sugar-skull',
    ]);
    for (const d of FACE_PAINT_DESIGNS) {
      expect(d.slots.length).toBeGreaterThanOrEqual(1);
      expect(d.slots.length).toBeLessThanOrEqual(3);
      expect(d.name.length).toBeGreaterThan(0);
    }
  });

  it('defaults colours from the event theme', () => {
    const theme = { accent: '#112233', accent2: '#445566', accent3: '#778899' };
    expect(defaultColorsFor('game-day', theme)).toEqual(['#112233', '#ffffff']);
    expect(defaultColorsFor('flag-cheeks', theme)).toEqual(['#112233', '#ffffff', '#778899']);
    expect(defaultColorsFor('nope', theme)).toEqual([]);
    expect(defaultColorsFor('game-day')[0]).toBe(DEFAULT_THEME.accent);
  });
});

describe('paintFacePaint', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(FACE_PAINT_DESIGN_IDS)('%s paints deterministically, inside the texture, without Math.random', (id) => {
    const rand = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Math.random in a design'); });
    const a = fakeCtx();
    const b = fakeCtx();
    expect(paintFacePaint(a.ctx, frame, spec(id))).toBe(true);
    paintFacePaint(b.ctx, frame, spec(id));
    expect(rand).not.toHaveBeenCalled();
    expect(JSON.stringify(a.calls)).toBe(JSON.stringify(b.calls));
    // Clears first, then really draws.
    expect(a.calls[0].op).toBe('clearRect');
    expect(a.calls.filter((c) => c.op === 'fill' || c.op === 'stroke').length).toBeGreaterThan(1);
  });

  it('paints with the colours it was given', () => {
    const { ctx, calls } = fakeCtx();
    paintFacePaint(ctx, frame, spec('game-day', { colors: ['#ff0000', '#00ff00'] }));
    const strokes = calls.filter((c) => c.op === '=strokeStyle').map((c) => c.args[0]);
    expect(strokes).toContain('#ff0000');
    expect(strokes).toContain('#00ff00');
  });

  it('an unknown design draws nothing (a newer config on an older client)', () => {
    const { ctx, calls } = fakeCtx();
    expect(paintFacePaint(ctx, frame, spec('from-the-future'))).toBe(false);
    expect(calls.map((c) => c.op)).toEqual(['clearRect']);
  });

  it('stamps the logo upright and un-flipped, aspect kept, on the requested cheek', () => {
    const logo = { image: {} as CanvasImageSource, width: 300, height: 150 };
    const { ctx, calls } = fakeCtx();
    paintFacePaint(ctx, frame, spec('none', { logo: { url: 'https://x/l.png', placement: 'leftCheek', size: 1 } }), { logo });
    const draws = calls.filter((c) => c.op === 'drawImage');
    expect(draws).toHaveLength(1);
    const [, x, y, w, h] = draws[0].args as number[];
    expect(w).toBeGreaterThan(0); // positive width = never mirrored
    expect(h).toBeGreaterThan(0);
    expect(w / h).toBeCloseTo(2, 5);
    // No reflection anywhere in the stream.
    expect(calls.some((c) => c.op === 'scale' && (c.args[0] as number) < 0)).toBe(false);
    // Centred on the screen-left cheek.
    const cx = x + w / 2;
    expect(cx).toBeLessThan(SIZE / 2);
    expect(Math.abs(cx - logoSlots(frame, 'leftCheek')[0].at.x)).toBeLessThan(1e-6);
    expect(y + h / 2).toBeGreaterThan(frame.eyeOuterL.y);
  });

  it('both cheeks = two stamps; size scales the width; forehead is above the brows', () => {
    const logo = { image: {} as CanvasImageSource, width: 100, height: 100 };
    const both = fakeCtx();
    paintFacePaint(both.ctx, frame, spec('none', { logo: { url: 'https://x', placement: 'bothCheeks', size: 1 } }), { logo });
    expect(both.calls.filter((c) => c.op === 'drawImage')).toHaveLength(2);

    const w = (size: number) => {
      const r = fakeCtx();
      paintFacePaint(r.ctx, frame, spec('none', { logo: { url: 'https://x', placement: 'rightCheek', size } }), { logo });
      return (r.calls.find((c) => c.op === 'drawImage')!.args as number[])[3];
    };
    expect(w(1.5) / w(1)).toBeCloseTo(1.5, 5);

    const fh = logoSlots(frame, 'forehead')[0].at;
    expect(fh.y).toBeLessThan(frame.browMid.y);
  });

  it('skips a logo whose image is not decoded yet', () => {
    const { ctx, calls } = fakeCtx();
    expect(paintFacePaint(ctx, frame, spec('none', { logo: { url: 'https://x', placement: 'forehead', size: 1 } }), { logo: null })).toBe(false);
    expect(calls.some((c) => c.op === 'drawImage')).toBe(false);
  });

  it('drawFaceBase fills every triangle once', () => {
    const { ctx, calls } = fakeCtx();
    drawFaceBase(ctx, STANDARD_FACE_UVS, STANDARD_FACE_INDICES, 256);
    expect(calls.filter((c) => c.op === 'closePath')).toHaveLength(FACE_TRIANGLES);
    expect(calls.filter((c) => c.op === 'fill')).toHaveLength(1);
  });
});

describe('normalizeFacePaint (untrusted jsonb)', () => {
  it('keeps a valid spec and normalizes colours', () => {
    expect(normalizeFacePaint({ design: 'tiger', colors: ['#F80', '#000000', 'red', '#fff', '#123456'], opacity: 0.9 }))
      .toEqual({ design: 'tiger', colors: ['#ff8800', '#000000', '#ffffff'], opacity: 0.9 });
  });

  it('clamps opacity and logo size, defaults a bad placement', () => {
    const n = normalizeFacePaint({ design: 'hearts', colors: [], opacity: 7, logo: { url: 'https://cdn/x.png', placement: 'nose', size: 99 } })!;
    expect(n.opacity).toBe(FACE_PAINT_OPACITY.max);
    expect(n.logo).toEqual({ url: 'https://cdn/x.png', placement: 'leftCheek', size: 1.6 });
  });

  it('refuses unsafe logo urls and empty looks', () => {
    for (const url of ['javascript:alert(1)', 'data:image/png;base64,AAA', 'blob:https://x/1', 'http://x/a.png', '/rel.png', 42]) {
      expect(isSafeLogoUrl(url)).toBe(false);
      expect(normalizeFacePaint({ design: 'none', logo: { url, placement: 'forehead', size: 1 } })).toBeNull();
    }
    expect(normalizeFacePaint(null)).toBeNull();
    expect(normalizeFacePaint([])).toBeNull();
    expect(normalizeFacePaint({ design: 'BAD ID!' })).toBeNull();
  });

  it('keeps an unknown-but-well-formed design (the registry decides at paint time)', () => {
    expect(normalizeFacePaint({ design: 'future-look' })?.design).toBe('future-look');
  });

  it('facePaintKey changes with every visible field', () => {
    const base = normalizeFacePaint({ design: 'stars', colors: ['#111111'], opacity: 0.8 })!;
    const k = facePaintKey(base);
    expect(facePaintKey({ ...base, opacity: 0.81 })).not.toBe(k);
    expect(facePaintKey({ ...base, colors: ['#111112'] })).not.toBe(k);
    expect(facePaintKey({ ...base, logo: { url: 'https://x', placement: 'forehead', size: 1 } })).not.toBe(k);
    expect(facePaintKey(null)).toBe('');
  });
});

describe('skin blending helpers', () => {
  it('feathers only the OUTER silhouette — eyes and mouth stay solid', () => {
    const d = outerRingDistance(STANDARD_FACE_INDICES, FACE_POINTS, 4);
    // The hairline/temple/jaw silhouette is ring 0 …
    expect(d[FACE_LANDMARKS.foreheadTop]).toBe(0);
    expect(d[FACE_LANDMARKS.chin]).toBe(0);
    // … while the eye corners and mouth corners (holes, not silhouette) are
    // deep inside the face, never faded.
    for (const k of ['eyeInnerL', 'eyeInnerR', 'eyeTopL', 'mouthL', 'mouthR', 'noseTip'] as const) {
      expect(d[FACE_LANDMARKS[k]], k).toBe(4);
    }
    // Rings are monotone steps: every vertex differs from a neighbour by ≤ 1.
    const I = STANDARD_FACE_INDICES;
    for (let k = 0; k < I.length; k += 3) {
      const t = [d[I[k]], d[I[k + 1]], d[I[k + 2]]];
      expect(Math.max(...t) - Math.min(...t)).toBeLessThanOrEqual(1);
    }
    // A real band, not the whole face: most vertices are fully opaque.
    let solid = 0;
    for (let i = 0; i < 468; i++) if (d[i] === 4) solid++;
    expect(solid / 468).toBeGreaterThan(0.6);
  });

  it('maps canvas NDC to the camera frame under the rig contract, mirror-aware', () => {
    expect(frameUvFromNdc(0, 0, 9 / 16, 9 / 16, true)).toEqual({ u: 0.5, v: 0.5 });
    // Same aspect: a point on the right of a mirrored canvas came from the LEFT of the frame.
    expect(frameUvFromNdc(1, 1, 0.5625, 0.5625, true)).toEqual({ u: 0, v: 1 });
    expect(frameUvFromNdc(1, -1, 0.5625, 0.5625, false)).toEqual({ u: 1, v: 0 });
    // A canvas narrower than the frame (cover crop) sees only the middle of it.
    expect(frameUvFromNdc(1, 0, 0.5, 1, false).u).toBeCloseTo(0.75);
  });
});
