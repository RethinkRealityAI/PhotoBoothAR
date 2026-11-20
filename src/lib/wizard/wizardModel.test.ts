import { describe, expect, it } from 'vitest';
import {
  COUNTED_STEPS, WIZARD_STEP_IDS, completeStep, countDone, nextStepId, normalizeWizardProgress, prevStepId,
  progressFraction, resumeStep, setupChip, setupInProgress, setupPath, startProgress, visitStep,
} from './wizardModel';

const NOW = '2026-11-20T10:00:00.000Z';

describe('wizard step order', () => {
  it('runs basics → launch with launch excluded from the count', () => {
    expect(WIZARD_STEP_IDS[0]).toBe('basics');
    expect(WIZARD_STEP_IDS.at(-1)).toBe('launch');
    expect(COUNTED_STEPS).not.toContain('launch');
    expect(nextStepId('basics')).toBe('invite');
    expect(nextStepId('launch')).toBeNull();
    expect(prevStepId('basics')).toBeNull();
    expect(prevStepId('invite')).toBe('basics');
  });
});

describe('normalizeWizardProgress', () => {
  it('is total on junk', () => {
    for (const junk of [null, undefined, 1, 'x', [], {}, { v: 2 }]) expect(normalizeWizardProgress(junk)).toBeNull();
  });
  it('drops unknown and duplicate steps and bad dates', () => {
    expect(normalizeWizardProgress({ v: 1, step: 'nope', done: ['basics', 'basics', 'zzz', 3], startedAt: 'yesterday' }))
      .toEqual({ v: 1, step: 'basics', done: ['basics'] });
  });
  it('round-trips a real record', () => {
    const p = { ...startProgress(NOW), completedAt: NOW };
    expect(normalizeWizardProgress(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
});

describe('progress', () => {
  it('starts with basics done, on the welcome page', () => {
    const p = startProgress(NOW);
    expect(resumeStep(p)).toBe('invite');
    expect(countDone(p)).toEqual({ done: 1, total: COUNTED_STEPS.length });
  });
  it('completing moves the pointer and never duplicates', () => {
    let p = completeStep(startProgress(NOW), 'invite', NOW);
    p = completeStep(p, 'invite', NOW);
    expect(p.done).toEqual(['basics', 'invite']);
    expect(p.step).toBe('booth');
  });
  it('visiting does not finish anything', () => {
    const p = visitStep(startProgress(NOW), 'looks', NOW);
    expect(p.step).toBe('looks');
    expect(p.done).toEqual(['basics']);
    expect(resumeStep(p)).toBe('looks');
  });
  it('resumes on the first unfinished step when the pointer is on a done one', () => {
    const p = { ...completeStep(startProgress(NOW), 'invite', NOW), step: 'basics' as const };
    expect(resumeStep(p)).toBe('booth');
  });
  it('finishing launch completes the wizard', () => {
    let p = startProgress(NOW);
    for (const id of WIZARD_STEP_IDS.slice(1)) p = completeStep(p, id, NOW);
    expect(p.completedAt).toBe(NOW);
    expect(progressFraction(p)).toBe(1);
    expect(resumeStep(p)).toBe('launch');
    expect(setupInProgress({ wizard: p })).toBe(false);
  });
});

describe('dashboard chip', () => {
  it('shows only for events mid-setup', () => {
    expect(setupChip({})).toBeNull();
    expect(setupChip(null)).toBeNull();
    expect(setupChip({ wizard: startProgress(NOW) })).toEqual({ label: 'Welcome page', step: 'invite', done: 1, total: 6 });
  });
  it('builds the route', () => {
    expect(setupPath('abc')).toBe('/host/setup/abc');
    expect(setupPath('abc', 'looks')).toBe('/host/setup/abc/looks');
  });
});

import { formatEventDate, initialEventConfig, slugProblem, ymdFromIso, OCCASIONS } from './occasions';
import { normalizeScene } from '../sceneThemes';

describe('new event seed', () => {
  it('every occasion seeds a valid welcome scene, the brand look and step-1 progress', () => {
    for (const o of OCCASIONS) {
      const cfg = initialEventConfig(o.id, 'Ada & Tolu', NOW);
      expect(normalizeScene(cfg.scene), o.id).toEqual({ kind: 'template', id: o.sceneId });
      expect(cfg.look).toBe('beamwall');
      expect(cfg).not.toHaveProperty('themeVars');
      expect(cfg.landingRoute).toBe('/welcome');
      expect(normalizeWizardProgress(cfg.wizard)?.done).toEqual(['basics']);
    }
  });
  it('checks links and formats dates without a timezone shift', () => {
    expect(slugProblem('')).toMatch(/Pick/);
    expect(slugProblem('Bad Link')).toMatch(/lowercase/);
    expect(slugProblem('ada-tolu-2026')).toBeNull();
    expect(formatEventDate('2026-12-24')).toMatch(/24 December 2026/);
    expect(formatEventDate('nope')).toBeNull();
    expect(ymdFromIso(new Date(2026, 11, 24).toISOString())).toBe('2026-12-24');
  });
});
