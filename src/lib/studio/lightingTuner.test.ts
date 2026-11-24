import { describe, it, expect } from 'vitest';
import { lightingFor } from './lighting';
import { applyTune, DEFAULT_TUNE, formatTune, isDefaultTune, normalizeTune, warmColor } from './lightingTuner';

describe('lightingTuner', () => {
  it('the default tune returns the preset itself (untouched booths unchanged)', () => {
    const p = lightingFor('studio');
    expect(applyTune(p, DEFAULT_TUNE)).toBe(p);
  });

  it('never touches the frozen legacy rig', () => {
    const p = lightingFor('legacy');
    expect(applyTune(p, { ...DEFAULT_TUNE, exposure: 0.5 })).toBe(p);
  });

  it('multiplies each part of the rig', () => {
    const p = lightingFor('studio');
    const t = applyTune(p, { exposure: 0.8, reflections: 0.5, ambient: 2, key: 0.5, fill: 0, warmth: 0 });
    expect(t.exposure).toBeCloseTo(p.exposure * 0.8);
    expect(t.environment!.intensity).toBeCloseTo(p.environment!.intensity * 0.5);
    expect(t.ambient.intensity).toBeCloseTo(p.ambient.intensity * 2);
    expect(t.directionals[0].intensity).toBeCloseTo(p.directionals[0].intensity * 0.5);
    expect(t.directionals[1].intensity).toBe(0);
    expect(p.exposure).toBe(1); // the shared preset is not mutated
  });

  it('warmth shifts the key light toward warm or cool', () => {
    expect(warmColor('#ffffff', 0)).toBe('#ffffff');
    expect(warmColor('#ffffff', 1)).toBe('#ffc482');
    expect(warmColor('#ffffff', -1)).toBe('#bed6ff');
  });

  it('normalizeTune clamps, rounds and defaults', () => {
    expect(normalizeTune({ exposure: 9, reflections: -3, ambient: 'x', warmth: 0.123 })).toEqual({
      ...DEFAULT_TUNE, exposure: 2, reflections: 0, warmth: 0.12,
    });
    expect(normalizeTune(null)).toEqual(DEFAULT_TUNE);
    expect(isDefaultTune(normalizeTune({}))).toBe(true);
  });

  it('formatTune round-trips through normalizeTune', () => {
    const t = { ...DEFAULT_TUNE, exposure: 0.75, warmth: 0.3 };
    expect(normalizeTune(JSON.parse(formatTune(t, 'studio')))).toEqual(t);
  });
});
