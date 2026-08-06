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
    // BOTH missing → ONE line naming both, not just the face.
    expect(stageStatus({ ...base, faceVisible: false, handNeeded: true, handVisible: false })!.text).toBe('No face or hand');
    // Face satisfied, hand gear/gesture waiting.
    const s = stageStatus({ ...base, handNeeded: true, handVisible: false })!;
    expect(s.text).toBe('No hand yet');
    expect(s.live).toBe(true);
    // Hand found and face found → BOTH named (a bare "Tracking" never said which).
    expect(stageStatus({ ...base, handNeeded: true, handVisible: true })!.text).toBe('Face + hand');
    // Absent hand fields = every pre-Power-Ups caller, byte-identical.
    expect(stageStatus(base)!.text).toBe('Tracking');
  });

  it('reports both families, or just the one in play', () => {
    // Face only (the pre-Power-Ups shape) — unchanged wording in every state.
    expect(stageStatus({ ...base, faceVisible: false })!.text).toBe('No face yet');
    expect(stageStatus(base)!.text).toBe('Tracking');
    // Hand only — never mentions a face nothing is tracking.
    const handOnly = { ...base, faceNeeded: false, faceVisible: false, handNeeded: true };
    expect(stageStatus({ ...handOnly, handVisible: false })!.text).toBe('No hand yet');
    expect(stageStatus({ ...handOnly, handVisible: true })!.text).toBe('Tracking');
    // Both — every combination is distinguishable.
    const both = { ...base, handNeeded: true };
    const texts = [
      stageStatus({ ...both, faceVisible: false, handVisible: false })!.text,
      stageStatus({ ...both, faceVisible: false, handVisible: true })!.text,
      stageStatus({ ...both, faceVisible: true, handVisible: false })!.text,
      stageStatus({ ...both, faceVisible: true, handVisible: true })!.text,
    ];
    expect(texts).toEqual(['No face or hand', 'No face yet', 'No hand yet', 'Face + hand']);
    expect(new Set(texts).size).toBe(4);
  });

  it('a fired gesture reports itself, and is outranked only by the toast and a dead camera', () => {
    // The gap this closes: a burst or an in-preview beam applies its effect with
    // no words, so a gesture that never fired looked exactly like one that did.
    const s = stageStatus({ ...base, gesture: 'Pinch' })!;
    expect(s.text).toBe('Pinch detected');
    expect(s.tone).toBe('ok');
    expect(s.live).toBe(false); // transient, not a live tracking state
    // The toast already names the source AND what it did — it wins.
    expect(stageStatus({ ...base, gesture: 'Pinch', toast: 'Pinch → Optic blast' })!.text).toBe('Pinch → Optic blast');
    // A camera that died inside the ~1.6s window must not hide behind it.
    expect(stageStatus({ ...base, gesture: 'Pinch', camError: 'Camera blocked' })!.text).toBe('Camera blocked');
    // It also outranks the steady tracking states — it IS the news.
    expect(stageStatus({ ...base, gesture: 'Open palm', faceVisible: false, handNeeded: true, handVisible: false })!.text)
      .toBe('Open palm detected');
  });

  it('an absent or EMPTY gesture is silence, not a blank chip', () => {
    expect(stageStatus({ ...base, gesture: null })!.text).toBe('Tracking');
    expect(stageStatus({ ...base, gesture: '' })!.text).toBe('Tracking');
    expect(stageStatus({ ...base, gesture: undefined })!.text).toBe('Tracking');
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

  it('the hand and both-family messages obey the same length budget', () => {
    for (const faceNeeded of [true, false]) for (const handNeeded of [true, false]) {
      for (const faceVisible of [true, false]) for (const handVisible of [true, false]) {
        const s = stageStatus({ ...base, faceNeeded, handNeeded, faceVisible, handVisible });
        if (s) expect(s.text.length).toBeLessThanOrEqual(16);
      }
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
