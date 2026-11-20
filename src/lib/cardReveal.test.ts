import { describe, expect, it } from 'vitest';
import {
  REVEAL_MAX_S,
  REVEAL_MIN_S,
  beatsEnd,
  burstMotes,
  collageRects,
  coverCrop,
  curtainBeats,
  dragTilt,
  envelopeBeats,
  envelopeStage,
  handoffCardRect,
  mixHex,
  type RevealBeat,
} from './cardReveal';

const both = [false, true] as const;
/** Beat sums are floats (0.9 + 1.9 = 2.8000000000000003). */
const EPS = 1e-9;

describe('reveal choreography stays inside the contract', () => {
  for (const reduced of both) {
    it(`envelope (reduced=${reduced}) runs 2.5–6 s after the tap`, () => {
      const end = beatsEnd(envelopeBeats(reduced));
      expect(end).toBeGreaterThanOrEqual(REVEAL_MIN_S);
      expect(end).toBeLessThanOrEqual(REVEAL_MAX_S);
    });
    it(`curtain (reduced=${reduced}) runs 2.5–6 s after the tap`, () => {
      const end = beatsEnd(curtainBeats(reduced));
      expect(end).toBeGreaterThanOrEqual(REVEAL_MIN_S);
      expect(end).toBeLessThanOrEqual(REVEAL_MAX_S);
    });
  }

  it('the envelope tells its story in order: seal → flaps → card → calm → hold', () => {
    for (const reduced of both) {
      const b = envelopeBeats(reduced);
      const order: RevealBeat[] = [b.seal, b.topFlap, b.sideFlaps, b.bottomFlap, b.card, b.calm, b.hold];
      for (let i = 1; i < order.length; i++) expect(order[i].at).toBeGreaterThan(order[i - 1].at);
      // Light comes out of the seams before the flaps part.
      expect(b.seams.at).toBeLessThan(b.topFlap.at);
      // The card condenses out of light that is already there.
      expect(b.card.at).toBeGreaterThan(b.bloom.at);
      // The hold is the last thing that happens: onDone fires on the finished card.
      expect(b.hold.at + b.hold.dur + EPS).toBeGreaterThanOrEqual(beatsEnd(b));
    }
  });

  it('the curtain floats before it dollies, and the dolly ends the reveal', () => {
    for (const reduced of both) {
      const b = curtainBeats(reduced);
      expect(b.doors.at).toBeGreaterThan(b.blaze.at);
      expect(b.dolly.at + EPS).toBeGreaterThanOrEqual(b.float.at + b.float.dur);
      expect(b.hold.at + EPS).toBeGreaterThanOrEqual(b.dolly.at + b.dolly.dur);
      // ~1.5 s of floating is the brief.
      expect(b.float.dur).toBeGreaterThanOrEqual(1.5);
    }
  });

  it('reduced motion is never a skip: every beat still has real duration', () => {
    for (const beats of [envelopeBeats(true), curtainBeats(true)]) {
      for (const b of Object.values(beats)) expect(b.dur).toBeGreaterThan(0.2);
    }
  });
});

describe('envelopeStage', () => {
  it('is the whole screen on a phone, with the seal where the flaps meet', () => {
    const e = envelopeStage(390, 844);
    expect(e.fullBleed).toBe(true);
    expect(e.stage).toEqual({ x: 0, y: 0, w: 390, h: 844 });
    expect(e.meet).toEqual({ x: 195, y: 422 });
    expect(e.sealR * 2).toBeGreaterThanOrEqual(44); // tap target
    expect(e.card).toEqual(handoffCardRect(390, 844));
  });
  it('stands exactly where the cover will appear on a laptop', () => {
    const e = envelopeStage(1440, 900);
    expect(e.fullBleed).toBe(false);
    expect(e.stage).toEqual(handoffCardRect(1440, 900));
    expect(e.sealR).toBe(60);
  });
});

describe('handoffCardRect', () => {
  it('matches the storybook cover on a phone and on a laptop', () => {
    expect(handoffCardRect(390, 844)).toEqual({ x: 16, y: 32, w: 358, h: 736 });
    expect(handoffCardRect(1440, 900)).toEqual({ x: 496, y: 32, w: 448, h: 792 });
  });
  it('never collapses on a tiny viewport', () => {
    const r = handoffCardRect(120, 200);
    expect(r.w).toBe(200);
    expect(r.h).toBe(280);
  });
});

describe('burstMotes', () => {
  it('is deterministic for a seed (a replay looks the same)', () => {
    expect(burstMotes(12, 100, 3)).toEqual(burstMotes(12, 100, 3));
    expect(burstMotes(12, 100, 3)).not.toEqual(burstMotes(12, 100, 4));
  });
  it('stays within reach and fans all the way round', () => {
    const motes = burstMotes(16, 120);
    expect(motes).toHaveLength(16);
    let left = 0;
    let right = 0;
    for (const m of motes) {
      // reach plus the upward lift
      expect(Math.hypot(m.dx, m.dy)).toBeLessThanOrEqual(120 * 1.12 + 1e-9);
      expect(m.size).toBeGreaterThanOrEqual(3);
      expect(m.size).toBeLessThanOrEqual(8);
      if (m.dx < 0) left++;
      else right++;
    }
    expect(left).toBeGreaterThan(4);
    expect(right).toBeGreaterThan(4);
  });
  it('handles zero and junk counts', () => {
    expect(burstMotes(0, 100)).toEqual([]);
    expect(burstMotes(-3, 100)).toEqual([]);
    expect(burstMotes(2.9, 100)).toHaveLength(2);
  });
});

describe('mixHex', () => {
  it('mixes channel by channel', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#33318A', '#FFFFFF', 0.25)).toBe('#6665a7');
  });
  it('clamps t and survives a bad colour on either side', () => {
    expect(mixHex('#102030', '#ffffff', -1)).toBe('#102030');
    expect(mixHex('#102030', '#ffffff', 2)).toBe('#ffffff');
    expect(mixHex('nope', '#ABCDEF', 0.5)).toBe('#abcdef');
    expect(mixHex('#ABCDEF', '', 0.5)).toBe('#abcdef');
    expect(mixHex('x', 'y', 0.5)).toBe('#000000');
  });
});

describe('collageRects', () => {
  const area = (rs: { w: number; h: number }[]) => rs.reduce((s, r) => s + r.w * r.h, 0);
  it('lays out 0–4 photos and ignores extras', () => {
    expect(collageRects(0, 100, 80, 4)).toEqual([]);
    expect(collageRects(1, 100, 80, 4)).toEqual([{ x: 0, y: 0, w: 100, h: 80 }]);
    expect(collageRects(2, 100, 80, 4)).toHaveLength(2);
    expect(collageRects(3, 100, 80, 4)).toHaveLength(3);
    expect(collageRects(9, 100, 80, 4)).toHaveLength(4);
  });
  it('fills the area minus the gutters, never overflowing it', () => {
    for (const n of [2, 3, 4]) {
      const rs = collageRects(n, 100, 80, 4);
      for (const r of rs) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(100 + 1e-9);
        expect(r.y + r.h).toBeLessThanOrEqual(80 + 1e-9);
      }
      expect(area(rs)).toBeLessThan(100 * 80);
      expect(area(rs)).toBeGreaterThan(100 * 80 * 0.85);
    }
  });
});

describe('coverCrop', () => {
  it('crops a wide image to a square box from the middle', () => {
    expect(coverCrop(200, 100, 50, 50)).toEqual({ x: 50, y: 0, w: 100, h: 100 });
  });
  it('crops a tall image to a wide box from the middle', () => {
    expect(coverCrop(100, 400, 100, 50)).toEqual({ x: 0, y: 175, w: 100, h: 50 });
  });
  it('returns the whole image for degenerate sizes instead of NaN', () => {
    expect(coverCrop(0, 100, 50, 50)).toEqual({ x: 0, y: 0, w: 0, h: 100 });
    expect(coverCrop(100, 100, 0, 50)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });
});

describe('dragTilt', () => {
  it('is zero at rest and follows the finger', () => {
    expect(dragTilt(0, 0)).toEqual({ yaw: 0, pitch: 0 });
    const t = dragTilt(130, -65);
    expect(t.yaw).toBeCloseTo(0.5);
    expect(t.pitch).toBeCloseTo(-0.25);
  });
  it('clamps so the face never turns away', () => {
    expect(dragTilt(5000, -5000)).toEqual({ yaw: 0.6, pitch: -0.6 });
    expect(dragTilt(5000, 0, 0.3).yaw).toBe(0.3);
  });
  it('treats non-finite input as no drag', () => {
    expect(dragTilt(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({ yaw: 0, pitch: 0 });
  });
});
