import { describe, it, expect } from 'vitest';
import {
  CARD_TEMPLATE_IDS,
  CARD_TEMPLATE_OPTIONS,
  DEFAULT_CARD_TEMPLATE,
  POLAROID_ENTRANCE_SPAN,
  POLAROID_FAN_STEP_DEG,
  POLAROID_FAN_STEP_X_PCT,
  POLAROID_MAX_SHIFT_X_PCT,
  POLAROID_MAX_SHIFT_Y_PCT,
  POLAROID_MAX_TILT_DEG,
  isCardTemplateId,
  normalizeCardTemplate,
  polaroidEntrance,
  polaroidFan,
  polaroidPlacement,
  polaroidSeed,
} from './cardTemplates';

describe('the closed set of card templates', () => {
  it('ships exactly the three shipped templates, in host-facing order', () => {
    expect(CARD_TEMPLATE_IDS).toEqual(['storybook', 'filmstrip', 'polaroid']);
  });

  it('has one option per id, in the same order, each with a one-line description', () => {
    expect(CARD_TEMPLATE_OPTIONS.map((o) => o.id)).toEqual([...CARD_TEMPLATE_IDS]);
    for (const o of CARD_TEMPLATE_OPTIONS) {
      expect(o.label.trim().length).toBeGreaterThan(0);
      expect(o.description.trim().length).toBeGreaterThan(0);
      // One LINE: descriptions sit under a <select> option, never wrap to prose.
      expect(o.description).not.toContain('\n');
      expect(o.description.length).toBeLessThanOrEqual(90);
    }
  });

  it('recognises every shipped id and nothing else', () => {
    for (const id of CARD_TEMPLATE_IDS) expect(isCardTemplateId(id)).toBe(true);
    expect(isCardTemplateId('storybooks')).toBe(false);
    expect(isCardTemplateId('')).toBe(false);
    expect(isCardTemplateId(null)).toBe(false);
    expect(isCardTemplateId(undefined)).toBe(false);
    expect(isCardTemplateId(7)).toBe(false);
  });

  it('normalizes an unknown/absent stored template to the default', () => {
    expect(normalizeCardTemplate('polaroid')).toBe('polaroid');
    expect(normalizeCardTemplate('filmstrip')).toBe('filmstrip');
    expect(normalizeCardTemplate('a-template-from-the-future')).toBe(DEFAULT_CARD_TEMPLATE);
    expect(normalizeCardTemplate('')).toBe(DEFAULT_CARD_TEMPLATE);
    expect(normalizeCardTemplate(null)).toBe(DEFAULT_CARD_TEMPLATE);
    expect(normalizeCardTemplate(undefined)).toBe(DEFAULT_CARD_TEMPLATE);
    expect(DEFAULT_CARD_TEMPLATE).toBe('storybook');
  });
});

describe('polaroidSeed', () => {
  it('is a pure function of id + salt (32-bit unsigned)', () => {
    expect(polaroidSeed('a')).toBe(polaroidSeed('a'));
    expect(polaroidSeed('')).toBe(2166136261); // the FNV-1a offset basis
    expect(polaroidSeed('a')).toBe(3826002220);
    for (const id of ['', 'a', 'contribution-7', 'x'.repeat(64)]) {
      const s = polaroidSeed(id);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('separates the salts, so one id drives independent streams', () => {
    expect(polaroidSeed('a', 1)).toBe(3842779839);
    expect(polaroidSeed('a', 1)).not.toBe(polaroidSeed('a', 0));
    expect(polaroidSeed('a', 2)).not.toBe(polaroidSeed('a', 1));
  });
});

describe('polaroidPlacement', () => {
  it('is deterministic — the same print lands at the same angle every render', () => {
    const id = 'a1b2c3d4-0000-4000-8000-000000000001';
    expect(polaroidPlacement(id)).toEqual(polaroidPlacement(id));
    // Golden values pin the rule itself (salt order, bit slice, rounding).
    expect(polaroidPlacement(id)).toEqual({ rotationDeg: -0.37, offsetXPct: -1.3, offsetYPct: 0.76 });
    expect(polaroidPlacement('9f8e7d6c-1111-4111-8111-111111111111')).toEqual({
      rotationDeg: 1.96,
      offsetXPct: -0.43,
      offsetYPct: -0.69,
    });
    expect(polaroidPlacement('contribution-7')).toEqual({
      rotationDeg: -2.69,
      offsetXPct: -0.83,
      offsetYPct: -1.42,
    });
  });

  it('differs between ids (a wall of prints is never a stack of clones)', () => {
    const rots = new Set(Array.from({ length: 50 }, (_, i) => polaroidPlacement(`id-${i}`).rotationDeg));
    expect(rots.size).toBeGreaterThan(40);
  });

  it('stays inside the published bounds and tilts both ways', () => {
    let neg = 0;
    let pos = 0;
    for (let i = 0; i < 200; i++) {
      const p = polaroidPlacement(`id-${i}`);
      expect(Math.abs(p.rotationDeg)).toBeLessThanOrEqual(POLAROID_MAX_TILT_DEG);
      expect(Math.abs(p.offsetXPct)).toBeLessThanOrEqual(POLAROID_MAX_SHIFT_X_PCT);
      expect(Math.abs(p.offsetYPct)).toBeLessThanOrEqual(POLAROID_MAX_SHIFT_Y_PCT);
      // 2dp keeps the CSS value stable (no sub-pixel jitter between renders).
      // Asserted on the DECIMAL STRING: `0.57 * 100` is 56.99999999999999, so
      // multiplying back out would compare two computed binary floats.
      expect(String(p.rotationDeg)).toMatch(/^-?\d+(\.\d{1,2})?$/);
      expect(String(p.offsetXPct)).toMatch(/^-?\d+(\.\d{1,2})?$/);
      if (p.rotationDeg < 0) neg++;
      else pos++;
    }
    expect(neg).toBeGreaterThan(60);
    expect(pos).toBeGreaterThan(60);
  });

  it('handles an empty id without throwing', () => {
    const p = polaroidPlacement('');
    expect(Number.isFinite(p.rotationDeg)).toBe(true);
    expect(Math.abs(p.rotationDeg)).toBeLessThanOrEqual(POLAROID_MAX_TILT_DEG);
  });
});

describe('polaroidEntrance (the driven/frame-by-frame path)', () => {
  it('starts held back and settles by the end of its span', () => {
    expect(polaroidEntrance(0)).toEqual({ opacity: 0, y: 26, scale: 0.96 });
    expect(polaroidEntrance(POLAROID_ENTRANCE_SPAN)).toEqual({ opacity: 1, y: 0, scale: 1 });
    expect(polaroidEntrance(1)).toEqual({ opacity: 1, y: 0, scale: 1 });
  });

  it('is monotonic across the span and deterministic', () => {
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const e = polaroidEntrance((i / 20) * POLAROID_ENTRANCE_SPAN);
      expect(e.opacity).toBeGreaterThanOrEqual(prev);
      expect(e).toEqual(polaroidEntrance((i / 20) * POLAROID_ENTRANCE_SPAN));
      prev = e.opacity;
    }
  });

  it('never yields NaN into a transform (out-of-range / non-finite settles)', () => {
    for (const bad of [NaN, Infinity, -Infinity, -3, 99]) {
      const e = polaroidEntrance(bad);
      expect(Number.isFinite(e.opacity)).toBe(true);
      expect(Number.isFinite(e.y)).toBe(true);
      expect(Number.isFinite(e.scale)).toBe(true);
      expect(e.opacity).toBeGreaterThanOrEqual(0);
      expect(e.opacity).toBeLessThanOrEqual(1);
    }
    expect(polaroidEntrance(NaN)).toEqual({ opacity: 1, y: 0, scale: 1 });
    expect(polaroidEntrance(-3)).toEqual({ opacity: 0, y: 26, scale: 0.96 });
  });
});

describe('polaroidFan (the cover stack)', () => {
  const ids = ['a1b2c3d4-0000-4000-8000-000000000001', '9f8e7d6c-1111-4111-8111-111111111111', 'contribution-7'];

  it('returns one placement per print, empty in, empty out', () => {
    expect(polaroidFan([])).toEqual([]);
    expect(polaroidFan(ids)).toHaveLength(3);
    expect(polaroidFan(['solo'])).toHaveLength(1);
  });

  it('fans symmetrically about the centre and stays deterministic', () => {
    const fan = polaroidFan(ids);
    expect(fan).toEqual(polaroidFan(ids));
    expect(fan[0].rotationDeg).toBeLessThan(0); // leans left
    expect(fan[2].rotationDeg).toBeGreaterThan(0); // leans right
    expect(fan[0].offsetXPct).toBeLessThan(fan[1].offsetXPct);
    expect(fan[1].offsetXPct).toBeLessThan(fan[2].offsetXPct);
    expect(fan).toEqual([
      { rotationDeg: -9.18, offsetXPct: -62.65, offsetYPct: 7.38 },
      { rotationDeg: 0.98, offsetXPct: -0.21, offsetYPct: -0.34 },
      { rotationDeg: 7.66, offsetXPct: 61.59, offsetYPct: 6.29 },
    ]);
  });

  it('bounds the fan: the outermost print never exceeds its step plus half a jitter', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const fan = polaroidFan(Array.from({ length: n }, (_, i) => `fan-${n}-${i}`));
      const maxSpread = (n - 1) / 2;
      for (const p of fan) {
        expect(Math.abs(p.rotationDeg)).toBeLessThanOrEqual(maxSpread * POLAROID_FAN_STEP_DEG + POLAROID_MAX_TILT_DEG / 2);
        expect(Math.abs(p.offsetXPct)).toBeLessThanOrEqual(maxSpread * POLAROID_FAN_STEP_X_PCT + POLAROID_MAX_SHIFT_X_PCT / 2);
      }
    }
  });

  it('centres a lone print (no spread term to apply)', () => {
    const [only] = polaroidFan(['solo']);
    expect(Math.abs(only.rotationDeg)).toBeLessThanOrEqual(POLAROID_MAX_TILT_DEG / 2);
    expect(Math.abs(only.offsetXPct)).toBeLessThanOrEqual(POLAROID_MAX_SHIFT_X_PCT / 2);
    expect(Math.abs(only.offsetYPct)).toBeLessThanOrEqual(POLAROID_MAX_SHIFT_Y_PCT / 2);
  });
});
