import { describe, expect, it } from 'vitest';
import {
  REDUCED_GLIDE_S, SELFIE_CLIP, SELFIE_DURATION, SELFIE_FPS, SELFIE_FRAMES,
  beamOpacity, flashOpacity, frameToSeconds, photoState, selfiePhase, selfieTimeline,
} from './beamySelfie';

const ORDER = ['shadesOn', 'phoneUp', 'snap', 'beamStart', 'end'] as const;
const sample = (from: number, to: number, step = 1 / 120) => {
  const out: number[] = [];
  for (let t = from; t <= to; t += step) out.push(t);
  return out;
};

describe('Selfie clip constants', () => {
  it('matches the authored clip: 24 fps, 108 frames, 4.5 s', () => {
    expect(SELFIE_CLIP).toBe('Selfie');
    expect(SELFIE_FPS).toBe(24);
    expect(SELFIE_FRAMES.end).toBe(108);
    expect(SELFIE_DURATION).toBeCloseTo(4.5, 10);
  });

  it('uses the exporter convention t = frame / fps', () => {
    expect(frameToSeconds(1)).toBeCloseTo(1 / 24, 10);
    expect(frameToSeconds(SELFIE_FRAMES.snap)).toBeCloseTo(52 / 24, 10);
  });

  it('orders the cues strictly inside the clip', () => {
    for (const reduced of [false, true]) {
      const c = selfieTimeline(reduced).cues;
      for (let i = 1; i < ORDER.length; i++) expect(c[ORDER[i]]).toBeGreaterThan(c[ORDER[i - 1]]);
      expect(c.shadesOn).toBeGreaterThan(0);
      expect(c.end).toBeCloseTo(SELFIE_DURATION, 10);
    }
  });
});

describe('selfieTimeline', () => {
  it('chains photo, beam and total after the snap', () => {
    for (const reduced of [false, true]) {
      const tl = selfieTimeline(reduced);
      const p = tl.photo;
      expect(tl.flash.start).toBe(tl.cues.snap);
      expect(p.appear).toBeGreaterThanOrEqual(tl.cues.snap);
      expect(p.popped).toBeGreaterThan(p.appear);
      expect(p.flightStart).toBeGreaterThanOrEqual(p.popped);
      expect(p.flightEnd).toBeGreaterThanOrEqual(p.flightStart);
      expect(p.fadeStart).toBeLessThan(p.gone);
      expect(tl.total).toBeGreaterThanOrEqual(p.gone);
      expect(tl.total).toBeGreaterThanOrEqual(tl.cues.end);
      expect(tl.beam.end).toBeLessThanOrEqual(tl.total);
    }
  });

  it('starts the flight at the beam cue in full motion', () => {
    const tl = selfieTimeline();
    expect(tl.photo.flightStart).toBe(tl.cues.beamStart);
    expect(tl.photo.flightEnd).toBeGreaterThan(tl.photo.flightStart);
  });

  it('returns a fresh cues object each call', () => {
    const a = selfieTimeline();
    a.cues.snap = 99;
    expect(selfieTimeline().cues.snap).toBeCloseTo(52 / 24, 10);
  });
});

describe('selfiePhase', () => {
  const tl = selfieTimeline();
  it('walks the beats in order across the whole interaction', () => {
    expect(selfiePhase(-0.1, tl)).toBe('before');
    expect(selfiePhase(Number.NaN, tl)).toBe('before');
    expect(selfiePhase(0, tl)).toBe('shades');
    expect(selfiePhase(tl.cues.shadesOn, tl)).toBe('phoneUp');
    expect(selfiePhase(tl.cues.phoneUp, tl)).toBe('pose');
    expect(selfiePhase(tl.cues.snap - 1e-6, tl)).toBe('pose');
    expect(selfiePhase(tl.cues.snap, tl)).toBe('snap');
    expect(selfiePhase(tl.cues.beamStart - 0.01, tl)).toBe('celebrate');
    expect(selfiePhase(tl.cues.beamStart, tl)).toBe('beam');
    expect(selfiePhase(tl.cues.end, tl)).toBe('settle');
    expect(selfiePhase(tl.total, tl)).toBe('done');
  });

  it('never goes backwards', () => {
    const rank = ['before', 'shades', 'phoneUp', 'pose', 'snap', 'celebrate', 'beam', 'settle', 'done'];
    for (const reduced of [false, true]) {
      const t2 = selfieTimeline(reduced);
      let last = 0;
      for (const t of sample(-0.2, t2.total + 0.2)) {
        const r = rank.indexOf(selfiePhase(t, t2));
        expect(r).toBeGreaterThanOrEqual(last);
        last = r;
      }
      expect(last).toBe(rank.length - 1);
    }
  });
});

describe('flash', () => {
  it('is dark outside its window and peaks right after the snap', () => {
    const tl = selfieTimeline();
    expect(flashOpacity(tl.cues.snap - 0.01, tl)).toBe(0);
    expect(flashOpacity(tl.cues.snap + tl.flash.attack, tl)).toBeCloseTo(1, 5);
    expect(flashOpacity(tl.cues.snap + tl.flash.attack + tl.flash.decay, tl)).toBe(0);
  });

  it('stays within [0, peak]', () => {
    for (const reduced of [false, true]) {
      const tl = selfieTimeline(reduced);
      for (const t of sample(0, tl.total)) {
        const v = flashOpacity(t, tl);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(tl.flash.peak + 1e-9);
      }
    }
  });

  it('reduced motion: a dim, gentle fade, never a strobe', () => {
    const tl = selfieTimeline(true);
    expect(tl.flash.peak).toBeLessThanOrEqual(0.35);
    expect(tl.flash.attack).toBeGreaterThanOrEqual(0.3);
    let prev = 0;
    for (const t of sample(tl.cues.snap - 0.1, tl.cues.snap + 1.2, 1 / 60)) {
      const v = flashOpacity(t, tl);
      expect(Math.abs(v - prev)).toBeLessThan(0.05); // no jump between 60 Hz frames
      prev = v;
    }
  });
});

describe('photo', () => {
  it('is hidden before it appears and after it is gone', () => {
    for (const reduced of [false, true]) {
      const tl = selfieTimeline(reduced);
      expect(photoState(tl.cues.snap - 0.01, tl).visible).toBe(false);
      expect(photoState(tl.photo.gone, tl).visible).toBe(false);
      expect(photoState((tl.photo.popped + tl.photo.fadeStart) / 2, tl).visible).toBe(true);
    }
  });

  it('rises monotonically from 0 to 1 along the beam, with opacity in [0, 1]', () => {
    const tl = selfieTimeline();
    let prev = 0;
    for (const t of sample(tl.photo.appear, tl.photo.gone - 1e-6)) {
      const s = photoState(t, tl);
      expect(s.opacity).toBeGreaterThanOrEqual(0);
      expect(s.opacity).toBeLessThanOrEqual(1);
      expect(s.rise).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = s.rise;
    }
    expect(photoState(tl.photo.flightStart, tl).rise).toBe(0);
    expect(prev).toBeGreaterThan(0.99);
  });

  it('reduced motion: a slow glide window to the wall exists, inside the whole interaction', () => {
    const tl = selfieTimeline(true);
    expect(tl.photo.flightEnd - tl.photo.flightStart).toBeCloseTo(REDUCED_GLIDE_S, 9);
    expect(REDUCED_GLIDE_S).toBeGreaterThanOrEqual(1.2); // slow, never a dart
    expect(tl.total).toBeGreaterThanOrEqual(tl.photo.flightEnd);
  });

  it('reduced motion: the card itself never rises or bounces in place', () => {
    const tl = selfieTimeline(true);
    for (const t of sample(tl.photo.appear, tl.photo.gone)) {
      const s = photoState(t, tl);
      expect(s.rise).toBe(0);
      expect(s.tiltDeg).toBe(0);
      if (s.visible) expect(s.scale).toBe(1);
      expect(s.opacity).toBeLessThanOrEqual(1);
    }
  });
});

describe('beam', () => {
  it('lights for the flight in full motion, inside [0, 1]', () => {
    const tl = selfieTimeline();
    expect(beamOpacity(tl.cues.snap, tl)).toBe(0);
    expect(beamOpacity((tl.photo.flightStart + tl.photo.flightEnd) / 2, tl)).toBe(1);
    for (const t of sample(0, tl.total)) {
      const v = beamOpacity(t, tl);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is never drawn in reduced motion', () => {
    const tl = selfieTimeline(true);
    for (const t of sample(0, tl.total)) expect(beamOpacity(t, tl)).toBe(0);
  });
});
