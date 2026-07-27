import { describe, it, expect } from 'vitest';
import { OVERLAY_SCALE, OVERLAY_POSITION, clampToSpec, formatAtStep } from './controlSpecs';

describe('OVERLAY_SCALE', () => {
  it('reaches the stage wheel-zoom ceiling — the drift that lost work', () => {
    // StudioStage clamps a wheel zoom to 5. When the sliders declared max 3, an
    // <input type="range"> clamped a 4.2 sticker down to 3 on first touch.
    expect(OVERLAY_SCALE.max).toBe(5);
    expect(OVERLAY_SCALE.min).toBeGreaterThan(0);
    expect(OVERLAY_SCALE.min).toBeLessThan(1);
  });
});

describe('clampToSpec', () => {
  it('leaves an in-range value alone', () => {
    expect(clampToSpec(4.2, OVERLAY_SCALE)).toBe(4.2);
  });

  it('clamps to both ends', () => {
    expect(clampToSpec(99, OVERLAY_SCALE)).toBe(OVERLAY_SCALE.max);
    expect(clampToSpec(-3, OVERLAY_SCALE)).toBe(OVERLAY_SCALE.min);
    expect(clampToSpec(-500, OVERLAY_POSITION)).toBe(-100);
  });

  it('snaps non-finite input to the minimum instead of leaking NaN into a transform', () => {
    expect(clampToSpec(NaN, OVERLAY_SCALE)).toBe(OVERLAY_SCALE.min);
    expect(clampToSpec(Infinity, OVERLAY_SCALE)).toBe(OVERLAY_SCALE.min);
  });
});

describe('formatAtStep', () => {
  it('shows the resolution the step actually offers', () => {
    // step 0.5 with toFixed(0) rendered 0.5 and 1.0 both as "1%".
    expect(formatAtStep(0.5, 0.5, '%')).toBe('0.5%');
    expect(formatAtStep(1, 0.5, '%')).toBe('1.0%');
    expect(formatAtStep(1.5, 0.5, '%')).toBe('1.5%');
  });

  it('never shows decimals for whole-number steps', () => {
    expect(formatAtStep(12, 1, '°')).toBe('12°');
    expect(formatAtStep(-180, 1, '°')).toBe('-180°');
  });

  it('distinguishes adjacent steps — the property that was broken', () => {
    const step = OVERLAY_POSITION.step;
    for (let v = -3; v < 3; v += step) {
      expect(formatAtStep(v, step)).not.toBe(formatAtStep(v + step, step));
    }
  });

  it('caps at two decimals for very fine steps', () => {
    expect(formatAtStep(0.125, 0.001)).toBe('0.13');
  });
});
