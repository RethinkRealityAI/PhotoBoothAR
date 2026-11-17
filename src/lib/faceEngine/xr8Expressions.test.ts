import { describe, expect, it } from 'vitest';
import {
  XR8_EXPRESSION_CATEGORIES, blinkFromAperture, createXr8ExpressionState, resetXr8ExpressionState, xr8Expressions,
} from './xr8Expressions';
import { xr8LocalToHeadCm } from './xr8Pose';
import { XR8_SPIKE_FRAMES, type Xr8SpikeFrame } from './xr8Spike.fixture';
import { sourceSignal, type TriggerSource } from '../studio/triggers';

/** The fixture's face-local vertices -> a flat head-cm mesh (NaN where the fixture kept none). */
function headMesh(f: Xr8SpikeFrame): Float32Array {
  const m = new Float32Array(468 * 3).fill(NaN);
  const o = new Float32Array(3);
  for (const [i, [x, y, z]] of Object.entries(f.local)) {
    xr8LocalToHeadCm([{ x, y, z }], o);
    m.set(o, Number(i) * 3);
  }
  return m;
}
const once = (m: ArrayLike<number>) => xr8Expressions(m, 0, createXr8ExpressionState(), {}) as Record<string, number>;
const iodOf = (m: Float32Array) =>
  Math.hypot(m[33 * 3] - m[263 * 3], m[33 * 3 + 1] - m[263 * 3 + 1], m[33 * 3 + 2] - m[263 * 3 + 2]);
// Enter levels of the shipped trigger presets (triggers.ts).
const ENTER: Partial<Record<TriggerSource, number>> = { smile: 0.55, mouthOpen: 0.5, wink: 0.55 };
/** The one clip where the engines' mouths disagree (hand near the mouth): documented, not asserted. */
const DISPUTED = 'friend';

describe('xr8Expressions — vs MediaPipe blendshapes on the same real frames', () => {
  it('emits exactly the 8 categories triggers read, all in [0, 1]', () => {
    const e = once(headMesh(XR8_SPIKE_FRAMES[0]));
    expect(Object.keys(e).sort()).toEqual([...XR8_EXPRESSION_CATEGORIES].sort());
    for (const v of Object.values(e)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  for (const f of XR8_SPIKE_FRAMES.filter((x) => x.clip !== DISPUTED)) {
    it(`${f.clip}: every shipped trigger is in the same state as under MediaPipe; scores near MediaPipe's`, () => {
      const e = once(headMesh(f));
      for (const [src, enter] of Object.entries(ENTER) as [TriggerSource, number][]) {
        expect(sourceSignal(src, e) >= enter, `${src} ours ${sourceSignal(src, e)}`).toBe(sourceSignal(src, f.mpBlendshapes) >= enter);
      }
      // Bounds sit just above the maxima measured on first run (2026-11-17): smile 0.237,
      // jaw 0.088, blink 0.166 — all on bdaywoman2 (yawed, laughing).
      for (const c of ['mouthSmileLeft', 'mouthSmileRight'] as const) expect(Math.abs(e[c] - f.mpBlendshapes[c]), c).toBeLessThan(0.25);
      expect(Math.abs(e.jawOpen - f.mpBlendshapes.jawOpen)).toBeLessThan(0.1);
      for (const c of ['eyeBlinkLeft', 'eyeBlinkRight'] as const) expect(Math.abs(e[c] - f.mpBlendshapes[c]), c).toBeLessThan(0.2);
    });
  }

  it(`${DISPUTED}: the known miss is still a miss (update the header if this starts passing)`, () => {
    for (const f of XR8_SPIKE_FRAMES.filter((x) => x.clip === DISPUTED)) {
      const e = once(headMesh(f));
      expect(sourceSignal('smile', e)).toBeLessThan(0.55);
      expect(sourceSignal('smile', f.mpBlendshapes)).toBeGreaterThan(0.9);
    }
  });
});

describe('xr8Expressions — synthetic gestures on the neutral mesh', () => {
  const base = headMesh(XR8_SPIKE_FRAMES[0]);

  it('wink: closing ONE lid fires wink, closing both does not (sides as named)', () => {
    const m = Float32Array.from(base);
    m.set(m.subarray(374 * 3, 374 * 3 + 3), 386 * 3); // left upper lid onto the lower
    const e = once(m);
    expect(e.eyeBlinkLeft).toBeGreaterThan(0.9);
    expect(e.eyeBlinkRight).toBeLessThan(0.25);
    expect(sourceSignal('wink', e)).toBeGreaterThan(0.55);
    m.set(m.subarray(145 * 3, 145 * 3 + 3), 159 * 3);
    expect(sourceSignal('wink', once(m))).toBe(0);
  });

  it('browRaise: rest scores 0, a raise of ~0.05 iod fires, a held raise decays slowly', () => {
    const s = createXr8ExpressionState();
    const iod = iodOf(base);
    for (let t = 0; t <= 1000; t += 33) expect(sourceSignal('browRaise', xr8Expressions(base, t, s, {})!)).toBe(0);
    const up = Float32Array.from(base);
    for (const i of [70, 107, 300, 336]) up[i * 3 + 1] += 0.05 * iod;
    expect(sourceSignal('browRaise', xr8Expressions(up, 1033, s, {})!)).toBeGreaterThan(0.55);
    let last = 1;
    for (let t = 1066; t <= 3033; t += 33) last = sourceSignal('browRaise', xr8Expressions(up, t, s, {})!);
    expect(last).toBeGreaterThan(0.55); // still held after 2 s
    expect(last).toBeLessThan(1);
  });

  it('browRaise: a face that STARTS with raised brows recovers its rest within 1 s (8th Wall\'s boolean never does)', () => {
    const s = createXr8ExpressionState();
    const up = Float32Array.from(base);
    for (const i of [70, 107, 300, 336]) up[i * 3 + 1] += 0.05 * iodOf(base);
    xr8Expressions(up, 0, s, {});
    for (let t = 33; t <= 1000; t += 33) xr8Expressions(base, t, s, {});
    expect(sourceSignal('browRaise', xr8Expressions(base, 1033, s, {})!)).toBe(0);
    expect(sourceSignal('browRaise', xr8Expressions(up, 1066, s, {})!)).toBeGreaterThan(0.55);
  });

  it('reset re-primes; writes into the caller object; null leaves state alone', () => {
    const s = createXr8ExpressionState();
    const out = {};
    expect(xr8Expressions(base, 0, s, out)).toBe(out);
    expect(s.primed).toBe(true);
    resetXr8ExpressionState(s);
    expect(s.primed).toBe(false);
    const bad = Float32Array.from(base);
    bad[386 * 3] = NaN;
    expect(xr8Expressions(bad, 0, s, {})).toBeNull();
    expect(xr8Expressions(new Float32Array(30), 0, s, {})).toBeNull();
    expect(s.primed).toBe(false);
  });

  it('blinkFromAperture is continuous and non-increasing over its range', () => {
    let prev = blinkFromAperture(0);
    expect(prev).toBe(1);
    for (let ap = 0.001; ap <= 0.4; ap += 0.001) {
      const v = blinkFromAperture(ap);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      expect(prev - v).toBeLessThan(0.01);
      prev = v;
    }
    expect(blinkFromAperture(0.36)).toBe(0);
  });
});
