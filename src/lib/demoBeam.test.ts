import { describe, it, expect } from 'vitest';
import {
  makeBeamChannelId, isLocalChannel, isValidChannelId, beamPagePath,
  fitWithin, makeShotPayload, parseShotPayload, MAX_SHOT_CHARS,
} from './demoBeam';

describe('makeBeamChannelId / isLocalChannel / isValidChannelId', () => {
  it('mints valid remote ids', () => {
    const id = makeBeamChannelId(false);
    expect(isValidChannelId(id)).toBe(true);
    expect(isLocalChannel(id)).toBe(false);
  });

  it('mints valid local ids with the L prefix', () => {
    const id = makeBeamChannelId(true);
    expect(isValidChannelId(id)).toBe(true);
    expect(isLocalChannel(id)).toBe(true);
  });

  it('mints distinct ids', () => {
    expect(makeBeamChannelId(false)).not.toBe(makeBeamChannelId(false));
  });

  it('rejects malformed ids', () => {
    for (const bad of ['', 'L', 'x0123456789', 'r0123456789ab', 'r01234567zz', 'L0123456789 ', '../etc']) {
      expect(isValidChannelId(bad)).toBe(false);
    }
  });
});

describe('beamPagePath', () => {
  it('builds the phone page path', () => {
    expect(beamPagePath('rabcdef0123')).toBe('/beam/rabcdef0123');
  });
});

describe('fitWithin', () => {
  it('never upscales', () => {
    expect(fitWithin(300, 400, 1000, 1000)).toEqual({ width: 300, height: 400 });
  });

  it('scales portrait down by width', () => {
    expect(fitWithin(1080, 1920, 540, 10_000)).toEqual({ width: 540, height: 960 });
  });

  it('scales landscape down by height', () => {
    expect(fitWithin(1920, 1080, 10_000, 540)).toEqual({ width: 960, height: 540 });
  });

  it('guards zero/negative dimensions', () => {
    expect(fitWithin(0, 100, 500, 500)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(-5, 100, 500, 500)).toEqual({ width: 0, height: 0 });
  });
});

describe('shot payload round trip', () => {
  const shot = 'data:image/jpeg;base64,abc123';

  it('round-trips a valid payload', () => {
    expect(parseShotPayload(makeShotPayload(shot))).toBe(shot);
  });

  it('rejects wrong version, shape, and types', () => {
    expect(parseShotPayload(null)).toBeNull();
    expect(parseShotPayload('data:image/jpeg;base64,abc')).toBeNull();
    expect(parseShotPayload({ v: 2, shot })).toBeNull();
    expect(parseShotPayload({ v: 1 })).toBeNull();
    expect(parseShotPayload({ v: 1, shot: 42 })).toBeNull();
  });

  it('rejects non-image and oversized shots', () => {
    expect(parseShotPayload({ v: 1, shot: 'https://evil.example/x.jpg' })).toBeNull();
    expect(parseShotPayload({ v: 1, shot: 'javascript:alert(1)' })).toBeNull();
    expect(parseShotPayload({ v: 1, shot: `data:image/jpeg;base64,${'a'.repeat(MAX_SHOT_CHARS)}` })).toBeNull();
    expect(parseShotPayload({ v: 1, shot: '' })).toBeNull();
  });
});
