import { describe, it, expect } from 'vitest';
import { hapticPattern, type HapticKind } from './haptics';

const ALL: HapticKind[] = ['tap', 'select', 'toggle', 'capture', 'success', 'error'];

describe('hapticPattern', () => {
  it('covers every kind', () => {
    for (const kind of ALL) {
      expect(hapticPattern(kind).length).toBeGreaterThan(0);
    }
  });

  it('keeps every buzz short enough to read as physical rather than broken', () => {
    // A vibration long enough to notice consciously reads as a malfunction.
    for (const kind of ALL) {
      for (const ms of hapticPattern(kind)) {
        expect(ms).toBeLessThanOrEqual(60);
      }
    }
  });

  it('makes the shutter firmer than a nav tap', () => {
    expect(hapticPattern('capture')[0]).toBeGreaterThan(hapticPattern('tap')[0]);
  });

  it('gives error the most insistent pattern, so failure never feels like success', () => {
    const pulses = (k: HapticKind) => hapticPattern(k).filter((_, i) => i % 2 === 0);
    expect(pulses('error').length).toBeGreaterThan(1);
    const total = (k: HapticKind) => hapticPattern(k).reduce((a, b) => a + b, 0);
    expect(total('error')).toBeGreaterThan(total('success'));
    expect(total('error')).toBeGreaterThan(total('select'));
  });

  it('uses a single pulse for the momentary acknowledgements', () => {
    // Anything multi-pulse reads as an event, not an acknowledgement.
    for (const kind of ['tap', 'select', 'capture'] as HapticKind[]) {
      expect(hapticPattern(kind)).toHaveLength(1);
    }
  });
});
