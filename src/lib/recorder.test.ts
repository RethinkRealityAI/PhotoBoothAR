import { describe, it, expect, afterEach } from 'vitest';
import { MP4_CANDIDATES, liveAudioTrack, orderVideoCandidates, pickVideoMimeType } from './recorder';

type MR = { isTypeSupported: (t: string) => boolean };

function stubMediaRecorder(supported: string[]) {
  (globalThis as unknown as { MediaRecorder?: MR }).MediaRecorder = {
    isTypeSupported: (t: string) => supported.includes(t),
  };
}

afterEach(() => {
  delete (globalThis as unknown as { MediaRecorder?: MR }).MediaRecorder;
});

describe('pickVideoMimeType', () => {
  it('returns "" when MediaRecorder is unavailable', () => {
    delete (globalThis as unknown as { MediaRecorder?: MR }).MediaRecorder;
    expect(pickVideoMimeType()).toBe('');
  });

  it('prefers MP4/H.264 over WebM when both are supported (guests save and share MP4)', () => {
    stubMediaRecorder(['video/webm;codecs=vp9,opus', 'video/mp4;codecs=h264,aac', 'video/mp4']);
    expect(pickVideoMimeType()).toBe('video/mp4;codecs=h264,aac');
  });

  it('asks Chrome for AAC sound first, then Opus-in-MP4 (re-encoded to AAC after recording)', () => {
    stubMediaRecorder(['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/webm;codecs=vp8,opus']);
    expect(pickVideoMimeType()).toBe('video/mp4;codecs=avc1,mp4a.40.2');
    stubMediaRecorder(['video/mp4;codecs=avc1,opus', 'video/mp4;codecs=avc1', 'video/webm;codecs=vp8,opus']);
    expect(pickVideoMimeType()).toBe('video/mp4;codecs=avc1,opus');
  });

  it('never picks a bare video/mp4 (could be VP9-in-MP4) while WebM is available', () => {
    stubMediaRecorder(['video/mp4', 'video/webm;codecs=vp8,opus']);
    expect(pickVideoMimeType()).toBe('video/webm;codecs=vp8,opus');
  });

  it('prefers vp8 over vp9 (the lighter encoder leaves the phone CPU to the face tracker)', () => {
    stubMediaRecorder(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']);
    expect(pickVideoMimeType()).toBe('video/webm;codecs=vp8,opus');
  });

  it('falls back to vp8+opus when vp9 is missing', () => {
    stubMediaRecorder(['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']);
    expect(pickVideoMimeType()).toBe('video/webm;codecs=vp8,opus');
  });

  it('falls back to MP4/H.264 on Safari (only MP4 supported)', () => {
    stubMediaRecorder(['video/mp4;codecs=h264,aac', 'video/mp4']);
    expect(pickVideoMimeType()).toBe('video/mp4;codecs=h264,aac');
  });

  it('returns "" when nothing is supported', () => {
    stubMediaRecorder([]);
    expect(pickVideoMimeType()).toBe('');
  });
});

describe('liveAudioTrack', () => {
  const t = (readyState: 'live' | 'ended', enabled = true, muted = false) => ({ readyState, enabled, muted });

  it('picks a live, enabled, unmuted track', () => {
    const good = t('live');
    expect(liveAudioTrack([good])).toBe(good);
  });

  it('rejects tracks that would record silence', () => {
    expect(liveAudioTrack([t('ended')])).toBeNull();
    expect(liveAudioTrack([t('live', false)])).toBeNull();
    expect(liveAudioTrack([t('live', true, true)])).toBeNull();
    expect(liveAudioTrack([])).toBeNull();
  });

  it('skips a dead track and finds a later live one', () => {
    const good = t('live');
    expect(liveAudioTrack([t('ended'), good])).toBe(good);
  });
});

describe('orderVideoCandidates', () => {
  const hw = { supported: true, powerEfficient: true };
  const sw = { supported: true, powerEfficient: false };

  /** The first WebM entry: the order among the fallbacks. */
  const firstWebm = (list: string[]) => list.find((t) => t.startsWith('video/webm'));

  it('always starts with the H.264 MP4 candidates, whatever the encoder info', () => {
    for (const info of [null, {}, { vp8: hw, vp9: hw }, { vp8: sw, vp9: hw }]) {
      expect(orderVideoCandidates(info).slice(0, MP4_CANDIDATES.length)).toEqual(MP4_CANDIDATES);
    }
  });

  it('puts vp8 first among the WebM fallbacks with no encoder information', () => {
    expect(firstWebm(orderVideoCandidates(null))).toBe('video/webm;codecs=vp8,opus');
    expect(firstWebm(orderVideoCandidates({}))).toBe('video/webm;codecs=vp8,opus');
  });

  it('keeps vp8 first when both or neither encode in hardware', () => {
    expect(firstWebm(orderVideoCandidates({ vp8: hw, vp9: hw }))).toBe('video/webm;codecs=vp8,opus');
    expect(firstWebm(orderVideoCandidates({ vp8: sw, vp9: sw }))).toBe('video/webm;codecs=vp8,opus');
  });

  it('puts vp9 first only when it alone has a hardware encoder', () => {
    expect(firstWebm(orderVideoCandidates({ vp8: sw, vp9: hw }))).toBe('video/webm;codecs=vp9,opus');
    expect(firstWebm(orderVideoCandidates({ vp9: hw }))).toBe('video/webm;codecs=vp9,opus');
    expect(firstWebm(orderVideoCandidates({ vp8: sw, vp9: { supported: false, powerEfficient: true } }))).toBe('video/webm;codecs=vp8,opus');
  });

  it('ends with a bare video/mp4 as the last resort', () => {
    expect(orderVideoCandidates({ vp8: sw, vp9: hw }).at(-1)).toBe('video/mp4');
  });
});
