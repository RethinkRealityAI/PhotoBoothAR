import { describe, it, expect, afterEach } from 'vitest';
import { liveAudioTrack, pickVideoMimeType } from './recorder';

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

  it('prefers WebM+Opus over MP4 when both are supported (avoids MP4 chunk corruption)', () => {
    stubMediaRecorder(['video/webm;codecs=vp9,opus', 'video/mp4;codecs=h264,aac', 'video/mp4']);
    expect(pickVideoMimeType()).toBe('video/webm;codecs=vp9,opus');
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
