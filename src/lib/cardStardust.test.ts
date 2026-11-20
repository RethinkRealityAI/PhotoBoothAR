import { describe, expect, it } from 'vitest';
import {
  cardFaceLayout,
  coverCrop,
  fitTitle,
  galaxy,
  gatherDelay,
  localGather,
  mulberry32,
  particleBudget,
  perimeterParam,
  perimeterPoint,
  sampleCardTargets,
  STARDUST_FULL,
  STARDUST_LITE,
  stardustAt,
  stardustTimeline,
  wrapTitle,
} from './cardStardust';

const finite = (a: ArrayLike<number>) => Array.from(a).every((x) => Number.isFinite(x));

describe('mulberry32', () => {
  it('is deterministic and in [0,1)', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('particleBudget', () => {
  it('25k on a desktop, 8k on phones, low-DPR laptops and reduced motion', () => {
    expect(particleBudget({ width: 1440, height: 900, dpr: 2, reducedMotion: false })).toBe(STARDUST_FULL);
    expect(particleBudget({ width: 390, height: 844, dpr: 3, reducedMotion: false })).toBe(STARDUST_LITE);
    expect(particleBudget({ width: 1100, height: 700, dpr: 1, reducedMotion: false })).toBe(STARDUST_LITE);
    expect(particleBudget({ width: 2560, height: 1440, dpr: 1, reducedMotion: false })).toBe(STARDUST_FULL);
    expect(particleBudget({ width: 1440, height: 900, dpr: 2, reducedMotion: true })).toBe(STARDUST_LITE);
  });
});

describe('galaxy', () => {
  it('fills n points inside the unit disk, warm core cooler rim', () => {
    const g = galaxy(5000, mulberry32(1));
    expect(g.positions.length).toBe(15000);
    expect(finite(g.positions)).toBe(true);
    let coreHeat = 0;
    let coreN = 0;
    let rimHeat = 0;
    let rimN = 0;
    for (let i = 0; i < 5000; i++) {
      const r = Math.hypot(g.positions[i * 3], g.positions[i * 3 + 2]);
      expect(r).toBeLessThan(1.3);
      expect(g.heat[i]).toBeGreaterThanOrEqual(0);
      expect(g.heat[i]).toBeLessThanOrEqual(1);
      if (r < 0.2) {
        coreHeat += g.heat[i];
        coreN++;
      } else if (r > 0.7) {
        rimHeat += g.heat[i];
        rimN++;
      }
    }
    expect(coreHeat / coreN).toBeLessThan(rimHeat / rimN);
  });
});

describe('perimeter', () => {
  it('round-trips and starts at the top centre, clockwise', () => {
    const aspect = 0.5625;
    expect(perimeterPoint(0, aspect)).toEqual([0.5, 1]);
    const right = perimeterPoint(0.25, aspect);
    expect(right[0]).toBe(1);
    for (let s = 0; s < 1; s += 0.013) {
      const [u, v] = perimeterPoint(s, aspect);
      expect(perimeterParam(u, v, aspect)).toBeCloseTo(s, 6);
    }
    expect(perimeterPoint(1.25, aspect)).toEqual(perimeterPoint(0.25, aspect));
  });
});

describe('sampleCardTargets', () => {
  // 20×40 face: dark everywhere except a bright band (the "title").
  const w = 20;
  const h = 40;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const bright = y >= 30 && y < 34;
      data[o] = bright ? 255 : 40;
      data[o + 1] = bright ? 255 : 40;
      data[o + 2] = bright ? 255 : 120;
      data[o + 3] = 255;
    }
  }
  const t = sampleCardTargets({ data, width: w, height: h }, 4000, mulberry32(3), 0.1);

  it('every target is on the card with its texel colour', () => {
    expect(t.uv.length).toBe(8000);
    expect(t.rgb.length).toBe(12000);
    expect(finite(t.uv)).toBe(true);
    for (const x of t.uv) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
    }
    for (const c of t.rgb) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it('reserves the edge share for the outline and weights bright texels', () => {
    const edges = Array.from(t.edge).filter((e) => e >= 0).length;
    expect(edges).toBe(400);
    let band = 0;
    for (let i = 400; i < 4000; i++) {
      const y = (1 - t.uv[i * 2 + 1]) * h;
      if (y >= 30 && y < 34) band++;
    }
    // The band is 10% of the area; brightness should pull far more than 10%.
    expect(band / 3600).toBeGreaterThan(0.3);
  });
});

describe('gather', () => {
  it('delay ripples from the centre and stays in range', () => {
    const centre = gatherDelay(0.5, 0.5, 0.56, 0);
    const corner = gatherDelay(0, 0, 0.56, 0);
    expect(centre).toBe(0);
    expect(corner).toBeGreaterThan(0.25);
    expect(gatherDelay(0, 1, 0.56, 1)).toBeLessThanOrEqual(0.38);
  });

  it('every particle arrives by gather = 1 (max delay + window <= 1)', () => {
    expect(localGather(1, 0.38)).toBe(1);
    expect(localGather(0, 0)).toBe(0);
    let last = 0;
    for (let g = 0; g <= 1; g += 0.01) {
      const x = localGather(g, 0.2);
      expect(x).toBeGreaterThanOrEqual(last);
      last = x;
    }
  });
});

describe('stardust timeline', () => {
  for (const reduced of [false, true]) {
    const tl = stardustTimeline(reduced);
    it(`${reduced ? 'reduced' : 'full'}: 3–5 s, gather monotonic, flash at the lock-in`, () => {
      expect(tl.done).toBeGreaterThanOrEqual(3);
      expect(tl.done).toBeLessThanOrEqual(5);
      let last = -1;
      let lastEdge = -1;
      let peakT = 0;
      let peak = 0;
      for (let t = 0; t <= tl.done + 0.5; t += 0.01) {
        const s = stardustAt(tl, t);
        for (const v of Object.values(s)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
        expect(s.gather).toBeGreaterThanOrEqual(last);
        expect(s.edgePos).toBeGreaterThanOrEqual(lastEdge);
        last = s.gather;
        lastEdge = s.edgePos;
        if (s.flash > peak) {
          peak = s.flash;
          peakT = t;
        }
      }
      expect(Math.abs(peakT - tl.lock)).toBeLessThan(0.05);
      expect(stardustAt(tl, tl.done).done).toBe(true);
      expect(stardustAt(tl, tl.done - 0.01).done).toBe(false);
      expect(stardustAt(tl, tl.done).card).toBe(1);
      expect(stardustAt(tl, tl.done).particles).toBe(0);
      expect(stardustAt(tl, tl.gather[1]).gather).toBe(1);
    });
  }

  it('reduced motion never spins up into a vortex', () => {
    const r = stardustTimeline(true);
    const f = stardustTimeline(false);
    const maxSpin = (tl: typeof r) => {
      let m = 0;
      for (let t = 0; t < tl.done; t += 0.01) m = Math.max(m, stardustAt(tl, t).spin);
      return m;
    };
    expect(maxSpin(r)).toBeLessThan(1.5);
    expect(maxSpin(f)).toBeGreaterThan(4);
  });

  it('idle is the calm galaxy with the title glowing', () => {
    const s = stardustAt(stardustTimeline(false), -1);
    expect(s.title).toBe(1);
    expect(s.gather).toBe(0);
    expect(s.done).toBe(false);
  });
});

describe('card face layout', () => {
  for (const [W, H] of [
    [740, 1600],
    [900, 1600],
  ]) {
    it(`${W}×${H}: photo, title and sparkle sit inside the frame without overlapping`, () => {
      const l = cardFaceLayout(W, H);
      expect(l.photo.x).toBeGreaterThan(l.frame.x);
      expect(l.photo.x + l.photo.w).toBeLessThan(l.frame.x + l.frame.w);
      expect(l.photo.y).toBeGreaterThan(l.frame.y);
      expect(l.title.y).toBeGreaterThan(l.photo.y + l.photo.h);
      expect(l.title.y + l.title.maxH).toBeLessThanOrEqual(l.frame.y + l.frame.h);
      expect(l.sparkle.y).toBeLessThan(H);
    });
  }

  it('coverCrop fills the box and keeps the source aspect', () => {
    const c = coverCrop(1080, 1920, 600, 600);
    expect(c.w).toBeCloseTo(1080, 6);
    expect(c.h).toBeCloseTo(1080, 6);
    expect(c.y).toBeGreaterThan(0);
    const d = coverCrop(0, 10, 5, 5);
    expect(d.w).toBe(0);
  });

  const measure = (s: string, size = 10) => s.length * size * 0.5;

  it('wrapTitle wraps greedily and refuses too many lines', () => {
    expect(wrapTitle('Happy birthday, Dapo!', 60, (s) => measure(s), 3)).toEqual(['Happy', 'birthday,', 'Dapo!']);
    expect(wrapTitle('Happy birthday, Dapo!', 200, (s) => measure(s), 3)).toEqual(['Happy birthday, Dapo!']);
    expect(wrapTitle('a b c d', 5, (s) => measure(s), 2)).toBeNull();
    expect(wrapTitle('   ', 50, (s) => measure(s), 2)).toEqual([]);
  });

  it('fitTitle steps the size down until it fits, then truncates', () => {
    const fit = fitTitle('Happy birthday, Dapo!', { maxW: 300, maxH: 200 }, measure, {
      max: 80, min: 20, lineHeight: 1.1, maxLines: 3,
    });
    expect(fit.size).toBeLessThanOrEqual(80);
    expect(fit.lines.length).toBeGreaterThan(0);
    for (const l of fit.lines) expect(measure(l, fit.size)).toBeLessThanOrEqual(300);
    const tiny = fitTitle('word '.repeat(40), { maxW: 50, maxH: 30 }, measure, {
      max: 40, min: 10, lineHeight: 1.1, maxLines: 2,
    });
    expect(tiny.size).toBe(10);
    expect(tiny.lines.length).toBe(2);
    expect(tiny.lines[1].endsWith('…')).toBe(true);
  });
});
