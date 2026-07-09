import { describe, it, expect } from 'vitest';
import { withHistory, initHistory, canUndo, canRedo } from './history';
import { studioReducer, initialState, type StudioAction, type StudioState, type Overlay2D } from './state';

/* — Generic behaviour with a tiny counter reducer ------------------------- */

type CAction =
  | { type: 'INC' }
  | { type: 'DRAG'; v: number }
  | { type: 'TOUCH' } // mutates present but is NOT recorded (pass-through)
  | { type: 'CLEAR' }
  | { type: 'NOOP' };

const counter = (s: { n: number }, a: CAction): { n: number } => {
  switch (a.type) {
    case 'INC':
      return { n: s.n + 1 };
    case 'DRAG':
      return { n: a.v };
    case 'TOUCH':
      return { n: s.n + 100 };
    case 'CLEAR':
      return { n: 0 };
    case 'NOOP':
      return s; // same reference — a genuine no-op
  }
};

const makeCounter = (limit?: number) =>
  withHistory(counter, {
    limit,
    record: (a) => a.type !== 'TOUCH',
    clear: (a) => a.type === 'CLEAR',
    coalesce: (a) => (a.type === 'DRAG' ? 'drag' : null),
  });

describe('history: generic reducer', () => {
  it('seeds an empty timeline', () => {
    const h = initHistory({ n: 0 });
    expect(h).toMatchObject({ past: [], present: { n: 0 }, future: [] });
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it('records, undoes, and redoes', () => {
    const r = makeCounter();
    let h = initHistory({ n: 0 });
    h = r(h, { type: 'INC' });
    expect(h.present.n).toBe(1);
    expect(h.past).toHaveLength(1);
    h = r(h, { type: 'UNDO' });
    expect(h.present.n).toBe(0);
    expect(canRedo(h)).toBe(true);
    h = r(h, { type: 'REDO' });
    expect(h.present.n).toBe(1);
  });

  it('a non-recorded action changes present without touching the timeline', () => {
    const r = makeCounter();
    let h = r(initHistory({ n: 0 }), { type: 'INC' }); // past len 1
    h = r(h, { type: 'TOUCH' });
    expect(h.present.n).toBe(101);
    expect(h.past).toHaveLength(1); // unchanged
  });

  it('a recorded no-op (same reference) is not pushed', () => {
    const r = makeCounter();
    const h0 = r(initHistory({ n: 0 }), { type: 'INC' });
    const h1 = r(h0, { type: 'NOOP' });
    expect(h1).toBe(h0);
  });

  it('clear wipes past + future', () => {
    const r = makeCounter();
    let h = r(initHistory({ n: 0 }), { type: 'INC' });
    h = r(h, { type: 'INC' });
    h = r(h, { type: 'UNDO' }); // future now has 1
    h = r(h, { type: 'CLEAR' });
    expect(h.present.n).toBe(0);
    expect(h.past).toEqual([]);
    expect(h.future).toEqual([]);
  });

  it('coalesces consecutive same-key edits into one undo entry', () => {
    const r = makeCounter();
    let h = r(initHistory({ n: 5 }), { type: 'DRAG', v: 6 });
    h = r(h, { type: 'DRAG', v: 7 });
    h = r(h, { type: 'DRAG', v: 8 });
    expect(h.present.n).toBe(8);
    expect(h.past).toHaveLength(1); // one merged entry
    h = r(h, { type: 'UNDO' });
    expect(h.present.n).toBe(5); // back to before the whole drag
  });

  it('an intervening non-coalescing action breaks the group', () => {
    const r = makeCounter();
    let h = r(initHistory({ n: 0 }), { type: 'DRAG', v: 1 });
    h = r(h, { type: 'INC' });
    h = r(h, { type: 'DRAG', v: 9 });
    expect(h.past).toHaveLength(3);
  });

  it('a new recorded action after undo clears the redo future', () => {
    const r = makeCounter();
    let h = r(initHistory({ n: 0 }), { type: 'INC' });
    h = r(h, { type: 'UNDO' });
    expect(canRedo(h)).toBe(true);
    h = r(h, { type: 'INC' });
    expect(canRedo(h)).toBe(false);
  });

  it('caps the past at the configured limit', () => {
    const r = makeCounter(3);
    let h = initHistory({ n: 0 });
    for (let i = 0; i < 5; i++) h = r(h, { type: 'INC' });
    expect(h.past).toHaveLength(3);
    expect(h.present.n).toBe(5);
  });

  it('UNDO/REDO at the ends are no-ops (same reference)', () => {
    const r = makeCounter();
    const h = initHistory({ n: 0 });
    expect(r(h, { type: 'UNDO' })).toBe(h);
    expect(r(h, { type: 'REDO' })).toBe(h);
  });
});

/* — Wired to the real studio reducer -------------------------------------- */

const isDraftMutating = (a: StudioAction): boolean =>
  a.type !== 'SET_MODE' && a.type !== 'SET_THREE_VIEW' && a.type !== 'SET_PAUSED' && a.type !== 'SELECT_OBJECT';
const isClearing = (a: StudioAction): boolean => a.type === 'LOAD' || a.type === 'MARK_SAVED';
const coalesceKey = (a: StudioAction, s: StudioState): string | null => {
  switch (a.type) {
    case 'SET_TRANSFORM':
      return `transform:${s.draft.selectedId}`;
    case 'PATCH_ANCHOR_CONFIG':
      return `anchor:${s.draft.selectedId}`;
    case 'SET_SHADER_PARAM':
      return `shader:${a.key}`;
    case 'UPDATE_OBJECT':
      return `update:${a.id}`;
    default:
      return null;
  }
};

const studioHistory = () =>
  withHistory<StudioState, StudioAction>(studioReducer, {
    record: isDraftMutating,
    clear: isClearing,
    coalesce: coalesceKey,
  });

describe('history: studio reducer integration', () => {
  const seeded = () => {
    const st = studioReducer(initialState('shader'), { type: 'SET_KIND', kind: 'border' });
    return { r: studioHistory(), h: initHistory(st) };
  };

  it('continuous SET_TRANSFORM edits coalesce into a single undo', () => {
    const { r, h: h0 } = seeded();
    let h = r(h0, { type: 'SET_TRANSFORM', transform: { scale: 1.1, x: 0, y: 0, rotation: 0 } });
    h = r(h, { type: 'SET_TRANSFORM', transform: { scale: 1.5, x: 0, y: 0, rotation: 0 } });
    expect(h.past).toHaveLength(1);
    expect((h.present.draft.objects[0] as Overlay2D).transform.scale).toBe(1.5);
    h = r(h, { type: 'UNDO' });
    expect((h.present.draft.objects[0] as Overlay2D).transform.scale).toBe(1); // original
  });

  it('SELECT_OBJECT is not recorded on the timeline', () => {
    const { r, h: h0 } = seeded();
    const id = h0.present.draft.objects[0].id;
    const h = r(h0, { type: 'SELECT_OBJECT', id });
    expect(h.past).toHaveLength(0);
  });

  it('SET_MODE is applied but not recorded', () => {
    const { r, h: h0 } = seeded();
    const h = r(h0, { type: 'SET_MODE', mode: 'preview' });
    expect(h.present.mode).toBe('preview');
    expect(h.past).toHaveLength(0);
  });

  it('LOAD clears the timeline', () => {
    const { r, h: h0 } = seeded();
    let h = r(h0, { type: 'SET_NAME', name: 'x' }); // past len 1
    expect(h.past).toHaveLength(1);
    h = r(h, { type: 'LOAD', draft: initialState('3d_attachment').draft });
    expect(h.past).toEqual([]);
    expect(h.future).toEqual([]);
  });
});
