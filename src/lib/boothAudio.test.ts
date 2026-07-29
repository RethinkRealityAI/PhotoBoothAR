import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cueSpec, soundEnabled, setSoundEnabled, resetSoundCache, playCue, primeAudio, type CueKind } from './boothAudio';

const KINDS: CueKind[] = ['tick', 'tickFinal', 'shutter', 'success'];

describe('cueSpec', () => {
  it('describes every cue kind', () => {
    for (const k of KINDS) expect(cueSpec(k)).toBeTruthy();
  });

  it('keeps every cue short enough to read as physical, not as a malfunction', () => {
    for (const k of KINDS) {
      const s = cueSpec(k);
      expect(s.durationSec).toBeGreaterThan(0);
      expect(s.durationSec).toBeLessThanOrEqual(0.3);
    }
  });

  it('keeps gain well below unity — a booth usually sits next to a PA', () => {
    for (const k of KINDS) {
      const s = cueSpec(k);
      expect(s.gain).toBeGreaterThan(0);
      expect(s.gain).toBeLessThanOrEqual(0.25);
    }
  });

  it('uses positive frequencies so the exponential ramp is legal', () => {
    // exponentialRampToValueAtTime throws on a zero/negative target.
    for (const k of KINDS) {
      const s = cueSpec(k);
      expect(s.freq).toBeGreaterThan(0);
      expect(s.endFreq).toBeGreaterThan(0);
    }
  });

  it('makes the final tick brighter than an ordinary one', () => {
    expect(cueSpec('tickFinal').freq).toBeGreaterThan(cueSpec('tick').freq);
  });

  it('is pure — repeated calls return equal specs', () => {
    expect(cueSpec('shutter')).toEqual(cueSpec('shutter'));
  });
});

describe('sound preference', () => {
  beforeEach(() => {
    resetSoundCache();
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetSoundCache();
  });

  it('defaults to on', () => {
    expect(soundEnabled()).toBe(true);
  });

  it('round-trips an explicit mute', () => {
    setSoundEnabled(false);
    resetSoundCache();
    expect(soundEnabled()).toBe(false);
  });

  it('round-trips an explicit unmute', () => {
    setSoundEnabled(false);
    setSoundEnabled(true);
    resetSoundCache();
    expect(soundEnabled()).toBe(true);
  });

  it('defaults to on when storage throws (private mode)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    });
    resetSoundCache();
    expect(soundEnabled()).toBe(true);
    expect(() => setSoundEnabled(false)).not.toThrow();
  });
});

describe('playCue / primeAudio without WebAudio', () => {
  // The vitest node env has no window and no AudioContext at all — which is
  // exactly the "audio is unavailable" path a locked-down browser takes.
  it('never throws when there is no window', () => {
    for (const k of KINDS) expect(() => playCue(k)).not.toThrow();
    expect(() => primeAudio()).not.toThrow();
  });
});
