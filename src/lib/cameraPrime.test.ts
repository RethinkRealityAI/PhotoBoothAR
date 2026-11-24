import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOOTH_MIC_CONSTRAINTS, getCameraStream } from './camera';

/** A stand-in MediaStream: just the track bookkeeping getCameraStream touches. */
function fakeStream(audio: boolean) {
  const mk = (kind: string) => ({ kind, stopped: false, stop() { this.stopped = true; } });
  const tracks = [mk('video'), ...(audio ? [mk('audio')] : [])];
  return {
    tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
    removeTrack: (t: unknown) => { tracks.splice(tracks.indexOf(t as (typeof tracks)[number]), 1); },
    addTrack: (t: unknown) => { tracks.push(t as (typeof tracks)[number]); },
  };
}
const named = (name: string) => Object.assign(new Error(name), { name });

function stubGum(impl: (c: MediaStreamConstraints) => unknown) {
  const calls: MediaStreamConstraints[] = [];
  const getUserMedia = vi.fn(async (c: MediaStreamConstraints) => { calls.push(c); return impl(c); });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('getCameraStream primeMic', () => {
  it('asks for camera and microphone in ONE request, then releases the microphone', async () => {
    let granted: ReturnType<typeof fakeStream> | null = null;
    const calls = stubGum((c) => (granted = fakeStream(c.audio !== false)));
    const s = await getCameraStream({ primeMic: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].audio).toEqual(BOOTH_MIC_CONSTRAINTS);
    expect(s.getAudioTracks()).toHaveLength(0);
    expect(s.getVideoTracks()).toHaveLength(1);
    expect(granted).not.toBeNull();
  });

  it('stops the primed microphone track (no live mic in photo mode)', async () => {
    let mic: { stopped: boolean } | null = null;
    stubGum((c) => {
      const f = fakeStream(c.audio !== false);
      if (c.audio !== false) mic = f.tracks[1];
      return f;
    });
    await getCameraStream({ primeMic: true });
    expect(mic).not.toBeNull();
    expect(mic!.stopped).toBe(true);
  });

  it('a refused microphone never costs the camera: same picture request again, without sound', async () => {
    const calls = stubGum((c) => {
      if (c.audio !== false) throw named('NotAllowedError');
      return fakeStream(false);
    });
    const s = await getCameraStream({ primeMic: true });
    expect(calls).toHaveLength(2);
    expect(calls[1].audio).toBe(false);
    expect(calls[1].video).toEqual(calls[0].video);
    expect(s.getVideoTracks()).toHaveLength(1);
  });

  it('an unmet picture constraint moves to the next tier and still asks for the microphone', async () => {
    let n = 0;
    const calls = stubGum((c) => {
      n += 1;
      if (n === 1) throw named('OverconstrainedError');
      return fakeStream(c.audio !== false);
    });
    await getCameraStream({ primeMic: true });
    expect(calls).toHaveLength(2);
    expect(calls[1].audio).toEqual(BOOTH_MIC_CONSTRAINTS);
    expect(calls[1].video).not.toEqual(calls[0].video);
  });

  it('without primeMic the request is picture only, as before', async () => {
    const calls = stubGum(() => fakeStream(false));
    await getCameraStream({});
    expect(calls).toHaveLength(1);
    expect(calls[0].audio).toBe(false);
  });
});
