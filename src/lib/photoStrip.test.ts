import { describe, it, expect } from 'vitest';
import {
  stripLayout, stripPanelAspect, shotsRemaining, stripComplete, stripProgressLabel,
  hexToRgba, STRIP_SHOTS, STRIP_GAP_MS, STRIP_LEAD_SEC, STRIP_SHOT_CHOICES,
} from './photoStrip';

describe('stripLayout', () => {
  it('produces one panel per shot', () => {
    expect(stripLayout(1080, 1920, 3).panels).toHaveLength(3);
    expect(stripLayout(1080, 1920, 4).panels).toHaveLength(4);
  });

  // Panels used to pin the raw 9:16 capture aspect, which left a 3-shot strip
  // on ~29% of the card's width. The owner's redesign maximizes the panels
  // instead: each takes the per-count aspect from stripPanelAspect (the
  // compositor cover-crops, never stretches).
  it('sizes panels to the per-count aspect (space-maximizing, no stretching)', () => {
    for (const shots of STRIP_SHOT_CHOICES) {
      for (const p of stripLayout(1080, 1920, shots).panels) {
        expect(p.w / p.h).toBeCloseTo(stripPanelAspect(shots), 2);
      }
    }
  });

  it('fills most of the card width with a 3-shot strip', () => {
    const l = stripLayout(1080, 1920, 3);
    expect(l.panels[0].w / l.width).toBeGreaterThan(0.55);
  });

  it('keeps 2-shot panels portrait and 3-shot panels gently landscape', () => {
    expect(stripPanelAspect(2)).toBeLessThan(1);
    expect(stripPanelAspect(3)).toBeGreaterThan(1);
    // Never so wide that a centered face gets cropped out of the band.
    expect(stripPanelAspect(3)).toBeLessThanOrEqual(1.4);
  });

  it('exposes a positive corner radius for the painter', () => {
    expect(stripLayout(1080, 1920, 3).radius).toBeGreaterThan(0);
  });

  it('keeps every panel inside the card', () => {
    const l = stripLayout(1080, 1920, 3);
    for (const p of l.panels) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x + p.w).toBeLessThanOrEqual(l.width);
      expect(p.y + p.h).toBeLessThanOrEqual(l.height);
    }
  });

  it('leaves the footer band clear under the last panel', () => {
    const l = stripLayout(1080, 1920, 3);
    const last = l.panels[l.panels.length - 1];
    expect(last.y + last.h).toBeLessThanOrEqual(l.height - l.footerH);
  });

  it('stacks panels top to bottom without overlapping', () => {
    const l = stripLayout(1080, 1920, 3);
    for (let i = 1; i < l.panels.length; i += 1) {
      const prev = l.panels[i - 1];
      expect(l.panels[i].y).toBeGreaterThanOrEqual(prev.y + prev.h);
    }
  });

  it('centres the stack horizontally', () => {
    const l = stripLayout(1080, 1920, 3);
    for (const p of l.panels) {
      expect(p.x + p.w / 2).toBeCloseTo(l.width / 2, 0);
    }
  });

  it('handles a single shot', () => {
    const l = stripLayout(1080, 1920, 1);
    expect(l.panels).toHaveLength(1);
    expect(l.panels[0].h).toBeGreaterThan(0);
  });

  it('clamps a nonsense shot count to at least one panel', () => {
    expect(stripLayout(1080, 1920, 0).panels).toHaveLength(1);
    expect(stripLayout(1080, 1920, -3).panels).toHaveLength(1);
  });

  it('never lets a panel exceed the card width even when very tall', () => {
    const l = stripLayout(400, 4000, 1);
    expect(l.panels[0].w).toBeLessThanOrEqual(400);
  });
});

describe('strip progress', () => {
  it('counts down the remaining shots', () => {
    expect(shotsRemaining(0)).toBe(STRIP_SHOTS);
    expect(shotsRemaining(1)).toBe(STRIP_SHOTS - 1);
    expect(shotsRemaining(STRIP_SHOTS)).toBe(0);
  });

  it('never reports negative remaining shots', () => {
    expect(shotsRemaining(99)).toBe(0);
    expect(shotsRemaining(-4)).toBe(STRIP_SHOTS);
  });

  it('completes only on the last shot', () => {
    expect(stripComplete(STRIP_SHOTS - 1)).toBe(false);
    expect(stripComplete(STRIP_SHOTS)).toBe(true);
  });

  it('labels progress 1-based and clamped', () => {
    expect(stripProgressLabel(0)).toBe(`Shot 1 of ${STRIP_SHOTS}`);
    expect(stripProgressLabel(2)).toBe(`Shot 3 of ${STRIP_SHOTS}`);
    // Never "Shot 4 of 3" if the phase machine over-runs by one.
    expect(stripProgressLabel(STRIP_SHOTS)).toBe(`Shot ${STRIP_SHOTS} of ${STRIP_SHOTS}`);
    expect(stripProgressLabel(-1)).toBe(`Shot 1 of ${STRIP_SHOTS}`);
  });
});

describe('hexToRgba', () => {
  it('parses 6-digit hex', () => {
    expect(hexToRgba('#E8C766', 0.5)).toBe('rgba(232, 199, 102, 0.5)');
    expect(hexToRgba('05060B', 1)).toBe('rgba(5, 6, 11, 1)');
  });

  it('parses 3-digit hex', () => {
    expect(hexToRgba('#fff', 0.2)).toBe('rgba(255, 255, 255, 0.2)');
  });

  it('clamps alpha into [0, 1]', () => {
    expect(hexToRgba('#000000', 7)).toBe('rgba(0, 0, 0, 1)');
    expect(hexToRgba('#000000', -1)).toBe('rgba(0, 0, 0, 0)');
  });

  it('falls back to the warm gold default on garbage instead of throwing', () => {
    expect(hexToRgba('not-a-color', 0.4)).toBe('rgba(232, 199, 102, 0.4)');
    expect(hexToRgba('', 1)).toBe('rgba(232, 199, 102, 1)');
  });
});

describe('strip pacing', () => {
  it('gives the guest time to change their face without stalling the queue', () => {
    expect(STRIP_GAP_MS).toBeGreaterThanOrEqual(800);
    expect(STRIP_GAP_MS).toBeLessThanOrEqual(2500);
  });

  it('leads each later panel with a short, visible countdown', () => {
    expect(STRIP_LEAD_SEC).toBeGreaterThanOrEqual(2);
    expect(STRIP_LEAD_SEC).toBeLessThanOrEqual(5);
  });
});
