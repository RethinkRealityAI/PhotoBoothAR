import { describe, it, expect } from 'vitest';
import { resolveEventId, DEFAULT_EVENT_ID } from './eventId';
import { getEventConfig } from './registry';

describe('resolveEventId', () => {
  it('falls back to the default when env is missing or blank', () => {
    expect(resolveEventId(undefined)).toBe(DEFAULT_EVENT_ID);
    expect(resolveEventId('')).toBe(DEFAULT_EVENT_ID);
    expect(resolveEventId('   ')).toBe(DEFAULT_EVENT_ID);
  });
  it('uses a provided slug verbatim', () => {
    expect(resolveEventId('jenna-jake')).toBe('jenna-jake');
  });
});

describe('getEventConfig', () => {
  it('returns the requested event when registered', () => {
    expect(getEventConfig('hope-gala').id).toBe('hope-gala');
  });
  it('falls back to the default event for an unknown slug', () => {
    expect(getEventConfig('does-not-exist').id).toBe(DEFAULT_EVENT_ID);
  });
});
