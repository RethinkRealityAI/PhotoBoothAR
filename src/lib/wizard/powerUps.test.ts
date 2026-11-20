import { describe, expect, it } from 'vitest';
import { parseTriggers } from '../studio/triggers';
import { POWER_UP_PRESETS, normalizePowerUps, powerUpTriggers, powerUpsConfig, togglePowerUp } from './powerUps';

describe('power-ups', () => {
  it('absent or junk config means no triggers', () => {
    for (const junk of [undefined, null, [], 'x', { v: 2, on: ['smile-sparkles'] }, { v: 1, on: 'smile-sparkles' }]) {
      expect(powerUpTriggers(junk)).toEqual([]);
    }
  });
  it('drops unknown ids and keeps preset order', () => {
    expect(normalizePowerUps({ v: 1, on: ['fist-beam', 'evil', 'smile-sparkles', 'smile-sparkles'] }))
      .toEqual(['smile-sparkles', 'fist-beam']);
  });
  it('every preset survives the booth trigger validator unchanged', () => {
    const all = powerUpTriggers(powerUpsConfig(POWER_UP_PRESETS.map((p) => p.id)));
    expect(all).toHaveLength(POWER_UP_PRESETS.length);
    expect(parseTriggers(all)).toEqual(all);
    expect(new Set(all.map((t) => t.id)).size).toBe(all.length);
    for (const t of all) expect(t.id.startsWith('event-pu:')).toBe(true);
  });
  it('toggles', () => {
    const on = togglePowerUp([], 'peace-hearts');
    expect(on).toEqual(['peace-hearts']);
    expect(togglePowerUp(on, 'peace-hearts')).toEqual([]);
  });
});
