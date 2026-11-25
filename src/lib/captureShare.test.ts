import { describe, it, expect } from 'vitest';
import {
  captureExtension,
  captureFileName,
  keepMode,
  keepLabel,
  shareMessage,
  keepOutcomeNote,
} from './captureShare';

describe('captureExtension', () => {
  it('matches the bytes for videos', () => {
    expect(captureExtension('video', 'video/mp4')).toBe('mp4');
    expect(captureExtension('video', 'video/mp4;codecs=avc1')).toBe('mp4');
    expect(captureExtension('video', 'video/quicktime')).toBe('mp4');
    expect(captureExtension('video', 'video/webm;codecs=vp9')).toBe('webm');
    expect(captureExtension('video', '')).toBe('mp4');
    expect(captureExtension('video', null)).toBe('mp4');
  });
  it('defaults stills to jpg and keeps png/webp', () => {
    expect(captureExtension('image', 'image/jpeg')).toBe('jpg');
    expect(captureExtension('image', undefined)).toBe('jpg');
    expect(captureExtension('image', 'image/png')).toBe('png');
    expect(captureExtension('image', 'IMAGE/WEBP')).toBe('webp');
  });
});

describe('captureFileName', () => {
  it('uses a filesystem-safe prefix', () => {
    expect(captureFileName('Ada & Bo’s Party!', 'image', 'image/jpeg', 1700000000123)).toBe('AdaBosParty-1700000000123.jpg');
  });
  it('falls back when the prefix is blank or all symbols', () => {
    expect(captureFileName('', 'video', 'video/webm', 5)).toBe('Beamwall-5.webm');
    expect(captureFileName('!!!', 'image', null, 5)).toBe('Beamwall-5.jpg');
    expect(captureFileName(undefined, 'image', null, -3)).toBe('Beamwall-0.jpg');
  });
});

describe('keepMode / keepLabel', () => {
  it('shares when files can be shared, else downloads', () => {
    expect(keepMode(true)).toBe('share');
    expect(keepMode(false)).toBe('download');
  });
  it('names both halves of the share sheet', () => {
    expect(keepLabel('share', 'image')).toBe('Save or share');
    expect(keepLabel('share', 'video')).toBe('Save or share');
    expect(keepLabel('download', 'image')).toBe('Save photo');
    expect(keepLabel('download', 'video')).toBe('Save video');
  });
});

describe('shareMessage', () => {
  it('prefers the event share text', () => {
    expect(shareMessage('  Live from the gala ✨ ', 'Gala')).toBe('Live from the gala ✨');
  });
  it('falls back to the event name, then nothing', () => {
    expect(shareMessage('', 'Ada’s 30th')).toBe('My moment from Ada’s 30th.');
    expect(shareMessage(null, '  ')).toBe('');
  });
});

describe('keepOutcomeNote', () => {
  it('stays quiet on success and on a cancelled sheet', () => {
    expect(keepOutcomeNote('shared', 'image')).toBeNull();
    expect(keepOutcomeNote('cancelled', 'video')).toBeNull();
  });
  it('tells the truth about the fallback', () => {
    expect(keepOutcomeNote('downloaded', 'video')).toBe('Your video is downloading.');
    expect(keepOutcomeNote('failed', 'image')).toMatch(/saved the photo instead/);
    expect(keepOutcomeNote('unsupported', 'video')).toMatch(/saved the video instead/);
  });
});
