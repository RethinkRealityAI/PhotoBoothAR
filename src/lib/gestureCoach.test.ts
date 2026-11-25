import { describe, it, expect } from 'vitest';
import { gestureCoachFor, coachResult, COACH_DO, COACH_GLYPH, COACH_MAX_STEPS } from './gestureCoach';
import { TRIGGER_SOURCES, type TriggerConfig } from './studio/triggers';

const t = (id: string, source: TriggerConfig['source'], action: TriggerConfig['action']): TriggerConfig => ({ id, source, action });

describe('gestureCoachFor', () => {
  it('is null for a Look that reacts to nothing', () => {
    expect(gestureCoachFor([])).toBeNull();
  });

  it('names what to do AND what happens', () => {
    const c = gestureCoachFor([t('a', 'mouthOpen', { type: 'burst', style: 'hearts' })])!;
    expect(c.steps).toEqual([{ source: 'mouthOpen', glyph: '😮', doThis: 'Open your mouth wide', result: 'Hearts burst out' }]);
    expect(c.title).toBe('Try this');
    expect(c.needsHand).toBe(false);
  });

  it('flags hand gestures so the card can ask for a hand in view', () => {
    const c = gestureCoachFor([t('a', 'peaceSign', { type: 'burst', style: 'sparkles' })])!;
    expect(c.needsHand).toBe(true);
    expect(c.title).toBe('Try this gesture');
  });

  it('one row per gesture, first action wins, authored order, capped', () => {
    const c = gestureCoachFor([
      t('a', 'smile', { type: 'burst', style: 'confetti' }),
      t('b', 'smile', { type: 'burst', style: 'hearts' }),
      t('c', 'palmOpen', { type: 'beam', style: 'optic' }),
      t('d', 'wink', { type: 'reveal', objectId: 'x' }),
      t('e', 'pinch', { type: 'filterPulse' }),
    ])!;
    expect(c.steps.map((s) => s.source)).toEqual(['smile', 'palmOpen', 'wink']);
    expect(c.steps).toHaveLength(COACH_MAX_STEPS);
    expect(c.steps[0].result).toBe('Confetti pops');
    expect(c.steps[1].result).toBe('Fire an optic blast');
    expect(c.title).toBe('This Look reacts to you');
  });

  it('the key changes with the gestures, not with trigger ids', () => {
    const a = gestureCoachFor([t('a', 'smile', { type: 'burst', style: 'confetti' })])!;
    const b = gestureCoachFor([t('zz', 'smile', { type: 'burst', style: 'confetti' })])!;
    const c = gestureCoachFor([t('a', 'smile', { type: 'burst', style: 'hearts' })])!;
    expect(a.key).toBe(b.key);
    expect(a.key).not.toBe(c.key);
  });
});

describe('coach copy coverage', () => {
  it('every trigger source has an instruction and a glyph', () => {
    for (const s of TRIGGER_SOURCES) {
      expect(COACH_DO[s]).toMatch(/\S/);
      expect(COACH_GLYPH[s]).toMatch(/\S/);
    }
  });
  it('every action type has a result line', () => {
    expect(coachResult({ type: 'beam', style: 'lightning' })).toBe('Fire a lightning arc');
    expect(coachResult({ type: 'animate', objectId: 'x', preset: 'spin' })).toBe('Your prop spins');
    expect(coachResult({ type: 'burst', style: 'fireworks' })).toBe('Fireworks go off');
  });
});
