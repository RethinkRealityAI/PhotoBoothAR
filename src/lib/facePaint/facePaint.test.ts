/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FACE_POINTS, FACE_TRIANGLES, STANDARD_FACE_INDICES, STANDARD_FACE_UVS } from './faceTopology';
import { FACE_LANDMARKS, faceFrameFromUvs, frameUvFromNdc, mirrorPairs, outerRingDistance } from './features';
import {
  FACE_PAINT_DESIGNS, FACE_PAINT_DESIGN_IDS, FACE_PAINT_DESIGN_MAP, FACE_PAINT_CATEGORIES, categoryOf, defaultColorsFor, DEFAULT_THEME,
} from './designs';
import { logoSlots, paintFacePaint, drawFaceBase } from './painter';
import {
  facePaintKey, normalizeFacePaint, normalizeHex, isSafeLogoUrl, FACE_PAINT_OPACITY, MAX_FACE_PAINT_COLORS, type FacePaintSpec,
} from './spec';
import { hollyLeafPath, quadPts, ribbonPath, roundEnds, snowflakePath, softBlob, spiralPts, type PaintContext } from './shapes';

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

/**
 * A fake context that tracks the canvas transform (save/restore/translate/
 * rotate/scale) and records every point a path visits — curve controls and
 * arc/ellipse extents included — in TEXTURE px.
 */
function boundsCtx(): { ctx: PaintContext; pts: { x: number; y: number }[] } {
  const pts: { x: number; y: number }[] = [];
  let m = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  const mul = (a: number, b: number, c: number, d: number, e: number, f: number) => {
    const [A, B, C, D, E, F] = m;
    m = [A * a + C * b, B * a + D * b, A * c + C * d, B * c + D * d, A * e + C * f + E, B * e + D * f + F];
  };
  const rec = (x: number, y: number) => pts.push({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
  const extent = (x: number, y: number, r: number) => { rec(x - r, y); rec(x + r, y); rec(x, y - r); rec(x, y + r); };
  const ops: Record<string, (...a: number[]) => void> = {
    save: () => { stack.push([...m]); },
    restore: () => { m = stack.pop() ?? [1, 0, 0, 1, 0, 0]; },
    translate: (x, y) => mul(1, 0, 0, 1, x, y),
    rotate: (r) => mul(Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0),
    scale: (sx, sy) => mul(sx, 0, 0, sy, 0, 0),
    moveTo: (x, y) => rec(x, y),
    lineTo: (x, y) => rec(x, y),
    quadraticCurveTo: (cx, cy, x, y) => { rec(cx, cy); rec(x, y); },
    bezierCurveTo: (a, b, c, d, x, y) => { rec(a, b); rec(c, d); rec(x, y); },
    arc: (x, y, r) => extent(x, y, r),
    ellipse: (x, y, rx, ry) => extent(x, y, Math.max(rx, ry)),
    fillRect: (x, y, w, h) => { rec(x, y); rec(x + w, y + h); },
  };
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return ops[prop] ?? (() => {});
    },
    set(target, prop: string, value) { target[prop] = value; return true; },
  }) as unknown as PaintContext;
  return { ctx, pts };
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
  it('ships the briefed designs plus the Christmas set and the second party wave, each with 1-3 colour slots', () => {
    expect(FACE_PAINT_DESIGN_IDS).toEqual([
      'game-day', 'flag-cheeks', 'eye-black', 'glitter-freckles', 'hearts', 'stars', 'tiger', 'sugar-skull',
      'candy-cane', 'rudolph', 'snowflakes', 'frost-queen', 'gingerbread',
      'butterfly', 'hero-mask', 'rainbow', 'lightning-bolt', 'unicorn', 'cat', 'neon-tribal',
    ]);
    // The registry and the id list agree, in order.
    expect(FACE_PAINT_DESIGNS.map((d) => d.id)).toEqual([...FACE_PAINT_DESIGN_IDS]);
    for (const d of FACE_PAINT_DESIGNS) {
      expect(d.slots.length).toBeGreaterThanOrEqual(1);
      expect(d.slots.length).toBeLessThanOrEqual(MAX_FACE_PAINT_COLORS);
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.blurb.length).toBeGreaterThan(0);
    }
  });

  it('registry and id list agree one-to-one; names and slot labels are unique', () => {
    expect(FACE_PAINT_DESIGNS.map((d) => d.id)).toEqual([...FACE_PAINT_DESIGN_IDS]);
    expect(Object.keys(FACE_PAINT_DESIGN_MAP).sort()).toEqual([...FACE_PAINT_DESIGN_IDS].sort());
    expect(new Set(FACE_PAINT_DESIGNS.map((d) => d.name)).size).toBe(FACE_PAINT_DESIGNS.length);
    for (const d of FACE_PAINT_DESIGNS) {
      // Slot labels key the builder's colour rows.
      expect(new Set(d.slots.map((s) => s.label)).size, d.id).toBe(d.slots.length);
      // Every id survives the stored-spec gate, so a saved scene can hold it.
      expect(normalizeFacePaint({ design: d.id })?.design, d.id).toBe(d.id);
    }
  });

  it('puts every design on a known picker shelf; a design without a category lands on the default one', () => {
    const shelves = new Set<string>(FACE_PAINT_CATEGORIES.map((g) => g.id));
    for (const d of FACE_PAINT_DESIGNS) expect(shelves.has(categoryOf(d)), d.id).toBe(true);
    // The first eight carry no category (their registry rows are untouched) and sit on the first shelf.
    expect(FACE_PAINT_DESIGNS.filter((d) => categoryOf(d) === 'everyday').map((d) => d.id))
      .toEqual(['game-day', 'flag-cheeks', 'eye-black', 'glitter-freckles', 'hearts', 'stars', 'tiger', 'sugar-skull']);
    expect(FACE_PAINT_DESIGNS.filter((d) => categoryOf(d) === 'party').map((d) => d.id))
      .toEqual(['butterfly', 'hero-mask', 'rainbow', 'lightning-bolt', 'unicorn', 'cat', 'neon-tribal']);
    expect(categoryOf({})).toBe(FACE_PAINT_CATEGORIES[0].id);
  });

  it('the twinkle is opt-in per design and OFF for every design that shipped before it', () => {
    // Saved scenes using the first eight must render exactly as they did.
    for (const id of ['game-day', 'flag-cheeks', 'eye-black', 'glitter-freckles', 'hearts', 'stars', 'tiger', 'sugar-skull']) {
      expect(FACE_PAINT_DESIGN_MAP[id].shimmer, id).toBeUndefined();
    }
    expect(FACE_PAINT_DESIGN_MAP.unicorn.shimmer).toBe(true);
    expect(FACE_PAINT_DESIGN_MAP['neon-tribal'].shimmer).toBe(true);
    // A registry property, never a stored field: the jsonb gate does not carry it.
    expect(normalizeFacePaint({ design: 'unicorn', shimmer: true })).toEqual({ design: 'unicorn', colors: [], opacity: FACE_PAINT_OPACITY.default });
  });

  it('defaults every design to valid lowercase hex, one per slot', () => {
    for (const d of FACE_PAINT_DESIGNS) {
      const cols = defaultColorsFor(d.id);
      expect(cols, d.id).toHaveLength(d.slots.length);
      for (const col of cols) expect(normalizeHex(col), d.id).toBe(col);
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

const CHRISTMAS = ['candy-cane', 'rudolph', 'snowflakes', 'frost-queen', 'gingerbread'] as const;

describe('the Christmas set', () => {
  afterEach(() => vi.restoreAllMocks());

  it('defaults to fixed festive colours, whatever the event theme', () => {
    const theme = { accent: '#112233', accent2: '#445566', accent3: '#778899' };
    for (const id of CHRISTMAS) {
      const d = FACE_PAINT_DESIGNS.find((x) => x.id === id)!;
      for (const slot of d.slots) expect(slot.source, `${id} ${slot.label}`).toMatch(/^#[0-9a-f]{6}$/);
      expect(defaultColorsFor(id, theme)).toEqual(defaultColorsFor(id));
    }
    expect(defaultColorsFor('candy-cane')).toEqual(['#d4141f', '#fbf8f3']);
    expect(defaultColorsFor('rudolph')[0]).toBe('#d0101c');
  });

  it('only the gingerbread covers the whole face', () => {
    const full = CHRISTMAS.filter((id) => FACE_PAINT_DESIGNS.find((d) => d.id === id)!.fullFace === true);
    expect(full).toEqual(['gingerbread']);
  });

  it.each(CHRISTMAS)('%s paints with every colour it was given', (id) => {
    const d = FACE_PAINT_DESIGNS.find((x) => x.id === id)!;
    const picks = ['#010203', '#040506', '#070809'].slice(0, d.slots.length);
    const { ctx, calls } = fakeCtx();
    paintFacePaint(ctx, frame, spec(id, { colors: picks }));
    const used = new Set(calls.filter((c) => c.op === '=fillStyle' || c.op === '=strokeStyle').map((c) => c.args[0]));
    for (const col of picks) expect(used.has(col), `${id} ${col}`).toBe(true);
  });

  it.each(CHRISTMAS)('%s paints the same calls at any texture size, scaled (layout follows the features)', (id) => {
    const at = (size: number) => {
      const { ctx, calls } = fakeCtx();
      paintFacePaint(ctx, faceFrameFromUvs(STANDARD_FACE_UVS, size), spec(id), { grain: false });
      return calls;
    };
    const a = at(512);
    const b = at(1024);
    expect(b.map((c) => c.op)).toEqual(a.map((c) => c.op));
    // Every placement (translate) lands inside the texture.
    for (const c of b.filter((x) => x.op === 'translate' || x.op === 'moveTo')) {
      const [x, y] = c.args as number[];
      if (c.op === 'translate' && Math.abs(x) < 64 && Math.abs(y) < 64) continue; // a nudge inside a save/restore, not a placement
      expect(x).toBeGreaterThan(-0.05 * 1024);
      expect(x).toBeLessThan(1.05 * 1024);
      expect(y).toBeGreaterThan(-0.05 * 1024);
      expect(y).toBeLessThan(1.05 * 1024);
    }
  });

  it('the candy canes, frost swirls and Rudolph cheeks are mirror images left/right', () => {
    // Paint each design and check its centroid of moveTo points sits on the midline
    // (asymmetric designs — snowflakes, the gingerbread mint — are excluded on purpose).
    for (const id of ['candy-cane', 'frost-queen', 'rudolph'] as const) {
      const { ctx, calls } = fakeCtx();
      paintFacePaint(ctx, frame, spec(id), { grain: false });
      const xs = calls.filter((c) => c.op === 'translate' || c.op === 'moveTo' || c.op === 'arc' || c.op === 'ellipse')
        .map((c) => (c.args as number[])[0])
        .filter((x) => Math.abs(x) > 64);
      const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
      expect(Math.abs(mean - frame.noseTip.x), id).toBeLessThan(SIZE * 0.06);
    }
  });
});

describe('Christmas shape helpers', () => {
  it('snowflakePath draws six arms with paired twigs', () => {
    const { ctx, calls } = fakeCtx();
    snowflakePath(ctx, 10, 2);
    // Each arm: one spine + 2 branches × 2 twigs = 5 segments.
    expect(calls.filter((c) => c.op === 'moveTo')).toHaveLength(6 * 5);
    expect(calls.filter((c) => c.op === 'lineTo')).toHaveLength(6 * 5);
    // Arm 0 points straight up, to radius 10.
    const firstTip = calls.find((c) => c.op === 'lineTo')!.args as number[];
    expect(firstTip[0]).toBeCloseTo(0, 6);
    expect(firstTip[1]).toBeCloseTo(-10, 6);
  });

  it('ribbonPath walks out one edge and back the other; roundEnds closes the tips', () => {
    const pts = quadPts({ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, 20);
    expect(pts).toHaveLength(21);
    const { ctx, calls } = fakeCtx();
    ribbonPath(ctx, pts, roundEnds(10));
    expect(calls.filter((c) => c.op === 'lineTo')).toHaveLength(2 * 21 - 1);
    expect(calls.at(-1)!.op).toBe('closePath');
    const prof = roundEnds(10);
    expect(prof(0, 0, 100)).toBe(0);
    expect(prof(0.5, 50, 100)).toBe(10);
    expect(prof(1, 100, 100)).toBe(0);
  });

  it('spiralPts winds inward at constant angular steps', () => {
    const s = spiralPts({ x: 0, y: 0 }, 10, 2, 0, 1, 1, 8);
    expect(s[0]).toEqual({ x: 10, y: 0 });
    expect(Math.hypot(s[8].x, s[8].y)).toBeCloseTo(2, 6);
  });

  it('hollyLeafPath runs tip to tip along x', () => {
    const { ctx, calls } = fakeCtx();
    hollyLeafPath(ctx, 20, 8, 4);
    expect(calls[1]).toEqual({ op: 'moveTo', args: [-20, 0] });
    const ends = calls.filter((c) => c.op === 'quadraticCurveTo').map((c) => (c.args as number[]).slice(2));
    expect(ends).toHaveLength(2 * 5);
    expect(ends[4][0]).toBeCloseTo(20, 6);
    expect(ends[9][0]).toBeCloseTo(-20, 6);
  });

  it('softBlob restores the context it changed', () => {
    const { ctx, calls } = fakeCtx();
    softBlob(ctx, { x: 5, y: 5 }, 4, 3, '#ff0000', 0.5, 4);
    expect(calls[0].op).toBe('save');
    expect(calls.at(-1)!.op).toBe('restore');
    expect(calls.filter((c) => c.op === 'fill')).toHaveLength(4);
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

  it.each(FACE_PAINT_DESIGN_IDS)('%s keeps every drawn point inside the texture (transform-aware)', (id) => {
    const { ctx, pts } = boundsCtx();
    paintFacePaint(ctx, frame, spec(id), { grain: false });
    expect(pts.length).toBeGreaterThan(4);
    const lo = -0.01 * SIZE, hi = 1.01 * SIZE;
    const out = pts.filter((p) => !(p.x >= lo && p.x <= hi && p.y >= lo && p.y <= hi));
    expect(out, `${id}: ${JSON.stringify(out.slice(0, 3))}`).toEqual([]);
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
