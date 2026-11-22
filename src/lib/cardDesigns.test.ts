import { describe, expect, it } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CARD_DESIGNS,
  CARD_DESIGN_IDS,
  cardDesign,
  designAssets,
  designCssVars,
  irisPath,
  isCardDesignId,
  normalizeCardDesign,
  sceneFrame,
  sceneParallax,
  SCENE_OPEN_MS,
  SCENE_OPEN_MS_REDUCED,
  type GatewayKind,
  type IrisShape,
} from './cardDesigns';

const KINDS: GatewayKind[] = ['doors', 'iris', 'slide', 'rise'];
const HEX = /^#[0-9A-F]{6}$/i;

describe('the design library', () => {
  it('has one definition per id, in the gallery order, with no strays', () => {
    expect(CARD_DESIGNS.map((d) => d.id).sort()).toEqual([...CARD_DESIGN_IDS].sort());
    expect(new Set(CARD_DESIGN_IDS).size).toBe(CARD_DESIGN_IDS.length);
    for (const id of CARD_DESIGN_IDS) expect(cardDesign(id).id).toBe(id);
  });

  it('gives every design host copy, a valid palette and a real motif', () => {
    for (const d of CARD_DESIGNS) {
      expect(d.label.length).toBeGreaterThan(2);
      expect(d.description.length).toBeGreaterThan(20);
      expect(d.goodFor.length).toBeGreaterThan(3);
      for (const c of [d.palette.bg, d.palette.fg, d.palette.accent, d.palette.glow]) expect(c).toMatch(HEX);
      expect(d.palette.accentRgb).toMatch(/^\d{1,3}, \d{1,3}, \d{1,3}$/);
      expect(d.motif.colors.length).toBeGreaterThan(0);
      for (const c of d.motif.colors) expect(c).toMatch(HEX);
      expect(d.mid.size).toBeGreaterThan(0.2);
      expect(d.mid.size).toBeLessThan(0.7);
      if (d.gateway.kind === 'iris') expect(d.gateway.shape).toBeDefined();
    }
  });

  it('uses every gateway kind at least once (each code path ships with art)', () => {
    const used = new Set(CARD_DESIGNS.map((d) => d.gateway.kind));
    for (const k of KINDS) expect(used.has(k)).toBe(true);
  });

  it('ships every asset it names, and keeps each design light', () => {
    for (const id of CARD_DESIGN_IDS) {
      const a = designAssets(id);
      let total = 0;
      for (const url of [a.gate, a.back, a.mid, a.thumb]) {
        const file = resolve(__dirname, '../../public', url.replace(/^\//, ''));
        expect(existsSync(file), `${id}: missing ${url}`).toBe(true);
        total += statSync(file).size;
      }
      // A phone downloads one design per card: keep it under ~650 KB.
      expect(total, `${id} weighs ${total} bytes`).toBeLessThan(650_000);
    }
  });

  it('normalises anything to a known design or none', () => {
    expect(normalizeCardDesign('garden-gate')).toBe('garden-gate');
    for (const junk of [undefined, null, '', 'GARDEN-GATE', 'nope', 42, {}, ['owambe']]) {
      expect(normalizeCardDesign(junk)).toBe('none');
    }
    expect(isCardDesignId('none')).toBe(false);
  });

  it('paints the semantic tokens the card templates read', () => {
    const vars = designCssVars(cardDesign('gala-night'));
    expect(vars['--color-accent']).toBe('#E8C77A');
    expect(vars['--accent-rgb']).toBe('232, 199, 122');
    expect(Object.keys(vars)).toEqual(
      expect.arrayContaining(['--color-brand-bg', '--color-brand-fg', '--color-accent', '--accent-rgb']),
    );
    // …and the brand v2 glass tokens, so the card's veil and rim follow the scene.
    expect(vars['--pf-accent-rgb']).toBe('232, 199, 122');
    expect(vars['--pf-veil']).toBe('rgba(17, 23, 51, 0.46)');
  });
});

describe('sceneFrame — the opening timeline', () => {
  it('starts on the closed gateway and ends on the open scene with the plate settled', () => {
    for (const k of KINDS) {
      const a = sceneFrame(k, 0);
      expect(a).toMatchObject({ doorDeg: 0, slidePct: 0, irisR: 0, risePct: 0, gateOpacity: 1, plateOpacity: 0 });
      expect(a.backScale).toBeGreaterThan(1);
      const z = sceneFrame(k, 1);
      expect(z).toMatchObject({ gateOpacity: 0, backScale: 1, midScale: 1, midY: 0, plateOpacity: 1, plateY: 0, plateScale: 1 });
      expect(z.glow).toBe(0);
    }
  });

  it('only moves the parts that belong to the gateway kind', () => {
    const mid = 0.4;
    expect(sceneFrame('doors', mid)).toMatchObject({ slidePct: 0, irisR: 0, risePct: 0 });
    expect(sceneFrame('slide', mid)).toMatchObject({ doorDeg: 0, irisR: 0, risePct: 0 });
    expect(sceneFrame('iris', mid)).toMatchObject({ doorDeg: 0, slidePct: 0, risePct: 0 });
    expect(sceneFrame('rise', mid)).toMatchObject({ doorDeg: 0, slidePct: 0, irisR: 0 });
  });

  it('is monotonic where it should be: the gateway only ever opens', () => {
    for (const k of KINDS) {
      let prev = sceneFrame(k, 0);
      for (let i = 1; i <= 100; i++) {
        const f = sceneFrame(k, i / 100);
        expect(f.doorDeg).toBeGreaterThanOrEqual(prev.doorDeg);
        expect(f.slidePct).toBeGreaterThanOrEqual(prev.slidePct);
        expect(f.irisR).toBeGreaterThanOrEqual(prev.irisR);
        expect(f.risePct).toBeGreaterThanOrEqual(prev.risePct);
        expect(f.backScale).toBeLessThanOrEqual(prev.backScale);
        expect(f.plateOpacity).toBeGreaterThanOrEqual(prev.plateOpacity);
        prev = f;
      }
    }
  });

  it('lets the light peak while the gateway is opening, not after', () => {
    const peak = Array.from({ length: 101 }, (_, i) => [i / 100, sceneFrame('doors', i / 100).glow] as const).reduce(
      (a, b) => (b[1] > a[1] ? b : a),
    );
    expect(peak[0]).toBeGreaterThan(0.2);
    expect(peak[0]).toBeLessThan(0.4);
    expect(peak[1]).toBeGreaterThan(0.9);
  });

  it('is deterministic and total (same t → same frame; junk t settles)', () => {
    expect(sceneFrame('iris', 0.37)).toEqual(sceneFrame('iris', 0.37));
    expect(sceneFrame('doors', Number.NaN)).toEqual(sceneFrame('doors', 1));
    expect(sceneFrame('doors', Infinity)).toEqual(sceneFrame('doors', 1));
    expect(sceneFrame('doors', -3)).toEqual(sceneFrame('doors', 0));
    expect(sceneFrame('doors', 7)).toEqual(sceneFrame('doors', 1));
  });

  it('keeps every beat under reduced motion, with less travel', () => {
    const full = sceneFrame('doors', 0);
    const calm = sceneFrame('doors', 0, true);
    expect(calm.backScale).toBeLessThan(full.backScale);
    expect(calm.midScale).toBeLessThan(full.midScale);
    expect(sceneFrame('doors', 0.6, true).gateScale).toBe(1); // no push through
    expect(sceneFrame('doors', 1, true).plateOpacity).toBe(1); // the moment still lands
    expect(SCENE_OPEN_MS_REDUCED).toBeLessThan(SCENE_OPEN_MS);
    // Reveal contract: 2.5 to 6 s after the tap.
    for (const ms of [SCENE_OPEN_MS, SCENE_OPEN_MS_REDUCED]) {
      expect(ms).toBeGreaterThanOrEqual(2500);
      expect(ms).toBeLessThanOrEqual(6000);
    }
  });
});

describe('sceneParallax', () => {
  it('moves the closer layer further than the scene behind it', () => {
    const o = sceneParallax(1, 1, 1);
    expect(Math.abs(o.midY)).toBeGreaterThan(Math.abs(o.backY));
    expect(Math.abs(o.midX)).toBeGreaterThan(Math.abs(o.backX));
  });

  it('rests at zero and clamps junk input', () => {
    expect(sceneParallax(0, 0, 0)).toEqual({ backX: 0, backY: 0, midX: 0, midY: 0 });
    expect(sceneParallax(5, 9, -9)).toEqual(sceneParallax(1, 1, -1));
    expect(sceneParallax(Number.NaN, Number.NaN, Number.NaN)).toEqual(sceneParallax(0, 0, 0));
  });

  it('drops the pointer sway and halves the travel under reduced motion', () => {
    const calm = sceneParallax(1, 1, 1, true);
    expect(calm.backX).toBe(0);
    expect(calm.midX).toBe(0);
    expect(calm.midY).toBeCloseTo(sceneParallax(1, 0, 0).midY / 2, 5);
  });
});

describe('irisPath — the iris cut-out', () => {
  // Point-in-polygon over the path's own points (every shape is drawn as lines or
  // a closed outline we can sample), so "the scene is fully open" is checked, not assumed.
  const polygon = (d: string): Array<[number, number]> =>
    [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const inside = (pts: Array<[number, number]>, x: number, y: number) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const corners: Array<[number, number]> = [[1, 1], [899, 1], [1, 1599], [899, 1599]];

  it('the heart covers every corner of the stage once the opener is at its widest', () => {
    const widest = sceneFrame('iris', 1).irisR;
    const pts = polygon(irisPath('heart', widest));
    expect(pts.length).toBeGreaterThan(40);
    for (const [x, y] of corners) expect(inside(pts, x, y), `${x},${y}`).toBe(true);
  });

  it('every shape is a closed path, and a closed iris draws nothing', () => {
    for (const shape of ['circle', 'arch', 'heart'] as IrisShape[]) {
      expect(irisPath(shape, 0.3).trim().endsWith('Z')).toBe(true);
      expect(irisPath(shape, 0)).toBe('M0 0');
    }
  });

  it('the heart looks like a heart: a point at the bottom and a dip at the top', () => {
    const pts = polygon(irisPath('heart', 0.2));
    const ys = pts.map((p) => p[1]);
    const bottom = pts[ys.indexOf(Math.max(...ys))];
    expect(Math.abs(bottom[0] - 450)).toBeLessThan(1);
    // The top of the centre line (the dip) sits below the top of the lobes.
    expect(pts[0][1]).toBeGreaterThan(Math.min(...ys) + 10);
  });
});
