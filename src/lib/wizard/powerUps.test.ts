import { describe, expect, it } from 'vitest';
import { parseTriggers } from '../studio/triggers';
import { POWER_UP_PRESETS, normalizePowerUps, offeredPowerUpPresets, powerUpTriggers, powerUpsConfig, togglePowerUp } from './powerUps';
import { GUEST_HAND_TRACKING } from '../handPose';

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

describe('offeredPowerUpPresets', () => {
  it('offers face gestures only while guest booths do not track hands', () => {
    const off = offeredPowerUpPresets(false);
    expect(off.length).toBeGreaterThan(0);
    expect(off.every((p) => !p.usesHands)).toBe(true);
    expect(off.map((p) => p.id)).toEqual(['smile-sparkles', 'mouth-confetti']);
  });

  it('offers every gesture when hand tracking is on', () => {
    expect(offeredPowerUpPresets(true)).toEqual(POWER_UP_PRESETS);
  });

  it('guest booths ship with hand tracking off', () => {
    expect(GUEST_HAND_TRACKING).toBe(false);
    expect(offeredPowerUpPresets()).toEqual(offeredPowerUpPresets(false));
  });
});
