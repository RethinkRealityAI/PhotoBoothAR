import { describe, it, expect } from 'vitest';
import {
  HAND_FIT_OPTIONS,
  normalizeHandFit,
  normalizeModelledHand,
  shouldMirrorAsset,
  targetHand,
  type HandFit,
  type ModelledHand,
  type TrackedHand,
} from './handedness';

const FITS: HandFit[] = ['auto', 'left', 'right'];
const TRACKED: TrackedHand[] = ['Left', 'Right', null];

describe('normalizeHandFit', () => {
  it('keeps the three real values and degrades everything else to auto', () => {
    expect(normalizeHandFit('auto')).toBe('auto');
    expect(normalizeHandFit('left')).toBe('left');
    expect(normalizeHandFit('right')).toBe('right');
    for (const junk of [undefined, null, '', 'Left', 'RIGHT', 'both', 0, 1, {}, []]) {
      expect(normalizeHandFit(junk)).toBe('auto');
    }
  });
});

describe('normalizeModelledHand', () => {
  it('only exact left/right survive — anything else is hand-agnostic', () => {
    expect(normalizeModelledHand('left')).toBe('left');
    expect(normalizeModelledHand('right')).toBe('right');
    for (const junk of [undefined, null, '', 'Left', 'auto', 'either', 0, {}, []]) {
      expect(normalizeModelledHand(junk)).toBeUndefined();
    }
  });
});

describe('shouldMirrorAsset', () => {
  it('NEVER mirrors an asset with no declared hand', () => {
    // The legacy guarantee: every descriptor written before this field existed
    // has modelled === undefined, so no combination of fit and tracked hand can
    // flip it. A wand is symmetric; flipping it would be pure risk.
    for (const fit of FITS) {
      for (const tracked of TRACKED) {
        expect(shouldMirrorAsset(undefined, fit, tracked)).toBe(false);
      }
    }
  });

  it('a pin ignores the tracker completely', () => {
    // This is the whole point of offering pins: handRig's handedness label swap
    // is reasoned from MediaPipe's source, not measured on a phone. A pinned
    // asset is correct even if that label is backwards.
    for (const tracked of TRACKED) {
      expect(shouldMirrorAsset('left', 'left', tracked)).toBe(false);
      expect(shouldMirrorAsset('left', 'right', tracked)).toBe(true);
      expect(shouldMirrorAsset('right', 'right', tracked)).toBe(false);
      expect(shouldMirrorAsset('right', 'left', tracked)).toBe(true);
    }
  });

  it('auto follows the tracked hand', () => {
    expect(shouldMirrorAsset('left', 'auto', 'Left')).toBe(false);
    expect(shouldMirrorAsset('left', 'auto', 'Right')).toBe(true);
    expect(shouldMirrorAsset('right', 'auto', 'Right')).toBe(false);
    expect(shouldMirrorAsset('right', 'auto', 'Left')).toBe(true);
  });

  it('auto with no hand in frame holds the modelled orientation', () => {
    // Not "guess left": a wrong guess flips on acquisition and flips back,
    // which reads as a glitch. Holding still reads as the prop settling.
    expect(shouldMirrorAsset('left', 'auto', null)).toBe(false);
    expect(shouldMirrorAsset('right', 'auto', null)).toBe(false);
  });

  it('an absent fit behaves exactly like auto', () => {
    for (const tracked of TRACKED) {
      for (const modelled of ['left', 'right'] as ModelledHand[]) {
        expect(shouldMirrorAsset(modelled, undefined, tracked))
          .toBe(shouldMirrorAsset(modelled, 'auto', tracked));
      }
    }
  });

  it('mirroring is an involution: the mirrored asset never wants mirroring again', () => {
    // If this failed, a mirrored gauntlet would keep asking to be flipped and
    // the render would alternate every frame.
    for (const fit of FITS) {
      for (const tracked of TRACKED) {
        for (const modelled of ['left', 'right'] as ModelledHand[]) {
          if (!shouldMirrorAsset(modelled, fit, tracked)) continue;
          const flipped: ModelledHand = modelled === 'left' ? 'right' : 'left';
          expect(shouldMirrorAsset(flipped, fit, tracked)).toBe(false);
        }
      }
    }
  });
});

describe('targetHand', () => {
  it('reports the hand the asset ends up fitting, or null when undecidable', () => {
    expect(targetHand('left', 'auto', 'Right')).toBe('right');
    expect(targetHand('left', 'right', null)).toBe('right');
    expect(targetHand('left', 'auto', null)).toBeNull();
    expect(targetHand(undefined, 'right', 'Right')).toBeNull();
  });
});

describe('HAND_FIT_OPTIONS', () => {
  it('offers exactly the values normalizeHandFit accepts, auto first', () => {
    expect(HAND_FIT_OPTIONS.map((o) => o.id)).toEqual(['auto', 'left', 'right']);
    for (const o of HAND_FIT_OPTIONS) {
      expect(normalizeHandFit(o.id)).toBe(o.id);
      expect(o.label.length).toBeGreaterThan(0);
      expect(o.hint.length).toBeGreaterThan(0);
    }
  });
});
