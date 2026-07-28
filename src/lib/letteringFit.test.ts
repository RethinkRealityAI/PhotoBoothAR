import { describe, it, expect } from 'vitest';
import {
  fitLettering,
  regionForPlacement,
  normalizeGuestLettering,
  CHAR_WIDTH_RATIO,
  MIN_FONT_PX,
  DEFAULT_LETTERING_COLOR,
  type GuestLetteringStyle,
} from './letteringFit';

/** The capture-resolution band the booth actually draws into. */
const CAPTURE = regionForPlacement('bottom', 1080, 1920);
const STYLES: GuestLetteringStyle[] = ['script', 'serif', 'block', 'label'];

describe('fitLettering', () => {
  it('draws nothing for an empty or whitespace-only name', () => {
    expect(fitLettering('', CAPTURE.w, CAPTURE.h, 'script')).toEqual({ fontPx: 0, text: '' });
    expect(fitLettering('   ', CAPTURE.w, CAPTURE.h, 'script')).toEqual({ fontPx: 0, text: '' });
  });

  it('trims the name it returns', () => {
    expect(fitLettering('  Maya  ', CAPTURE.w, CAPTURE.h, 'script').text).toBe('Maya');
  });

  it('caps a short name at the band height rather than blowing it up', () => {
    // "Jo" would be enormous by width, so the height rule wins: 0.72 * regionH.
    const fit = fitLettering('Jo', CAPTURE.w, CAPTURE.h, 'script');
    expect(fit.fontPx).toBeCloseTo(CAPTURE.h * 0.72, 6);
    expect(fit.text).toBe('Jo');
  });

  it('shrinks monotonically as the name gets longer', () => {
    let previous = Infinity;
    for (let len = 1; len <= 40; len++) {
      const { fontPx } = fitLettering('a'.repeat(len), CAPTURE.w, CAPTURE.h, 'block');
      expect(fontPx).toBeLessThanOrEqual(previous);
      previous = fontPx;
    }
  });

  it('never returns a size below the legibility floor', () => {
    for (const style of STYLES) {
      const { fontPx } = fitLettering('a'.repeat(200), CAPTURE.w, CAPTURE.h, style);
      expect(fontPx).toBe(MIN_FONT_PX);
    }
  });

  it('truncates to exactly the characters that fit at the floor size', () => {
    const style: GuestLetteringStyle = 'block';
    const maxChars = Math.floor(CAPTURE.w / (MIN_FONT_PX * CHAR_WIDTH_RATIO[style]));
    const { fontPx, text } = fitLettering('a'.repeat(maxChars + 40), CAPTURE.w, CAPTURE.h, style);
    expect(fontPx).toBe(MIN_FONT_PX);
    // The ellipsis counts toward the budget — the string is maxChars long.
    expect(text).toHaveLength(maxChars);
    expect(text.endsWith('…')).toBe(true);
    expect(text.slice(0, -1)).toBe('a'.repeat(maxChars - 1));
  });

  it('degrades to a bare ellipsis when not even one character fits', () => {
    expect(fitLettering('Maya', 20, 200, 'block', 60)).toEqual({ fontPx: 60, text: '…' });
  });

  it('gives a narrow face a larger size than a wide one for the same name', () => {
    const script = fitLettering('Alexandra Fitzgerald', CAPTURE.w, CAPTURE.h, 'script').fontPx;
    const block = fitLettering('Alexandra Fitzgerald', CAPTURE.w, CAPTURE.h, 'block').fontPx;
    expect(script).toBeGreaterThan(block);
  });

  it('is scale-invariant when the floor is scaled with the canvas', () => {
    // The preview (720) and the capture (1080) must place the same text — a
    // name that truncates in one and not the other would change the photo.
    const name = 'Alexandra Fitzgerald-Montgomery';
    const capture = regionForPlacement('bottom', 1080, 1920);
    const preview = regionForPlacement('bottom', 720, 1280);
    const a = fitLettering(name, capture.w, capture.h, 'serif', MIN_FONT_PX);
    const b = fitLettering(name, preview.w, preview.h, 'serif', MIN_FONT_PX * (720 / 1080));
    expect(b.text).toBe(a.text);
    expect(b.fontPx / preview.w).toBeCloseTo(a.fontPx / capture.w, 6);
  });

  it('draws nothing for a zero-sized region rather than dividing by zero', () => {
    expect(fitLettering('Maya', 0, 100, 'script')).toEqual({ fontPx: 0, text: '' });
    expect(fitLettering('Maya', 100, 0, 'script')).toEqual({ fontPx: 0, text: '' });
  });
});

describe('regionForPlacement', () => {
  it('insets both bands 10% either side', () => {
    for (const placement of ['top', 'bottom'] as const) {
      const r = regionForPlacement(placement, 1080, 1920);
      expect(r.x).toBeCloseTo(108, 6);
      expect(r.w).toBeCloseTo(864, 6);
      expect(r.h).toBeCloseTo(144, 6);
      // Stays inside the canvas.
      expect(r.x + r.w).toBeLessThanOrEqual(1080);
      expect(r.y + r.h).toBeLessThanOrEqual(1920);
    }
  });

  it('puts the top band near the top and the bottom band near the bottom', () => {
    expect(regionForPlacement('top', 1080, 1920).y).toBeCloseTo(86.4, 6);
    expect(regionForPlacement('bottom', 1080, 1920).y).toBeCloseTo(1680, 6);
  });

  it('scales purely with the canvas, so preview and capture agree', () => {
    const capture = regionForPlacement('bottom', 1080, 1920);
    const preview = regionForPlacement('bottom', 720, 1280);
    expect(preview.x / 720).toBeCloseTo(capture.x / 1080, 6);
    expect(preview.y / 1280).toBeCloseTo(capture.y / 1920, 6);
    expect(preview.w / 720).toBeCloseTo(capture.w / 1080, 6);
    expect(preview.h / 1280).toBeCloseTo(capture.h / 1920, 6);
  });
});

describe('normalizeGuestLettering', () => {
  const ok = { token: 'guestName', style: 'script', color: '#FFD700', placement: 'bottom' };

  it('accepts a well-formed guest-name config', () => {
    expect(normalizeGuestLettering(ok)).toEqual({ ...ok, text: '' });
  });

  it('returns null for anything that is not a config object', () => {
    // Every legacy event resolves here — this is the "render exactly as before"
    // path, so it must never throw or half-succeed.
    expect(normalizeGuestLettering(undefined)).toBeNull();
    expect(normalizeGuestLettering(null)).toBeNull();
    expect(normalizeGuestLettering('script')).toBeNull();
    expect(normalizeGuestLettering([ok])).toBeNull();
    expect(normalizeGuestLettering({})).toBeNull();
  });

  it('rejects unknown token, style and placement values', () => {
    expect(normalizeGuestLettering({ ...ok, token: 'eventName' })).toBeNull();
    expect(normalizeGuestLettering({ ...ok, style: 'comic' })).toBeNull();
    expect(normalizeGuestLettering({ ...ok, placement: 'middle' })).toBeNull();
  });

  it('falls back to white when the colour is missing or blank', () => {
    expect(normalizeGuestLettering({ ...ok, color: undefined })?.color).toBe(DEFAULT_LETTERING_COLOR);
    expect(normalizeGuestLettering({ ...ok, color: '   ' })?.color).toBe(DEFAULT_LETTERING_COLOR);
  });

  it('keeps and trims the fixed line, and drops a fixed config with nothing to say', () => {
    expect(normalizeGuestLettering({ ...ok, token: 'fixed', text: '  Maya & Sam  ' })?.text).toBe('Maya & Sam');
    expect(normalizeGuestLettering({ ...ok, token: 'fixed' })).toBeNull();
    expect(normalizeGuestLettering({ ...ok, token: 'fixed', text: '   ' })).toBeNull();
  });

  it('caps a stored line at 60 characters', () => {
    expect(normalizeGuestLettering({ ...ok, token: 'fixed', text: 'x'.repeat(200) })?.text).toHaveLength(60);
  });
});
