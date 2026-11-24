import { describe, it, expect } from 'vitest';
import {
  AUDIO_SYNC_DEADBAND_MS,
  AUDIO_SYNC_MAX_MS,
  AUDIO_SYNC_SLEW_MS_PER_S,
  AUDIO_HOP_FALLBACK_MS,
  audioDelayForPicture,
  audioHopMs,
  audioSyncDefaultOn,
  createAudioSync,
  getAudioSyncStatus,
  parseAvSyncUrl,
  planDelayChange,
} from './audioSync';

describe('audioDelayForPicture', () => {
  it('delays the sound by the picture age', () => {
    expect(audioDelayForPicture(180)).toBe(180);
  });
  it('is 0 when the age is unknown', () => {
    expect(audioDelayForPicture(null)).toBe(0);
    expect(audioDelayForPicture(Number.NaN)).toBe(0);
  });
  it('applies the trim and clamps to the DelayNode range', () => {
    expect(audioDelayForPicture(180, 40)).toBe(220);
    expect(audioDelayForPicture(30, -100)).toBe(0);
    expect(audioDelayForPicture(5000)).toBe(AUDIO_SYNC_MAX_MS);
    expect(audioDelayForPicture(180, Number.NaN)).toBe(180);
  });
});

describe('audioHopMs', () => {
  it('is the context render buffer, in ms', () => {
    expect(audioHopMs(0.02)).toBeCloseTo(20, 5);
    expect(audioHopMs(0.0427)).toBeCloseTo(42.7, 5);
  });
  it('falls back when the context does not report one, and caps a silly value', () => {
    expect(audioHopMs(undefined)).toBe(AUDIO_HOP_FALLBACK_MS);
    expect(audioHopMs(0)).toBe(AUDIO_HOP_FALLBACK_MS);
    expect(audioHopMs(Number.NaN)).toBe(AUDIO_HOP_FALLBACK_MS);
    expect(audioHopMs(3)).toBe(150);
  });
});

describe('planDelayChange', () => {
  it('follows freely before a recording, ignoring noise', () => {
    expect(planDelayChange(100, 103, false)).toBeNull();
    expect(planDelayChange(100, 180, false)).toEqual({ targetMs: 180, rampSec: 0 });
  });
  it('holds inside the deadband while recording', () => {
    expect(planDelayChange(150, 150 + AUDIO_SYNC_DEADBAND_MS, true)).toBeNull();
    expect(planDelayChange(150, 150 - AUDIO_SYNC_DEADBAND_MS, true)).toBeNull();
  });
  it('glides at the slew limit while recording (never a jump)', () => {
    const p = planDelayChange(100, 300, true);
    expect(p).toEqual({ targetMs: 300, rampSec: 200 / AUDIO_SYNC_SLEW_MS_PER_S });
    expect(planDelayChange(300, 100, true)?.rampSec).toBe(200 / AUDIO_SYNC_SLEW_MS_PER_S);
  });
  it('does nothing on a non-finite input', () => {
    expect(planDelayChange(Number.NaN, 100, true)).toBeNull();
    expect(planDelayChange(100, Number.NaN, false)).toBeNull();
  });
});

describe('parseAvSyncUrl', () => {
  it('defaults when absent', () => {
    expect(parseAvSyncUrl('')).toEqual({ enabled: null, trimMs: 0 });
    expect(parseAvSyncUrl('?trackdebug')).toEqual({ enabled: null, trimMs: 0 });
  });
  it('reads the switch', () => {
    expect(parseAvSyncUrl('?avsync=0').enabled).toBe(false);
    expect(parseAvSyncUrl('?avsync=off').enabled).toBe(false);
    expect(parseAvSyncUrl('?avsync=1').enabled).toBe(true);
    expect(parseAvSyncUrl('?avsync=banana').enabled).toBeNull();
  });
  it('reads a signed trim and rejects nonsense', () => {
    expect(parseAvSyncUrl('?avtrim=60').trimMs).toBe(60);
    expect(parseAvSyncUrl('?avtrim=-40.4').trimMs).toBe(-40);
    expect(parseAvSyncUrl('?avtrim=abc').trimMs).toBe(0);
    expect(parseAvSyncUrl('?avtrim=99999').trimMs).toBe(0);
    expect(parseAvSyncUrl('?avtrim=').trimMs).toBe(0);
  });
});

describe('audioSyncDefaultOn', () => {
  it('is on for Android and desktop Chrome', () => {
    expect(audioSyncDefaultOn('Mozilla/5.0 (Linux; Android 14; SM-F946B) Chrome/130.0 Mobile Safari/537.36', 5)).toBe(true);
    expect(audioSyncDefaultOn('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0 Safari/537.36', 0)).toBe(true);
  });
  it('is off for iPhone and for iPadOS posing as a Mac', () => {
    expect(audioSyncDefaultOn('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1', 5)).toBe(false);
    expect(audioSyncDefaultOn('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15', 5)).toBe(false);
  });
});

describe('createAudioSync', () => {
  it('returns null (raw microphone) where Web Audio does not exist', () => {
    expect(createAudioSync({ id: 'm' } as MediaStreamTrack, 100)).toBeNull();
    expect(getAudioSyncStatus()).toBeNull();
  });
});
