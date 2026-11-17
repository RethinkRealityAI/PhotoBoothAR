import { describe, it, expect } from 'vitest';
import { claimInference, createInferenceToken, frameClaimed, frameClock } from './inferenceToken';

describe('per-frame inference token', () => {
  it('grants exactly one inference per frame, whoever asks first', () => {
    const tok = createInferenceToken();
    expect(claimInference(tok, 16.6, 'face')).toBe(true);
    expect(claimInference(tok, 16.6, 'hand')).toBe(false);
    expect(claimInference(tok, 16.6, 'face')).toBe(false); // the same owner does not get a second one either
    expect(tok.owner).toBe('face');
  });

  it('a new frame is a fresh grant', () => {
    const tok = createInferenceToken();
    claimInference(tok, 100, 'hand');
    expect(claimInference(tok, 116.7, 'face')).toBe(true);
    expect(tok.owner).toBe('face');
    expect(claimInference(tok, 116.7, 'hand')).toBe(false);
  });

  it('the inference DURATION is irrelevant — the 10ms-from-start lockout failure cannot recur', () => {
    // Old failure: face started at t=0 and took 40ms; the hand checked at t=41
    // (same frame), saw 41ms > 10ms since "last face detect", and ran too.
    const tok = createInferenceToken();
    const frame = 1000;
    expect(claimInference(tok, frame, 'face')).toBe(true);
    // ...40ms of inference later, still inside the same rendering update:
    expect(claimInference(tok, frame, 'hand')).toBe(false);
  });

  it('a missing frame clock never blocks inference (no clock must not mean no tracking)', () => {
    const tok = createInferenceToken();
    expect(claimInference(tok, Number.NaN, 'face')).toBe(true);
    expect(claimInference(tok, Number.NaN, 'hand')).toBe(true);
    expect(frameClaimed(tok, Number.NaN)).toBe(false);
  });

  it('frameClaimed reports without claiming', () => {
    const tok = createInferenceToken();
    expect(frameClaimed(tok, 5)).toBe(false);
    claimInference(tok, 5, 'face');
    expect(frameClaimed(tok, 5)).toBe(true);
    expect(frameClaimed(tok, 6)).toBe(false);
  });

  it('frameClock is NaN outside a browser', () => {
    expect(Number.isNaN(frameClock())).toBe(true);
  });
});
