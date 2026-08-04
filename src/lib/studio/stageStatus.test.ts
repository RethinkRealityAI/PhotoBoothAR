import { describe, it, expect } from 'vitest';
import { stageStatus, type StageStatusInput } from './stageStatus';

const base: StageStatusInput = {
  camError: null,
  camReady: true,
  trackerNeeded: true,
  trackerReady: true,
  faceVisible: true,
  toast: null,
};

describe('stageStatus', () => {
  it('says nothing when everything is fine and the tracker is not in play', () => {
    expect(stageStatus({ ...base, trackerNeeded: false })).toBeNull();
  });

  it('reports a camera failure above everything else', () => {
    const s = stageStatus({ ...base, camError: 'Camera blocked', camReady: false, trackerReady: false })!;
    expect(s.tone).toBe('error');
    expect(s.text).toBe('Camera blocked');
  });

  it('lets a transient toast outrank steady state', () => {
    const s = stageStatus({ ...base, toast: 'Smile → Fireworks' })!;
    expect(s.text).toBe('Smile → Fireworks');
    expect(s.live).toBe(false);
  });

  it('walks camera → tracker → face as each becomes ready', () => {
    expect(stageStatus({ ...base, camReady: false, trackerReady: false, faceVisible: false })!.text).toBe('Starting camera');
    expect(stageStatus({ ...base, trackerReady: false, faceVisible: false })!.text).toBe('Loading tracker');
    expect(stageStatus({ ...base, faceVisible: false })!.text).toBe('No face yet');
    expect(stageStatus(base)!.text).toBe('Tracking');
  });

  it('hand states: needed-but-unseen reports after the face, never before', () => {
    // Face missing outranks hand missing (guests find faces first).
    expect(stageStatus({ ...base, faceVisible: false, handNeeded: true, handVisible: false })!.text).toBe('No face yet');
    // Face satisfied, hand gear/gesture waiting.
    const s = stageStatus({ ...base, handNeeded: true, handVisible: false })!;
    expect(s.text).toBe('No hand yet');
    expect(s.live).toBe(true);
    // Hand found → all good.
    expect(stageStatus({ ...base, handNeeded: true, handVisible: true })!.text).toBe('Tracking');
    // Absent hand fields = every pre-Power-Ups caller, byte-identical.
    expect(stageStatus(base)!.text).toBe('Tracking');
  });

  it('a hand-only scene (faceNeeded false) never coaches a face', () => {
    expect(stageStatus({ ...base, faceVisible: false, faceNeeded: false, handNeeded: true, handVisible: false })!.text).toBe('No hand yet');
    expect(stageStatus({ ...base, faceVisible: false, faceNeeded: false, handNeeded: true, handVisible: true })!.text).toBe('Tracking');
  });

  it('keeps every message short enough for the stage band (no truncation)', () => {
    // The chip shares one row with the mode switcher; long copy truncated to
    // "LOADIN…" in a browser probe at 1440px, which reads as broken.
    for (const camReady of [true, false]) for (const trackerReady of [true, false]) for (const faceVisible of [true, false]) {
      const s = stageStatus({ ...base, camReady, trackerReady, faceVisible });
      if (s) expect(s.text.length).toBeLessThanOrEqual(16);
    }
  });

  it('never emits the same text for two different states', () => {
    // The bug this replaces: two components rendered "Loading face tracker…" at
    // once. One status source means each message must identify one state.
    const seen = new Map<string, string>();
    for (const camReady of [true, false]) {
      for (const trackerNeeded of [true, false]) {
        for (const trackerReady of [true, false]) {
          for (const faceVisible of [true, false]) {
            const s = stageStatus({ ...base, camReady, trackerNeeded, trackerReady, faceVisible });
            if (!s) continue;
            const key = `${camReady}|${trackerNeeded}|${trackerReady}|${faceVisible}`;
            const prior = seen.get(s.text);
            // Same text is only allowed for inputs that mean the same thing.
            if (prior) expect(prior.split('|')[0]).toBe(key.split('|')[0]);
            else seen.set(s.text, key);
          }
        }
      }
    }
    expect(seen.size).toBeGreaterThan(2);
  });

  it('only claims a live tracker once the tracker is actually up', () => {
    expect(stageStatus({ ...base, trackerReady: false, faceVisible: false })!.live).toBe(false);
    expect(stageStatus({ ...base, faceVisible: false })!.live).toBe(true);
    expect(stageStatus(base)!.live).toBe(true);
  });

  it('stays quiet in a view that does not use the tracker, even mid-load', () => {
    expect(stageStatus({ ...base, trackerNeeded: false, trackerReady: false, faceVisible: false })).toBeNull();
  });
});
