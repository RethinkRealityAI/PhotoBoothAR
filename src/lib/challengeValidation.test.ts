import { describe, it, expect } from 'vitest';
import { normalizeValidation, challengeNeedsCheck } from './challengeValidation';
import type { Challenge } from '../types';

describe('normalizeValidation', () => {
  it('returns null when disabled', () => {
    expect(normalizeValidation({ enabled: false, prompt: 'someone in red' })).toBeNull();
  });

  it('returns null when enabled but the prompt is blank', () => {
    expect(normalizeValidation({ enabled: true, prompt: '   ' })).toBeNull();
    expect(normalizeValidation({ enabled: true })).toBeNull();
  });

  it('builds a clean config when enabled with a prompt', () => {
    expect(normalizeValidation({ enabled: true, prompt: '  someone wearing red  ' })).toEqual({
      enabled: true,
      prompt: 'someone wearing red',
      referenceImageUrl: null,
    });
  });

  it('keeps a reference url and trims it', () => {
    const v = normalizeValidation({ enabled: true, prompt: 'red', referenceImageUrl: '  https://x/y.png ' });
    expect(v?.referenceImageUrl).toBe('https://x/y.png');
  });

  it('caps the prompt length', () => {
    const v = normalizeValidation({ enabled: true, prompt: 'x'.repeat(900) });
    expect(v?.prompt.length).toBe(500);
  });

  it('is null for junk input', () => {
    expect(normalizeValidation(null)).toBeNull();
    expect(normalizeValidation('nope')).toBeNull();
    expect(normalizeValidation({ prompt: 'red' })).toBeNull(); // no enabled
  });
});

describe('challengeNeedsCheck', () => {
  const base: Challenge = {
    id: 'c1', created_at: '', title: 'T', description: null, emoji: '⭐',
    points: 10, sort_order: 0, active: true,
  };

  it('false when no validation', () => {
    expect(challengeNeedsCheck(base)).toBe(false);
    expect(challengeNeedsCheck({ ...base, validation: null })).toBe(false);
    expect(challengeNeedsCheck(null)).toBe(false);
    expect(challengeNeedsCheck(undefined)).toBe(false);
  });

  it('false when disabled or prompt empty', () => {
    expect(challengeNeedsCheck({ ...base, validation: { enabled: false, prompt: 'red' } })).toBe(false);
    expect(challengeNeedsCheck({ ...base, validation: { enabled: true, prompt: '  ' } })).toBe(false);
  });

  it('true when enabled with a prompt', () => {
    expect(challengeNeedsCheck({ ...base, validation: { enabled: true, prompt: 'someone in red' } })).toBe(true);
  });
});
