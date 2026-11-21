import { describe, expect, it } from 'vitest';
import { envelopeArtSvg, envelopeMaskSvg, envelopeOrnament, svgDataUrl, type OrnamentInput } from './cardRevealOrnament';
import { envelopeStage } from './cardReveal';

function inputFor(vw: number, vh: number): OrnamentInput {
  const e = envelopeStage(vw, vh);
  return { w: e.stage.w, h: e.stage.h, meet: e.meet, sealR: e.sealR };
}

/** Every number in an absolute-coordinate path, as (x, y) pairs. */
function points(d: string): [number, number][] {
  const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

const SIZES: [number, number][] = [
  [390, 844],
  [360, 640],
  [430, 932],
  [1440, 900],
];

describe('envelopeOrnament', () => {
  it('is deterministic (a replay draws the same paper)', () => {
    expect(envelopeOrnament(inputFor(390, 844))).toEqual(envelopeOrnament(inputFor(390, 844)));
  });

  for (const [vw, vh] of SIZES) {
    it(`stays on the paper and never emits NaN at ${vw}x${vh}`, () => {
      const inp = inputFor(vw, vh);
      const o = envelopeOrnament(inp);
      for (const d of [o.strokes, o.fills]) {
        expect(d).not.toMatch(/NaN|Infinity/);
        // only absolute move/line/quad/cubic/close commands
        expect(d).toMatch(/^[MLQCZ0-9 .\-]+$/);
        for (const [x, y] of points(d)) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(inp.w);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(inp.h);
        }
      }
      expect(o.seams).toHaveLength(4);
      for (const [, , x2, y2] of o.seams) expect([x2, y2]).toEqual([inp.meet.x, inp.meet.y]);
    });
  }

  it('is intricate but not a bloated page weight', () => {
    const o = envelopeOrnament(inputFor(390, 844));
    const marks = (o.strokes.match(/M/g) ?? []).length + (o.fills.match(/M/g) ?? []).length;
    expect(marks).toBeGreaterThan(300);
    const svg = envelopeArtSvg(o, 390, 844, '13, 10, 58');
    expect(svg.length).toBeLessThan(200_000);
  });
});

describe('the SVGs', () => {
  const o = envelopeOrnament(inputFor(390, 844));
  it('the art carries the grain + emboss filters and the shadow colour', () => {
    const svg = envelopeArtSvg(o, 390, 844, '13, 10, 58');
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844"')).toBe(true);
    expect(svg).toContain('feTurbulence');
    expect(svg).toContain('feSpecularLighting');
    expect(svg).toContain('rgb(13, 10, 58)');
  });
  it('the mask includes the seams and no filters', () => {
    const svg = envelopeMaskSvg(o, 390, 844);
    expect(svg).toContain('M0 0L195 422');
    expect(svg).not.toContain('filter');
  });
  it('data URLs are CSS-safe (no raw # or quotes)', () => {
    const url = svgDataUrl(envelopeArtSvg(o, 390, 844, '1, 2, 3'));
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    const body = url.slice(url.indexOf(',') + 1);
    expect(body).not.toMatch(/[#"'<>]/);
  });
});
