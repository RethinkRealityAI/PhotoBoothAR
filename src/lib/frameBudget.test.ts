import { describe, expect, it, vi } from 'vitest';
import {
  BOOTH_FPS_DEFAULT,
  createFrameGate,
  frameGateShouldDraw,
  parseFpsCap,
  resolveBoothFpsCap,
  runPreCompositeRender,
  setPreCompositeRender,
} from './frameBudget';

/** Draws per second for a screen refreshing at `hz` through a gate capped at `fps`. */
function drawsPerSecond(hz: number, fps: number, jitterMs = 0): number {
  const g = createFrameGate(fps);
  let n = 0;
  for (let i = 0; i < hz * 4; i++) {
    const t = 1000 + (i * 1000) / hz + (i % 2 === 0 ? jitterMs : -jitterMs);
    if (frameGateShouldDraw(g, t)) n++;
  }
  return n / 4;
}

describe('frameGateShouldDraw', () => {
  it('caps a 60 Hz and a 120 Hz screen at 30 draws a second', () => {
    expect(drawsPerSecond(60, 30)).toBe(30);
    expect(drawsPerSecond(120, 30)).toBe(30);
    expect(drawsPerSecond(90, 30)).toBe(30);
  });

  it('survives rAF jitter without dropping to 20 or bursting to 60', () => {
    const r = drawsPerSecond(60, 30, 1.5);
    expect(r).toBeGreaterThanOrEqual(29);
    expect(r).toBeLessThanOrEqual(31);
  });

  it('never exceeds the screen rate, and fps 0 means every frame', () => {
    expect(drawsPerSecond(24, 30)).toBe(24);
    expect(drawsPerSecond(120, 0)).toBe(120);
  });

  it('re-syncs after a long stall instead of bursting to catch up', () => {
    const g = createFrameGate(30);
    expect(frameGateShouldDraw(g, 0)).toBe(true);
    expect(frameGateShouldDraw(g, 1000)).toBe(true); // tab came back
    expect(frameGateShouldDraw(g, 1016.7)).toBe(false); // no burst
    expect(frameGateShouldDraw(g, 1033.3)).toBe(true);
  });
});

describe('fps cap resolution', () => {
  it('parses ?fps= and rejects junk', () => {
    expect(parseFpsCap('0')).toBe(0);
    expect(parseFpsCap('24')).toBe(24);
    expect(parseFpsCap('abc')).toBeNull();
    expect(parseFpsCap('-5')).toBeNull();
    expect(parseFpsCap(null)).toBeNull();
    expect(parseFpsCap('')).toBeNull();
  });

  it('defaults to the camera rate, URL overrides', () => {
    expect(resolveBoothFpsCap('')).toBe(BOOTH_FPS_DEFAULT);
    expect(resolveBoothFpsCap('?trackdebug&fps=0')).toBe(0);
    expect(resolveBoothFpsCap('?fps=60')).toBe(60);
    expect(resolveBoothFpsCap('?fps=nope')).toBe(BOOTH_FPS_DEFAULT);
  });
});

describe('pre-composite render hook', () => {
  it('runs the registered render, and a release only clears its own registration', () => {
    const a = vi.fn();
    const b = vi.fn();
    const releaseA = setPreCompositeRender(a);
    const releaseB = setPreCompositeRender(b); // a remount replaced a
    releaseA(); // stale release must not unhook b
    runPreCompositeRender(5);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith(5);
    releaseB();
    runPreCompositeRender(6);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('a throwing render never breaks the composite', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const release = setPreCompositeRender(() => { throw new Error('boom'); });
    expect(() => runPreCompositeRender(1)).not.toThrow();
    release();
    warn.mockRestore();
  });
});
