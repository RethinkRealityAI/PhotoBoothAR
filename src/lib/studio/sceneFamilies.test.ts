import { describe, expect, it } from 'vitest';
import {
  familyPresence,
  isHandObject,
  objectFamily,
  orbitMannequins,
  resolveFocus,
  splitByFamily,
} from './sceneFamilies';
import { HAND_ANCHORS } from '../handPose';

const head = { id: 'h', handAnchor: undefined };
const wand = { id: 'w', handAnchor: 'grip' };
const cuff = { id: 'c', handAnchor: 'wristBack' };

describe('objectFamily', () => {
  it('sorts every real HAND_ANCHORS id onto the hand', () => {
    for (const a of HAND_ANCHORS) expect(objectFamily({ handAnchor: a.id })).toBe('hand');
  });

  it('treats a missing anchor as head-worn', () => {
    expect(objectFamily({})).toBe('head');
    expect(objectFamily({ handAnchor: undefined })).toBe('head');
  });

  it('treats an UNRECOGNISED anchor as head-worn — the drift this module removes', () => {
    // StudioStage used to answer "hand" here (handAnchor !== undefined) while
    // Studio3DView answered "head", so the same object rode a FaceRig while the
    // shell downloaded the hand landmarker for it.
    expect(objectFamily({ handAnchor: 'elbow' })).toBe('head');
    expect(objectFamily({ handAnchor: '' })).toBe('head');
    expect(isHandObject({ handAnchor: 'elbow' })).toBe(false);
  });
});

describe('splitByFamily', () => {
  it('keeps input order inside each subset and loses nothing', () => {
    const objs = [head, wand, { id: 'h2', handAnchor: undefined }, cuff];
    const { head: h, hand } = splitByFamily(objs);
    expect(h.map((o) => o.id)).toEqual(['h', 'h2']);
    expect(hand.map((o) => o.id)).toEqual(['w', 'c']);
    expect(h.length + hand.length).toBe(objs.length);
  });
});

describe('familyPresence', () => {
  it('reports each family and flags the mixed scene', () => {
    expect(familyPresence([])).toEqual({ hasHead: false, hasHand: false, both: false, empty: true });
    expect(familyPresence([head])).toMatchObject({ hasHead: true, hasHand: false, both: false });
    expect(familyPresence([wand])).toMatchObject({ hasHead: false, hasHand: true, both: false });
    expect(familyPresence([head, wand])).toMatchObject({ both: true, empty: false });
  });
});

describe('orbitMannequins', () => {
  it('shows only the mannequins the scene actually uses', () => {
    expect(orbitMannequins([wand])).toEqual({ head: false, hand: true });
    expect(orbitMannequins([head])).toEqual({ head: true, hand: false });
    expect(orbitMannequins([head, wand])).toEqual({ head: true, hand: true });
  });

  it('shows the head for an empty scene — there has to be something to place onto', () => {
    expect(orbitMannequins([])).toEqual({ head: true, hand: false });
  });
});

describe('resolveFocus', () => {
  it('honours the host preference when that family is on screen', () => {
    expect(resolveFocus([head, wand], 'hand')).toBe('hand');
    expect(resolveFocus([head, wand], 'head')).toBe('head');
  });

  it('never frames a mannequin the scene stopped rendering', () => {
    // Focused the hand, then deleted the wand.
    expect(resolveFocus([head], 'hand')).toBe('head');
    // Focused the head, then deleted the last head piece.
    expect(resolveFocus([wand], 'head')).toBe('hand');
  });

  it('defaults to the head, including for an empty scene', () => {
    expect(resolveFocus([], null)).toBe('head');
    expect(resolveFocus([], 'hand')).toBe('head');
    expect(resolveFocus([head, wand], null)).toBe('head');
    expect(resolveFocus([wand], null)).toBe('hand');
  });
});
