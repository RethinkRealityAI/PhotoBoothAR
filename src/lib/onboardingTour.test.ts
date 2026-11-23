import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_TOUR,
  TOUR_METADATA_KEY,
  availableSteps,
  clampStep,
  isLastStep,
  nextStep,
  parseTourOutcome,
  placePopover,
  prevStep,
  shouldShowTour,
  stepLabel,
  tourOutcomeFromMetadata,
} from './onboardingTour';

describe('DASHBOARD_TOUR', () => {
  it('has the three stops in order with the approved copy', () => {
    expect(DASHBOARD_TOUR.map((s) => s.target)).toEqual(['share', 'manage', 'assistant']);
    expect(DASHBOARD_TOUR[0].body).toBe('Share the QR: print it or put it on screens. Guests need no app.');
    expect(DASHBOARD_TOUR[1].body).toBe('Change looks, challenges and the live wall any time, even during the event.');
    expect(DASHBOARD_TOUR[2].body).toBe('Ask Beamy to change anything in plain words.');
  });
});

describe('outcome parsing', () => {
  it('accepts only done/skipped', () => {
    expect(parseTourOutcome('done')).toBe('done');
    expect(parseTourOutcome('skipped')).toBe('skipped');
    expect(parseTourOutcome(null)).toBeNull();
    expect(parseTourOutcome('')).toBeNull();
    expect(parseTourOutcome('Done')).toBeNull();
    expect(parseTourOutcome(0)).toBeNull();
  });
  it('reads the metadata key, tolerating junk metadata', () => {
    expect(tourOutcomeFromMetadata({ [TOUR_METADATA_KEY]: 'done' })).toBe('done');
    expect(tourOutcomeFromMetadata({ [TOUR_METADATA_KEY]: null })).toBeNull();
    expect(tourOutcomeFromMetadata({})).toBeNull();
    expect(tourOutcomeFromMetadata(null)).toBeNull();
    expect(tourOutcomeFromMetadata(undefined)).toBeNull();
    expect(tourOutcomeFromMetadata('done')).toBeNull();
  });
});

describe('shouldShowTour', () => {
  const base = { metadataOutcome: null, cachedOutcome: null } as const;
  it('needs at least one live event', () => {
    expect(shouldShowTour({ ...base, eventStatuses: [] })).toBe(false);
    expect(shouldShowTour({ ...base, eventStatuses: ['draft', 'ended', 'archived'] })).toBe(false);
    expect(shouldShowTour({ ...base, eventStatuses: ['draft', 'live'] })).toBe(true);
  });
  it('never shows again once finished or skipped, from either store', () => {
    expect(shouldShowTour({ eventStatuses: ['live'], metadataOutcome: 'done', cachedOutcome: null })).toBe(false);
    expect(shouldShowTour({ eventStatuses: ['live'], metadataOutcome: 'skipped', cachedOutcome: null })).toBe(false);
    expect(shouldShowTour({ eventStatuses: ['live'], metadataOutcome: null, cachedOutcome: 'skipped' })).toBe(false);
  });
});

describe('step navigation', () => {
  it('clamps into range', () => {
    expect(clampStep(-1, 3)).toBe(0);
    expect(clampStep(5, 3)).toBe(2);
    expect(clampStep(1, 3)).toBe(1);
    expect(clampStep(2, 0)).toBe(0);
    expect(clampStep(Number.NaN, 3)).toBe(0);
  });
  it('next/prev stop at the ends', () => {
    expect(nextStep(0, 3)).toBe(1);
    expect(nextStep(2, 3)).toBe(2);
    expect(prevStep(0, 3)).toBe(0);
    expect(prevStep(2, 3)).toBe(1);
  });
  it('knows the last step and labels it', () => {
    expect(isLastStep(2, 3)).toBe(true);
    expect(isLastStep(1, 3)).toBe(false);
    expect(isLastStep(0, 0)).toBe(false);
    expect(isLastStep(0, 1)).toBe(true);
    expect(stepLabel(0, 3)).toBe('Step 1 of 3');
    expect(stepLabel(9, 2)).toBe('Step 2 of 2');
  });
});

describe('availableSteps', () => {
  it('drops stops whose target is missing (e.g. no assistant button)', () => {
    const present = new Set(['share', 'manage']);
    expect(availableSteps(DASHBOARD_TOUR, (t) => present.has(t)).map((s) => s.target)).toEqual(['share', 'manage']);
    expect(availableSteps(DASHBOARD_TOUR, () => false)).toEqual([]);
  });
});

describe('placePopover', () => {
  const phone = { width: 390, height: 844 };
  it('keeps 16px gutters and shrinks to fit a 390px phone', () => {
    const p = placePopover({ top: 100, left: 0, width: 40, height: 40 }, { width: 400, height: 180 }, phone);
    expect(p.width).toBe(358);
    expect(p.left).toBe(16);
    expect(p.left + p.width).toBeLessThanOrEqual(phone.width - 16);
    expect(p.side).toBe('below');
    expect(p.top).toBe(152);
  });
  it('clamps a right-edge target inside the viewport', () => {
    const p = placePopover({ top: 300, left: 340, width: 50, height: 50 }, { width: 300, height: 160 }, phone);
    expect(p.left + p.width).toBe(phone.width - 16);
  });
  it('flips above when there is no room below', () => {
    const p = placePopover({ top: 760, left: 300, width: 56, height: 56 }, { width: 320, height: 180 }, phone);
    expect(p.side).toBe('above');
    expect(p.top).toBe(760 - 12 - 180);
  });
  it('stays on screen when it fits neither side', () => {
    const p = placePopover({ top: 0, left: 0, width: 390, height: 800 }, { width: 320, height: 200 }, phone);
    expect(p.top).toBeGreaterThanOrEqual(16);
    expect(p.top + 200).toBeLessThanOrEqual(phone.height - 16);
  });
});
