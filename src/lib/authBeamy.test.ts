import { describe, expect, it } from 'vitest';
import { BEAMY_LINES, BEAT_MS, REDUCED_BEAT_MS, beatClip, beatMs, nextLineIndex, type AuthBeamyPage } from './authBeamy';

const PAGES: AuthBeamyPage[] = ['signin', 'signup', 'reset'];

describe('authBeamy lines', () => {
  it.each(PAGES)('%s has several lines that fit the phone bubble', (page) => {
    const lines = BEAMY_LINES[page];
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const l of lines) {
      expect(l.text.trim()).toBe(l.text);
      expect(l.text.length).toBeGreaterThan(0);
      expect(l.text.length).toBeLessThanOrEqual(60);
    }
  });

  it.each(PAGES)('%s opens with the "on board" welcome', (page) => {
    expect(BEAMY_LINES[page][0].text).toMatch(/on board/i);
  });

  it('never names a competitor app', () => {
    const all = PAGES.flatMap((p) => BEAMY_LINES[p].map((l) => l.text)).join(' ');
    expect(all).not.toMatch(/snap\s?chat|instagram|tiktok|facebook/i);
  });
});

describe('beatClip', () => {
  it('keeps every clip at full motion', () => {
    for (const c of ['Idle', 'Wave', 'Hop', 'SideEye', 'Dance'] as const) expect(beatClip(c, false)).toBe(c);
  });
  it('softens bouncy clips under reduced motion but keeps him moving', () => {
    expect(beatClip('Hop', true)).toBe('Wave');
    expect(beatClip('Dance', true)).toBe('Wave');
    expect(beatClip('SideEye', true)).toBe('SideEye');
    expect(beatClip('Wave', true)).toBe('Wave');
  });
});

describe('timing', () => {
  it('slows the beat under reduced motion', () => {
    expect(beatMs(false)).toBe(BEAT_MS);
    expect(beatMs(true)).toBe(REDUCED_BEAT_MS);
    expect(REDUCED_BEAT_MS).toBeGreaterThan(BEAT_MS);
  });
  it('wraps the line index', () => {
    expect(nextLineIndex(0, 3)).toBe(1);
    expect(nextLineIndex(2, 3)).toBe(0);
    expect(nextLineIndex(5, 0)).toBe(0);
  });
});
