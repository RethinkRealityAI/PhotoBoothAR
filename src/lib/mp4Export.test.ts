import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMp4Type, planMp4, shareableVideo, toShareableMp4, withExtension } from './mp4Export';

const fixture = (name: string, type: string) =>
  new Blob([readFileSync(join(__dirname, 'fixtures/video', name))], { type });

/** Top-level MP4 box types, in file order. */
async function topBoxes(blob: Blob): Promise<string[]> {
  const b = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: string[] = [];
  let at = 0;
  while (at + 8 <= b.length) {
    let size = view.getUint32(at);
    const type = String.fromCharCode(b[at + 4], b[at + 5], b[at + 6], b[at + 7]);
    if (size === 1) size = Number(view.getBigUint64(at + 8));
    if (size < 8) break;
    out.push(type);
    at += size;
  }
  return out;
}

describe('planMp4', () => {
  it('copies an H.264 picture at either level', () => {
    expect(planMp4('avc', 'remux', false)).toBe('copy-video');
    expect(planMp4('avc', 'full', false)).toBe('copy-video');
  });
  it('never re-encodes the picture right after recording', () => {
    expect(planMp4('vp8', 'remux', true)).toBe('skip');
  });
  it('re-encodes a WebM picture on save only when the browser can make H.264', () => {
    expect(planMp4('vp8', 'full', true)).toBe('encode-video');
    expect(planMp4('vp9', 'full', false)).toBe('skip');
    expect(planMp4(null, 'full', true)).toBe('encode-video');
  });
});

describe('isMp4Type / withExtension', () => {
  it('recognises MP4 types with or without codecs', () => {
    expect(isMp4Type('video/mp4')).toBe(true);
    expect(isMp4Type('video/mp4;codecs=avc1,opus')).toBe(true);
    expect(isMp4Type('video/quicktime')).toBe(true);
    expect(isMp4Type('video/webm')).toBe(false);
    expect(isMp4Type('')).toBe(false);
    expect(isMp4Type(undefined)).toBe(false);
  });
  it('swaps or adds the extension', () => {
    expect(withExtension('Gala_2026-11-25_01.webm', 'mp4')).toBe('Gala_2026-11-25_01.mp4');
    expect(withExtension('moment', 'mp4')).toBe('moment.mp4');
    expect(withExtension('a.b/clip', 'mp4')).toBe('a.b/clip.mp4');
  });
});

describe('toShareableMp4', () => {
  it('rewrites a fragmented H.264/AAC recording as a plain MP4 with the index first', async () => {
    const src = fixture('frag-h264-aac.mp4', 'video/mp4');
    expect(await topBoxes(src)).toContain('moof');
    const r = await toShareableMp4(src, { level: 'remux' });
    expect(r.outcome).toBe('converted');
    expect(r.blob.type).toBe('video/mp4');
    const boxes = await topBoxes(r.blob);
    expect(boxes).not.toContain('moof');
    expect(boxes.indexOf('moov')).toBeGreaterThan(-1);
    expect(boxes.indexOf('moov')).toBeLessThan(boxes.indexOf('mdat'));
  });

  it('keeps both tracks and the clip length when copying', async () => {
    const mb = await import('mediabunny');
    const r = await toShareableMp4(fixture('frag-h264-aac.mp4', 'video/mp4'), { level: 'remux' });
    const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(r.blob) });
    const v = await input.getPrimaryVideoTrack();
    const a = await input.getPrimaryAudioTrack();
    expect(v?.codec).toBe('avc');
    expect(a?.codec).toBe('aac');
    expect(await input.computeDuration()).toBeGreaterThan(0.9);
    expect(await input.computeDuration()).toBeLessThan(1.2);
  });

  it('leaves a WebM recording untouched right after recording', async () => {
    const src = fixture('clip-vp8-opus.webm', 'video/webm');
    const r = await toShareableMp4(src, { level: 'remux' });
    expect(r.outcome).toBe('kept-webm');
    expect(r.blob).toBe(src);
  });

  it('hands back the original bytes when the file cannot be read', async () => {
    const junk = new Blob([new Uint8Array(4096).fill(7)], { type: 'video/mp4' });
    const r = await toShareableMp4(junk, { level: 'remux' });
    expect(r.outcome).toBe('failed');
    expect(r.blob).toBe(junk);
  });
});

describe('shareableVideo', () => {
  it('passes an MP4 straight through', async () => {
    const src = fixture('frag-h264-aac.mp4', 'video/mp4');
    const r = await shareableVideo(src);
    expect(r).toEqual({ blob: src, ext: 'mp4' });
  });
  it('keeps a WebM it cannot convert (no H.264 encoder in node) as .webm', async () => {
    const src = fixture('clip-vp8-opus.webm', 'video/webm');
    const r = await shareableVideo(src);
    expect(r.ext).toBe('webm');
    expect(r.blob).toBe(src);
  });
});
