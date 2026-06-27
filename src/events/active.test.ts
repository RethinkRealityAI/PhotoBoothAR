import { describe, it, expect } from 'vitest';
import { resolveEventId, DEFAULT_EVENT_ID } from './eventId';
import { getEventConfig } from './registry';
import { BORDER_MAP } from '../lib/borders';

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

describe('detola-wuyi wedding event', () => {
  it('is registered with the expected identity', () => {
    const cfg = getEventConfig('detola-wuyi');
    expect(cfg.id).toBe('detola-wuyi');
    expect(cfg.landingRoute).toBe('/booth');
    expect(cfg.accentHexes[0]).toBe('#D4AF37'); // gold accent
    expect(cfg.copy.eventName).toBe('Detola & Wuyi');
  });

  it('pins only its own / neutral frames — no gala-branded borders leak in', () => {
    const ids = getEventConfig('detola-wuyi').arContent.borderIds ?? [];
    expect(ids.length).toBeGreaterThan(0);
    // every pinned border exists in the registry
    expect(ids.every((id) => id in BORDER_MAP)).toBe(true);
    // none of the SCAGO/Hope-Gala branded frames are exposed
    for (const galaId of ['frame-classic', 'sticker-hopegala', 'sticker-hopegala-top', 'frame-deco']) {
      expect(ids).not.toContain(galaId);
    }
  });
});
