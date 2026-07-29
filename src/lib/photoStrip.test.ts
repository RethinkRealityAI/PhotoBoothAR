import { describe, it, expect } from 'vitest';
import {
  stripLayout, shotsRemaining, stripComplete, stripProgressLabel,
  STRIP_SHOTS, STRIP_GAP_MS, STRIP_LEAD_SEC,
} from './photoStrip';

describe('stripLayout', () => {
  it('produces one panel per shot', () => {
    expect(stripLayout(1080, 1920, 3).panels).toHaveLength(3);
    expect(stripLayout(1080, 1920, 4).panels).toHaveLength(4);
  });

  it('keeps every panel at the source 9:16 aspect (no stretching)', () => {
    for (const p of stripLayout(1080, 1920, 3).panels) {
      expect(p.w / p.h).toBeCloseTo(9 / 16, 2);
    }
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
