import { describe, expect, it } from 'vitest';
import {
  airplaneTimeline,
  bloomAt,
  buildDart,
  cardStage,
  catchPath,
  dartFrame,
  FLAT,
  FOLDED,
  fillDistance,
  figureEight,
  flightAttitude,
  foldAmountsAt,
  foldScheduleIsSafe,
  FOLD_GROUPS,
  heightToNormal,
  kinematics,
  len3,
  polygonArea,
  poseDart,
  sub3,
  type V3,
} from './cardFlight';

const finite = (a: ArrayLike<number>) => Array.from(a).every((x) => Number.isFinite(x));

describe('buildDart', () => {
  for (const [w, h] of [
    [0.46, 1],
    [0.5625, 1],
    [0.75, 1],
  ] as const) {
    describe(`sheet ${w}×${h}`, () => {
      const m = buildDart(w, h);

      it('cuts the sheet into facets that tile it exactly', () => {
        const area = m.facets.reduce((s, f) => s + polygonArea(f.poly), 0);
        expect(area).toBeCloseTo(4 * w * h, 6);
        for (const f of m.facets) expect(polygonArea(f.poly)).toBeGreaterThan(0);
        expect(m.facets.length).toBeGreaterThan(8);
      });

      it('has seven folds in fold order and creases inside the sheet', () => {
        expect(m.folds.map((f) => f.group)).toEqual([
          'corners', 'corners', 'edges', 'edges', 'keel', 'wings', 'wings',
        ]);
        expect(m.creases.length).toBeGreaterThan(6);
        for (const [p, q] of m.creases) {
          for (const v of [p, q]) {
            expect(Math.abs(v[0])).toBeLessThanOrEqual(w + 1e-9);
            expect(Math.abs(v[1])).toBeLessThanOrEqual(h + 1e-9);
          }
        }
      });

      it('t=0 is the flat sheet and UVs map the sheet to [0,1]²', () => {
        const out = new Float32Array(m.flat.length);
        poseDart(m, FLAT, out);
        expect(Array.from(out)).toEqual(Array.from(m.flat));
        for (let i = 0; i < out.length; i += 3) expect(out[i + 2]).toBe(0);
        for (const u of m.uv) {
          expect(u).toBeGreaterThanOrEqual(-1e-6);
          expect(u).toBeLessThanOrEqual(1 + 1e-6);
        }
      });

      it('folded is a narrow dart, rigid per facet, no NaN', () => {
        const out = new Float32Array(m.flat.length);
        poseDart(m, FOLDED, out);
        expect(finite(out)).toBe(true);
        // Rigid: every triangle keeps its edge lengths.
        for (let i = 0; i < out.length; i += 9) {
          for (const [a, b] of [[0, 3], [3, 6], [6, 0]]) {
            const flatD = Math.hypot(m.flat[i + a] - m.flat[i + b], m.flat[i + a + 1] - m.flat[i + b + 1]);
            const d = Math.hypot(
              out[i + a] - out[i + b], out[i + a + 1] - out[i + b + 1], out[i + a + 2] - out[i + b + 2],
            );
            expect(d).toBeCloseTo(flatD, 5);
          }
        }
        // Folded in half: nothing reaches the left half of the sheet's footprint.
        let minX = Infinity;
        let maxX = -Infinity;
        for (let i = 0; i < out.length; i += 3) {
          minX = Math.min(minX, out[i]);
          maxX = Math.max(maxX, out[i]);
        }
        expect(minX).toBeGreaterThan(-0.05);
        expect(maxX).toBeLessThan(w);
      });

      it('stays connected: points shared by facets land together at every pose', () => {
        // A vertex position that occurs in several facets (a crease point) must
        // map to the same place (within a few paper thicknesses) — no tears.
        for (const amounts of [FOLDED, { corners: 1, edges: 1, keel: 1, wings: 0.5 }, { corners: 1, edges: 0.4, keel: 0.3, wings: 0 }, { corners: 0.5, edges: 0, keel: 0, wings: 0 }]) {
          const out = new Float32Array(m.flat.length);
          poseDart(m, amounts, out);
          const groups = new Map<string, V3[]>();
          for (let i = 0; i < out.length; i += 3) {
            const key = `${m.flat[i].toFixed(5)},${m.flat[i + 1].toFixed(5)}`;
            const list = groups.get(key) ?? [];
            list.push([out[i], out[i + 1], out[i + 2]]);
            groups.set(key, list);
          }
          let worst = 0;
          for (const list of groups.values()) {
            for (const p of list) worst = Math.max(worst, len3(sub3(p, list[0])));
          }
          expect(worst).toBeLessThan(0.08);
        }
      });

      it('the printed face stays outside: no flap pokes in front of the right keel when folded', () => {
        const out = new Float32Array(m.flat.length);
        poseDart(m, { ...FOLDED, wings: 0 }, out);
        // Right half is the stationary layer at z = 0; everything else is behind it.
        for (let i = 0; i < out.length; i += 3) expect(out[i + 2]).toBeLessThanOrEqual(1e-6);
      });

      it('dartFrame is orthonormal', () => {
        const f = dartFrame(m);
        expect(len3(f.up)).toBeCloseTo(1, 6);
        expect(len3(f.side)).toBeCloseTo(1, 6);
        expect(f.up[0]).toBeGreaterThan(0.8);
      });
    });
  }

  it('rejects an impossible sheet', () => {
    expect(() => buildDart(0, 1)).toThrow();
    expect(() => buildDart(3, 1)).toThrow();
  });
});

describe('airplane timeline', () => {
  for (const reduced of [false, true]) {
    const tl = airplaneTimeline(reduced);
    it(`${reduced ? 'reduced' : 'full'}: 4–6 s after the tap, safe overlaps only`, () => {
      expect(tl.done).toBeGreaterThanOrEqual(4);
      expect(tl.done).toBeLessThanOrEqual(6);
      expect(foldScheduleIsSafe(tl)).toBe(true);
      expect(tl.dolly.end).toBeLessThanOrEqual(tl.done);
    });

    it(`${reduced ? 'reduced' : 'full'}: folded at the tap, flat at the end, never refolding`, () => {
      expect(foldAmountsAt(tl, 0)).toEqual({ ...FOLDED });
      expect(foldAmountsAt(tl, tl.done)).toEqual({ ...FLAT });
      for (const g of FOLD_GROUPS) {
        let last = 1;
        for (let t = 0; t <= tl.done; t += 0.02) {
          const a = foldAmountsAt(tl, t)[g];
          expect(Number.isFinite(a)).toBe(true);
          expect(a).toBeLessThanOrEqual(last + 1e-12);
          last = a;
        }
      }
    });

    it(`${reduced ? 'reduced' : 'full'}: bloom rises and fades inside its window`, () => {
      expect(bloomAt(tl, tl.bloom.start)).toBe(0);
      expect(bloomAt(tl, tl.bloom.peak)).toBeCloseTo(1, 6);
      expect(bloomAt(tl, tl.bloom.end)).toBe(0);
      expect(bloomAt(tl, -1)).toBe(0);
    });
  }

  it('reduced motion has a shorter catch flight (no loop)', () => {
    expect(airplaneTimeline(true).flight).toBeLessThan(airplaneTimeline(false).flight);
  });

  it('a schedule that overlaps the edges with the wings is flagged unsafe', () => {
    const tl = airplaneTimeline(false);
    expect(foldScheduleIsSafe({ ...tl, unfold: { ...tl.unfold, edges: { start: 2.9, end: 4 } } })).toBe(false);
  });
});

describe('flight', () => {
  const eight = { center: [0, 0.5, -16] as V3, ax: 2, ay: 0.8, az: 2, period: 9 };

  it('figure-eight is periodic and finite', () => {
    const a = figureEight(eight, 1.3);
    const b = figureEight(eight, 1.3 + 2 * eight.period);
    for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i], 6);
    expect(finite(a)).toBe(true);
  });

  it('attitude: level flight is upright, a tight turn banks into it, stopped is null', () => {
    const level = flightAttitude([1, 0, 0], [0, 0, 0])!;
    expect(level.up[1]).toBeCloseTo(1, 6);
    const turn = flightAttitude([1, 0, 0], [0, 0, -20])!;
    expect(turn.up[2]).toBeLessThan(-0.5); // leans toward the centre of the turn
    expect(flightAttitude([0, 0, 0], [0, 0, 0])).toBeNull();
    const dive = flightAttitude([0, -1, 0], [0, -9.8, 0])!;
    expect(finite([...dive.up, ...dive.forward])).toBe(true);
  });

  for (const loop of [true, false]) {
    it(`catch path (${loop ? 'loop' : 'glide'}) starts where the plane is, heads the same way, and settles at rest`, () => {
      const start = figureEight(eight, 2.1);
      const k = kinematics((t) => figureEight(eight, t), 2.1);
      const settle: V3 = [0, 0, -7];
      const p = catchPath({ start, startVel: k.vel, settle, hw: 2.7, hh: 2.9, duration: 2.6, loop });
      const p0 = p.at(0);
      for (let i = 0; i < 3; i++) expect(p0[i]).toBeCloseTo(start[i], 4);
      const pEnd = p.at(p.duration);
      for (let i = 0; i < 3; i++) expect(pEnd[i]).toBeCloseTo(settle[i], 4);
      const k0 = kinematics(p.at, 0.02, 0.005);
      const cos = (k0.vel[0] * k.vel[0] + k0.vel[1] * k.vel[1] + k0.vel[2] * k.vel[2]) / (len3(k0.vel) * len3(k.vel));
      expect(cos).toBeGreaterThan(0.7);
      const kEnd = kinematics(p.at, p.duration - 0.01, 0.005);
      expect(len3(kEnd.vel)).toBeLessThan(0.4);
      for (let t = 0; t <= p.duration; t += 0.05) expect(finite(p.at(t))).toBe(true);
      // Past the end it holds.
      expect(p.at(p.duration + 3)).toEqual(p.at(p.duration));
    });
  }

  it('the loop really loops: the plane goes inverted somewhere on the path', () => {
    const start = figureEight(eight, 0.4);
    const k = kinematics((t) => figureEight(eight, t), 0.4);
    const p = catchPath({ start, startVel: k.vel, settle: [0, 0, -7], hw: 2.7, hh: 2.9, duration: 2.6, loop: true });
    let minUp = 1;
    for (let t = 0.05; t < p.duration - 0.2; t += 0.02) {
      const kk = kinematics(p.at, t, 0.004);
      const att = flightAttitude(kk.vel, kk.acc);
      if (att) minUp = Math.min(minUp, att.up[1]);
    }
    expect(minUp).toBeLessThan(0);
  });
});

describe('stage', () => {
  it('phones are full-bleed at their own proportions; desktops get a tall card', () => {
    const phone = cardStage(390, 844);
    expect(phone.fullBleed).toBe(true);
    expect(phone.aspect).toBeCloseTo(390 / 844, 6);
    const desk = cardStage(1440, 900);
    expect(desk.fullBleed).toBe(false);
    expect(desk.aspect).toBeCloseTo(9 / 16, 6);
    expect(cardStage(Number.NaN, 0).fullBleed).toBe(true);
  });

  it('fillDistance: a full-bleed card covers the view at that distance', () => {
    const aspect = 390 / 844;
    const d = fillDistance(2 * aspect, 2, aspect, 40, 1, true);
    const visH = 2 * d * Math.tan((20 * Math.PI) / 180);
    expect(visH).toBeCloseTo(2, 6);
    const dd = fillDistance(1.125, 2, 1.6, 40, 0.88, false);
    expect(2 / (2 * dd * Math.tan((20 * Math.PI) / 180))).toBeCloseTo(0.88, 6);
  });
});

describe('heightToNormal', () => {
  it('flat height is a straight-up normal; a ramp tilts it', () => {
    const w = 4;
    const h = 4;
    const flat = new Uint8ClampedArray(w * h * 4).fill(128);
    const n = heightToNormal(flat, w, h);
    expect([n[0], n[1], n[2], n[3]]).toEqual([128, 128, 255, 255]);
    const ramp = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) ramp[(y * w + x) * 4] = x * 60;
    const r = heightToNormal(ramp, w, h);
    const i = (1 * w + 1) * 4;
    expect(r[i]).toBeLessThan(128); // rising to the right → normal leans left
    expect(r[i + 1]).toBe(128);
  });
});
