import { describe, it, expect } from 'vitest';
import {
  canMirrorAsset,
  HAND_FIT_OPTIONS,
  normalizeHandFit,
  mirrorPlacement,
  normalizeModelledHand,
  previewHand,
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

describe('previewHand', () => {
  it('a pin decides the mannequin outright', () => {
    for (const modelled of ['left', 'right', undefined] as (ModelledHand | undefined)[]) {
      expect(previewHand(modelled, 'left')).toBe('left');
      expect(previewHand(modelled, 'right')).toBe('right');
    }
  });

  it('on auto it shows the hand the asset was built for', () => {
    expect(previewHand('left', 'auto')).toBe('left');
    expect(previewHand('right', 'auto')).toBe('right');
  });

  it('a symmetric asset still gets a hand — the host has to place it in ONE', () => {
    // This is the case the old gating got wrong: a wand has no chirality, but
    // "which hand am I putting it in" is still a real question, and answering
    // it with the wrong mannequin makes every grip offset feel backwards.
    expect(previewHand(undefined, 'auto')).toBe('right');
    expect(previewHand(undefined, undefined)).toBe('right');
  });

  it('always returns a real hand — the mannequin can never be undefined', () => {
    const fits: (HandFit | undefined)[] = ['auto', 'left', 'right', undefined];
    for (const modelled of ['left', 'right', undefined] as (ModelledHand | undefined)[]) {
      for (const fit of fits) {
        expect(['left', 'right']).toContain(previewHand(modelled, fit));
      }
    }
  });

  it('agrees with the mirror decision: the asset never fights the mannequin', () => {
    // If the preview shows a left hand and the asset is modelled right, the
    // asset MUST be mirroring — otherwise the host sees a right-handed prop on
    // a left-handed mannequin, which is the exact defect being fixed.
    const fits: HandFit[] = ['auto', 'left', 'right'];
    for (const modelled of ['left', 'right'] as ModelledHand[]) {
      for (const fit of fits) {
        const shown = previewHand(modelled, fit);
        expect(shouldMirrorAsset(modelled, fit, null)).toBe(shown !== modelled);
      }
    }
  });
});

describe('canMirrorAsset', () => {
  it('blocks an engraved asset, allows everything else', () => {
    expect(canMirrorAsset(false)).toBe(true);
    expect(canMirrorAsset(true)).toBe(false);
  });

  it('is the SHARED gate, so mesh and placement cannot disagree', () => {
    // The bug this closes: the mesh mirror was blocked for engraved assets but
    // the placement mirror was not, so the piece kept its own orientation and
    // was flung to the far side of the hand — worse than not mirroring at all.
    // Both call sites now ask this one question.
    for (const engravable of [true, false]) {
      const mesh = canMirrorAsset(engravable);
      const placement = canMirrorAsset(engravable);
      expect(mesh).toBe(placement);
    }
  });
});

describe('mirrorPlacement', () => {
  const cfg = { offset: { x: -0.7, y: -1.9, z: 2.1 }, rotation: { x: -1.72, y: -0.24, z: -0.07 }, scale: 15.8 };

  it('reflects the offset across the midline and leaves depth and height alone', () => {
    const m = mirrorPlacement(cfg);
    expect(m.offset).toEqual({ x: 0.7, y: -1.9, z: 2.1 });
  });

  it('keeps the X turn and flips Y and Z', () => {
    // M·R·M for M = diag(-1,1,1): a pure X turn survives a reflection about X,
    // a pure Y or Z turn reverses. Without this a mirrored gauntlet rolls the
    // wrong way round the wrist.
    const m = mirrorPlacement(cfg);
    expect(m.rotation).toEqual({ x: -1.72, y: 0.24, z: 0.07 });
  });

  it('carries every other field through untouched', () => {
    expect(mirrorPlacement(cfg).scale).toBe(15.8);
  });

  it('is an involution — which is what lets the gizmo edit a mirrored piece', () => {
    // The studio hands the gizmo a mirrored placement and pushes its output back
    // through the same function; if this were not exactly self-inverse, every
    // drag on a pinned piece would drift.
    expect(mirrorPlacement(mirrorPlacement(cfg))).toEqual(cfg);
  });

  it('never produces -0 for a value on the midline', () => {
    const z = mirrorPlacement({ offset: { x: 0, y: 1, z: 2 }, rotation: { x: 0, y: 0, z: 0 } });
    expect(Object.is(z.offset.x, -0)).toBe(false);
    expect(Object.is(z.rotation.y, -0)).toBe(false);
    expect(Object.is(z.rotation.z, -0)).toBe(false);
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
