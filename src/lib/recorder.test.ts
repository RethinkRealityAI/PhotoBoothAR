import { describe, it, expect, afterEach } from 'vitest';
import { pickVideoMimeType } from './recorder';

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
