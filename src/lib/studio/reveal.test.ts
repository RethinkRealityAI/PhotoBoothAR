import { describe, it, expect } from 'vitest';
import { revealScaleAt, REVEAL_SCALE_MS } from './reveal';

describe('revealScaleAt', () => {
  it('is exactly 0.6 at and before t=0', () => {
    expect(revealScaleAt(0)).toBe(0.6);
    expect(revealScaleAt(-50)).toBe(0.6);
  });

  it('settles to EXACTLY 1 at and after REVEAL_SCALE_MS (capture parity)', () => {
    expect(revealScaleAt(REVEAL_SCALE_MS)).toBe(1);
    expect(revealScaleAt(REVEAL_SCALE_MS + 1)).toBe(1);
    expect(revealScaleAt(REVEAL_SCALE_MS + 10_000)).toBe(1);
  });

  it('the curve is continuous with the boundary branches at t=0 and t=DURATION', () => {
    // Values just inside the open interval should be close to the exact
    // boundary values returned by the clamp branches (no discontinuity).
    expect(revealScaleAt(0.001)).toBeCloseTo(0.6, 2);
    expect(revealScaleAt(REVEAL_SCALE_MS - 0.001)).toBeCloseTo(1, 2);
  });

  it('stays within a soft-spring range — never collapses or blows up', () => {
    for (let ms = 0; ms <= REVEAL_SCALE_MS; ms += 5) {
      const s = revealScaleAt(ms);
      expect(s).toBeGreaterThanOrEqual(0.55);
      expect(s).toBeLessThanOrEqual(1.2);
    }
  });

  it('overshoots slightly past 1 before settling (soft spring, not a hard clamp)', () => {
    const max = Math.max(...Array.from({ length: 100 }, (_, i) => revealScaleAt((i / 99) * REVEAL_SCALE_MS)));
    expect(max).toBeGreaterThan(1);
  });

  it('descends smoothly from the overshoot peak to 1 (no wobble back up)', () => {
    // Find the peak, then confirm it descends smoothly to 1 after it.
    const samples = Array.from({ length: 200 }, (_, i) => revealScaleAt((i / 199) * REVEAL_SCALE_MS));
    const peakIdx = samples.indexOf(Math.max(...samples));
    for (let i = peakIdx; i < samples.length - 1; i++) {
      expect(samples[i + 1]).toBeLessThanOrEqual(samples[i] + 1e-9);
    }
  });
});
