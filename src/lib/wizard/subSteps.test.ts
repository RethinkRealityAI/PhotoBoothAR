import { describe, expect, it } from 'vitest';
import {
  POWERUPS_SUBSTEPS, STEP_ORGANISATION, WALL_SUBSTEPS, WELCOME_SUBSTEPS, initialSubStepSeen, markSubStepSeen,
  subStepForKey, subStepLabel, subStepMode, subStepNav, subStepPosition, subStepReachable,
} from './subSteps';
import { WIZARD_STEP_IDS } from './wizardModel';

const ids = WELCOME_SUBSTEPS.map((s) => s.id);

describe('step organisation', () => {
  it('classifies every wizard step', () => {
    expect(Object.keys(STEP_ORGANISATION).sort()).toEqual([...WIZARD_STEP_IDS].sort());
  });
  it('guided steps carry their sub-steps; others do not', () => {
    for (const id of WIZARD_STEP_IDS) {
      const c = STEP_ORGANISATION[id];
      expect(c.why.length, id).toBeGreaterThan(10);
      if (c.kind === 'guided') expect(c.subSteps?.length, id).toBeGreaterThan(1);
      else expect(c.subSteps, id).toBeUndefined();
    }
  });
  it('keeps the owner-named splits', () => {
    expect(STEP_ORGANISATION.invite.kind).toBe('guided');
    expect(STEP_ORGANISATION.booth.kind).toBe('guided');
    expect(STEP_ORGANISATION.looks.kind).toBe('filter-tabs');
    expect(STEP_ORGANISATION.keepsake.kind).toBe('own-guided');
  });
  it('sub-step ids are unique per step and every one has a hint', () => {
    for (const list of [WELCOME_SUBSTEPS, POWERUPS_SUBSTEPS, WALL_SUBSTEPS]) {
      expect(new Set(list.map((s) => s.id)).size).toBe(list.length);
      for (const s of list) expect(s.hint.length).toBeGreaterThan(5);
    }
  });
});

describe('guided vs free', () => {
  it('a step not finished yet is guided from its first sub-step', () => {
    const mode = subStepMode(ids, false, []);
    expect(mode).toBe('guided');
    expect(initialSubStepSeen(ids, mode)).toEqual(['background']);
  });
  it('a step finished before opens free with everything seen', () => {
    const mode = subStepMode(ids, true, []);
    expect(mode).toBe('free');
    expect(initialSubStepSeen(ids, mode)).toEqual(ids);
  });
  it('everything already seen also means free', () => {
    expect(subStepMode(ids, false, ids)).toBe('free');
    expect(subStepMode([], false, [])).toBe('guided');
  });
  it('cannot skip ahead while guided, can go back; free reaches anything', () => {
    const seen = ['background'] as const;
    expect(subStepReachable('background', seen, 'guided')).toBe(true);
    expect(subStepReachable('words', seen, 'guided')).toBe(false);
    expect(subStepReachable('words', seen, 'free')).toBe(true);
  });
  it('marks seen in order, ignores repeats and unknown ids', () => {
    const a = markSubStepSeen(ids, ['background'], 'words');
    expect(a).toEqual(['background', 'words']);
    expect(markSubStepSeen(ids, a, 'border')).toEqual(['background', 'border', 'words']);
    expect(markSubStepSeen(ids, a, 'words')).toBe(a);
    expect(markSubStepSeen(ids, a, 'nope' as never)).toBe(a);
  });
});

describe('navigation', () => {
  it('Back / Next without wrapping', () => {
    expect(subStepNav(ids, 'background')).toEqual({ prev: null, next: 'border' });
    expect(subStepNav(ids, 'border')).toEqual({ prev: 'background', next: 'words' });
    expect(subStepNav(ids, 'words')).toEqual({ prev: 'border', next: null });
  });
  it('position and labels', () => {
    expect(subStepPosition(ids, 'border')).toEqual({ number: 2, total: 3 });
    expect(subStepLabel(WELCOME_SUBSTEPS, 'words')).toBe('Words');
    expect(subStepLabel(WELCOME_SUBSTEPS, 'x')).toBe('');
  });
  it('arrow keys wrap, Home / End jump, other keys are not ours', () => {
    expect(subStepForKey(ids, 'words', 'ArrowRight')).toBe('background');
    expect(subStepForKey(ids, 'background', 'ArrowLeft')).toBe('words');
    expect(subStepForKey(ids, 'border', 'End')).toBe('words');
    expect(subStepForKey(ids, 'border', 'Home')).toBe('background');
    expect(subStepForKey(ids, 'border', 'a')).toBeNull();
  });
});
