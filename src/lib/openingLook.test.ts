import { describe, expect, it } from 'vitest';
import { effectiveOpeningLookId, openingLookErrorCopy, openingLookStores } from './openingLook';

describe('effectiveOpeningLookId', () => {
  it('the wall value wins over events.config (the booth order)', () => {
    expect(effectiveOpeningLookId('prop-1', 'builtin:border:gold')).toBe('prop-1');
  });

  it('falls back to events.config when the wall has none', () => {
    expect(effectiveOpeningLookId(null, 'builtin:border:gold')).toBe('builtin:border:gold');
    expect(effectiveOpeningLookId(undefined, 'ai-frame')).toBe('ai-frame');
  });

  it('a route id beats both stores', () => {
    expect(effectiveOpeningLookId('prop-1', 'ai-frame', 'linked-exp')).toBe('linked-exp');
    expect(effectiveOpeningLookId('prop-1', 'ai-frame', null)).toBe('prop-1');
  });

  it('keeps Booth.tsx `??` semantics: a string (even empty) wins, a non-string is absent', () => {
    expect(effectiveOpeningLookId('', 'ai-frame')).toBe('');
    expect(effectiveOpeningLookId(42, 'ai-frame')).toBe('ai-frame');
    expect(effectiveOpeningLookId({ id: 'x' }, undefined)).toBeNull();
    expect(effectiveOpeningLookId(null, null)).toBeNull();
  });

  it('the reproduced disagreement cannot survive one writer: both stores equal → same answer either way', () => {
    // Before: copilot pinned a prop (wall + config), then "Use as booth frame"
    // wrote config only → the booth still opened on the prop.
    const before = effectiveOpeningLookId('prop-1', 'ai-frame');
    expect(before).toBe('prop-1');
    // After: the one writer puts the frame in every store.
    expect(effectiveOpeningLookId('ai-frame', 'ai-frame')).toBe('ai-frame');
  });
});

describe('openingLookStores', () => {
  it('platform events write config, then the wall', () => {
    expect(openingLookStores({ slug: 'my-party', eventUuid: '0b3758ef-b6fd-48de-848e-c46e04f05fd0' })).toEqual(['config', 'wall']);
  });

  it('legacy (coded) events have no events row — wall only, as before', () => {
    expect(openingLookStores({ slug: 'hope-gala', eventUuid: null })).toEqual(['wall']);
    expect(openingLookStores({ slug: 'hope-gala', eventUuid: '' })).toEqual(['wall']);
  });
});

describe('openingLookErrorCopy', () => {
  it('says honestly what state a failed write left', () => {
    expect(openingLookErrorCopy('config')).toMatch(/nothing was changed/);
    expect(openingLookErrorCopy('wall')).toMatch(/may still open with the old one/);
    // A failure outside the opening-look writes keeps the picker's old line.
    expect(openingLookErrorCopy(null)).toBe('Couldn’t save. Check your connection and try again.');
  });
});
