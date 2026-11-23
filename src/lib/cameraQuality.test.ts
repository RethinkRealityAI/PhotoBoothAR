import { describe, expect, it } from 'vitest';
import { formatGranted, formatMax } from './cameraQuality';

describe('formatGranted', () => {
  it('formats size and rounded fps', () => {
    expect(formatGranted({ width: 1080, height: 1920, frameRate: 29.97 })).toBe('1080×1920 @30');
  });
  it('omits fps when unknown, null when no size yet', () => {
    expect(formatGranted({ width: 720, height: 1280 })).toBe('720×1280');
    expect(formatGranted({ width: 0, height: 0 })).toBeNull();
    expect(formatGranted(null)).toBeNull();
  });
});

describe('formatMax', () => {
  it('reports long×short regardless of orientation', () => {
    expect(formatMax({ width: { max: 2160 }, height: { max: 3840 }, frameRate: { max: 60 } })).toBe('3840×2160 @60');
  });
  it('is null when the browser exposes no capabilities', () => {
    expect(formatMax(null)).toBeNull();
    expect(formatMax({})).toBeNull();
  });
});
