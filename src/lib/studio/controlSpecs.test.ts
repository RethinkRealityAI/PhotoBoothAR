import { describe, it, expect } from 'vitest';
import {
  OVERLAY_SCALE,
  OVERLAY_POSITION,
  OVERLAY_ROTATION,
  clampToSpec,
  formatAtStep,
  defaultAnchorConfig,
  parseSpecInput,
  quantizeToStep,
} from './controlSpecs';

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

describe('parseSpecInput — typed numeric entry', () => {
  it('accepts a plain number', () => {
    expect(parseSpecInput('90', OVERLAY_ROTATION)).toBe(90);
    expect(parseSpecInput('-45.5', OVERLAY_ROTATION)).toBe(-45.5);
    expect(parseSpecInput('0', OVERLAY_POSITION)).toBe(0);
  });

  it('tolerates the unit the readout prints', () => {
    expect(parseSpecInput('90°', OVERLAY_ROTATION)).toBe(90);
    expect(parseSpecInput('25%', OVERLAY_POSITION)).toBe(25);
    expect(parseSpecInput(' 12 cm ', { min: -20, max: 20 })).toBe(12);
  });

  it('CLAMPS an out-of-range number rather than rejecting it', () => {
    expect(parseSpecInput('500', OVERLAY_ROTATION)).toBe(OVERLAY_ROTATION.max);
    expect(parseSpecInput('-500', OVERLAY_POSITION)).toBe(OVERLAY_POSITION.min);
  });

  it('returns null for in-progress text so a field can be typed into', () => {
    for (const t of ['', '  ', '-', '+', '.', '-.']) expect(parseSpecInput(t, OVERLAY_ROTATION)).toBeNull();
  });

  it('returns null for non-numeric input instead of writing NaN into a transform', () => {
    for (const t of ['abc', '1,2', 'NaN', 'Infinity', '--5', '1px']) {
      expect(parseSpecInput(t, OVERLAY_ROTATION), t).toBeNull();
    }
  });

  it('never returns a value outside the spec', () => {
    for (const t of ['1e999', '-1e999', '99999', '0']) {
      const v = parseSpecInput(t, OVERLAY_SCALE);
      if (v === null) continue;
      expect(v).toBeGreaterThanOrEqual(OVERLAY_SCALE.min);
      expect(v).toBeLessThanOrEqual(OVERLAY_SCALE.max);
    }
  });
});

describe('quantizeToStep', () => {
  it('rounds to a value the slider can actually return to', () => {
    expect(quantizeToStep(12.3456, 0.5)).toBe(12.5);
    expect(quantizeToStep(12.2, 0.5)).toBe(12);
    expect(quantizeToStep(88.7, 1)).toBe(89);
  });

  it('kills float dust', () => {
    expect(quantizeToStep(0.30000000000000004, 0.05)).toBe(0.3);
  });

  it('passes non-finite values and bad steps straight through', () => {
    expect(quantizeToStep(NaN, 0.5)).toBeNaN();
    expect(quantizeToStep(3, 0)).toBe(3);
    expect(quantizeToStep(3, -1)).toBe(3);
  });

  it('is idempotent', () => {
    for (const v of [0, 1.2, -33.3, 99.99]) {
      const once = quantizeToStep(v, 0.5);
      expect(quantizeToStep(once, 0.5)).toBe(once);
    }
  });
});

describe('defaultAnchorConfig', () => {
  const MAP = {
    'royal-crown': { config: { offset: { x: 0, y: -1, z: -0.6 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 } },
  };

  it("resets a built-in head piece to ITS tuned preset, not to zero", () => {
    // 4 of the 5 built-ins ship non-zero offsets; resetting to 0 dragged them
    // away from the position they were designed at.
    const d = defaultAnchorConfig({ type: 'headpiece', proceduralId: 'royal-crown' }, MAP);
    expect(d.offset).toEqual({ x: 0, y: -1, z: -0.6 });
  });

  it('falls back to zero for an uploaded model with no preset', () => {
    const d = defaultAnchorConfig({ type: 'model' }, MAP);
    expect(d.offset).toEqual({ x: 0, y: 0, z: 0 });
    expect(d.scale).toBe(1);
  });

  it('falls back to zero for an unknown procedural id', () => {
    const d = defaultAnchorConfig({ type: 'headpiece', proceduralId: 'nope' }, MAP);
    expect(d.offset).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('returns a COPY — a reset must not let the caller mutate the preset', () => {
    const d = defaultAnchorConfig({ type: 'headpiece', proceduralId: 'royal-crown' }, MAP);
    d.offset.y = 999;
    expect(MAP['royal-crown'].config.offset.y).toBe(-1);
  });
});
