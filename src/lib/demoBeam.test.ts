import { describe, it, expect } from 'vitest';
import {
  makeBeamChannelId, isLocalChannel, isValidChannelId, beamPagePath,
  fitWithin, makeShotPayload, parseShotPayload, MAX_SHOT_CHARS,
  createBeamHub,
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

/* — beam hub: ready gating + delivery acknowledgement ---------------------- */

describe('createBeamHub', () => {
  it('starts connecting and reports status to a late subscriber', () => {
    const hub = createBeamHub();
    const seen: string[] = [];
    hub.onStatus((s) => seen.push(s));
    expect(seen).toEqual(['connecting']);
    hub.setStatus('ready');
    expect(seen).toEqual(['connecting', 'ready']);
  });

  it('whenReady resolves true once the wire is up', async () => {
    const hub = createBeamHub();
    const p = hub.whenReady(1000);
    hub.setStatus('ready');
    await expect(p).resolves.toBe(true);
  });

  it('whenReady resolves immediately when already ready', async () => {
    const hub = createBeamHub();
    hub.setStatus('ready');
    await expect(hub.whenReady(1000)).resolves.toBe(true);
  });

  it('whenReady resolves false on error, so a send is not attempted into a dead channel', async () => {
    const hub = createBeamHub();
    const p = hub.whenReady(1000);
    hub.setStatus('error');
    await expect(p).resolves.toBe(false);
  });

  it('whenReady gives up rather than hanging forever', async () => {
    const hub = createBeamHub();
    await expect(hub.whenReady(10)).resolves.toBe(false);
  });

  it('settles once — a status flap cannot resolve it twice', async () => {
    const hub = createBeamHub();
    const p = hub.whenReady(1000);
    hub.setStatus('ready');
    hub.setStatus('error');
    await expect(p).resolves.toBe(true);
  });

  it('delivers acks to every listener', () => {
    const hub = createBeamHub();
    let a = 0;
    let b = 0;
    hub.ackCbs.push(() => { a++; });
    hub.ackCbs.push(() => { b++; });
    hub.emitAck();
    expect([a, b]).toEqual([1, 1]);
  });

  it('drops a malformed shot instead of forwarding it', () => {
    const hub = createBeamHub();
    const got: string[] = [];
    hub.shotCbs.push((s) => got.push(s));
    hub.emitShot({ v: 1, shot: 'not-a-data-url' });
    hub.emitShot(null);
    expect(got).toEqual([]);
    hub.emitShot({ v: 1, shot: 'data:image/jpeg;base64,AAAA' });
    expect(got).toEqual(['data:image/jpeg;base64,AAAA']);
  });
});
