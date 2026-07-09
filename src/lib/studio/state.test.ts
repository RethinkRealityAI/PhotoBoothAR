import { describe, it, expect } from 'vitest';
import {
  studioReducer,
  initialState,
  initialDraft,
  draftHasContent,
  selectedObject,
  createOverlay,
  createObject3D,
  MAX_OBJECTS,
  type StudioState,
  type Overlay2D,
  type Object3D,
} from './state';
import { BUILTIN_BORDERS } from '../borders';
import { HEAD_PIECE_MAP } from '../headPieces';

const s0 = (): StudioState => initialState('shader');
const only = <T extends { type: string }>(arr: T[]): T => {
  expect(arr).toHaveLength(1);
  return arr[0];
};

describe('initialDraft', () => {
  it('border/sticker drafts start with a single built-in overlay selected', () => {
    for (const kind of ['border', '2d_filter'] as const) {
      const d = initialDraft(kind);
      const o = only(d.objects) as Overlay2D;
      expect(o.type).toBe('overlay');
      expect(o.overlayKind).toBe(kind);
      expect(o.builtinId).toBe(BUILTIN_BORDERS.find((b) => b.kind === kind)!.id);
      expect(o.url).toMatch(/^data:image\/svg\+xml/);
      expect(o.isBuiltin).toBe(true);
      expect(d.selectedId).toBe(o.id);
    }
  });
  it('shader and 3d drafts start with no objects', () => {
    expect(initialDraft('shader').objects).toEqual([]);
    expect(initialDraft('3d_attachment').objects).toEqual([]);
  });
});

describe('draftHasContent', () => {
  it('shader always has content', () => {
    expect(draftHasContent(initialDraft('shader'))).toBe(true);
  });
  it('3d needs at least one object', () => {
    const d = initialDraft('3d_attachment');
    expect(draftHasContent(d)).toBe(false);
    const withPiece = studioReducer(initialState('3d_attachment'), { type: 'SELECT_HEAD_PIECE', pieceId: 'royal-crown' });
    expect(draftHasContent(withPiece.draft)).toBe(true);
  });
  it('sticker needs an overlay; a cleared sticker cannot enter preview', () => {
    let st = studioReducer(s0(), { type: 'SET_KIND', kind: '2d_filter' });
    st = studioReducer(st, { type: 'CLEAR_OVERLAY' });
    expect(st.draft.objects).toEqual([]);
    expect(draftHasContent(st.draft)).toBe(false);
    expect(studioReducer(st, { type: 'SET_MODE', mode: 'preview' }).mode).not.toBe('preview');
  });
});

describe('mode transitions', () => {
  it('entering 3D from a 2D draft starts a 3D draft (name/flags carried)', () => {
    let st = studioReducer(s0(), { type: 'SET_NAME', name: 'Gala Look' });
    st = studioReducer(st, { type: 'TOGGLE_PUBLISHED' });
    st = studioReducer(st, { type: 'SET_MODE', mode: '3d' });
    expect(st.mode).toBe('3d');
    expect(st.draft.kind).toBe('3d_attachment');
    expect(st.draft.name).toBe('Gala Look');
    expect(st.draft.isPublished).toBe(false);
    expect(st.draft.objects).toEqual([]);
  });
  it('returning to 2D from a 3D draft restores a 2D draft', () => {
    let st = studioReducer(s0(), { type: 'SET_MODE', mode: '3d' });
    st = studioReducer(st, { type: 'SET_MODE', mode: '2d' });
    expect(st.draft.kind).toBe('shader');
  });
  it('preview is allowed once the draft has content and keeps the draft', () => {
    const st = studioReducer(s0(), { type: 'SET_MODE', mode: 'preview' });
    expect(st.mode).toBe('preview');
    expect(st.draft.kind).toBe('shader');
  });
});

describe('kind switching (Creator2D handleKindChange semantics, single-object)', () => {
  it('switching to border restores a built-in border', () => {
    const st = studioReducer(s0(), { type: 'SET_KIND', kind: 'border' });
    const o = only(st.draft.objects) as Overlay2D;
    expect(o.isBuiltin).toBe(true);
    expect(o.url).toMatch(/^data:/);
    expect(o.overlayKind).toBe('border');
    expect(st.draft.kind).toBe('border');
  });
  it('switching to shader clears the overlay', () => {
    let st = studioReducer(s0(), { type: 'SET_KIND', kind: 'border' });
    st = studioReducer(st, { type: 'SET_KIND', kind: 'shader' });
    expect(st.draft.objects).toEqual([]);
  });
  it('switching kind drops a pending custom upload blob (rebuilds a built-in)', () => {
    let st = studioReducer(s0(), { type: 'SET_KIND', kind: '2d_filter' });
    st = studioReducer(st, { type: 'SET_OVERLAY_UPLOAD', url: 'blob:x', blob: new Blob(['x']) });
    st = studioReducer(st, { type: 'SET_KIND', kind: 'border' });
    const o = only(st.draft.objects) as Overlay2D;
    expect(o.blob).toBeNull();
    expect(o.isBuiltin).toBe(true);
  });
  it('switching to a 3D kind moves the mode to 3d and empties the scene', () => {
    const st = studioReducer(s0(), { type: 'SET_KIND', kind: '3d_attachment' });
    expect(st.mode).toBe('3d');
    expect(st.draft.objects).toEqual([]);
  });
  it('with >1 overlay, switching 2D sub-kind keeps the objects (only the default changes)', () => {
    let st = studioReducer(s0(), { type: 'SET_KIND', kind: 'border' });
    st = studioReducer(st, { type: 'ADD_OBJECT', object: createOverlay('2d_filter', { url: 'x', isBuiltin: false }) });
    expect(st.draft.objects).toHaveLength(2);
    st = studioReducer(st, { type: 'SET_KIND', kind: '2d_filter' });
    expect(st.draft.objects).toHaveLength(2); // not reset
    expect(st.draft.kind).toBe('2d_filter');
  });
});

describe('anchor selection (Creator3D handleAnchorSelect semantics, on the selected 3D object)', () => {
  const with3D = (): StudioState =>
    studioReducer(initialState('3d_attachment'), { type: 'SELECT_HEAD_PIECE', pieceId: 'royal-crown' });
  it('re-selecting the current anchor is a no-op', () => {
    const st = with3D();
    const anchor = (selectedObject(st.draft) as Object3D).anchor;
    expect(studioReducer(st, { type: 'SELECT_ANCHOR', anchor })).toBe(st);
  });
  it('SELECT_ANCHOR with no 3D object selected is a no-op', () => {
    const st = s0();
    expect(studioReducer(st, { type: 'SELECT_ANCHOR', anchor: 'chin' })).toBe(st);
  });
  it('new anchor resets offset/rotation but keeps scale', () => {
    let st = with3D();
    st = studioReducer(st, { type: 'PATCH_ANCHOR_CONFIG', patch: { offset: { x: 1, y: 2, z: 3 }, scale: 2.5 } });
    st = studioReducer(st, { type: 'SELECT_ANCHOR', anchor: 'chin' });
    const o = selectedObject(st.draft) as Object3D;
    expect(o.anchor).toBe('chin');
    expect(o.anchorConfig.offset).toEqual({ x: 0, y: 0, z: 0 });
    expect(o.anchorConfig.scale).toBe(2.5);
  });
});

describe('head pieces and model assets', () => {
  it('selecting a head piece applies its preset anchor+config, adds an object, enters 3d', () => {
    const st = studioReducer(s0(), { type: 'SELECT_HEAD_PIECE', pieceId: 'neon-shades' });
    const def = HEAD_PIECE_MAP['neon-shades'];
    const o = only(st.draft.objects) as Object3D;
    expect(st.mode).toBe('3d');
    expect(o.type).toBe('headpiece');
    expect(o.proceduralId).toBe('neon-shades');
    expect(o.assetUrl).toBeUndefined();
    expect(o.anchor).toBe(def.anchor);
    expect(o.anchorConfig.offset).toEqual(def.config.offset);
  });
  it('unknown head piece id is a no-op', () => {
    const st = s0();
    expect(studioReducer(st, { type: 'SELECT_HEAD_PIECE', pieceId: 'nope' })).toBe(st);
  });
  it('adding a GLB model after a head piece adds a distinct model object', () => {
    let st = studioReducer(s0(), { type: 'SELECT_HEAD_PIECE', pieceId: 'royal-crown' });
    st = studioReducer(st, { type: 'SET_MODEL_ASSET', url: 'https://cdn/x.glb', name: 'x.glb' });
    expect(st.draft.objects).toHaveLength(2);
    const model = selectedObject(st.draft) as Object3D;
    expect(model.type).toBe('model');
    expect(model.assetUrl).toBe('https://cdn/x.glb');
    expect(model.proceduralId).toBeUndefined();
  });
  it('picking a different head piece with a single one selected REPLACES it in place', () => {
    let st = studioReducer(s0(), { type: 'SELECT_HEAD_PIECE', pieceId: 'royal-crown' });
    st = studioReducer(st, { type: 'SELECT_HEAD_PIECE', pieceId: 'queen-tiara' });
    const o = only(st.draft.objects) as Object3D;
    expect(o.proceduralId).toBe('queen-tiara');
  });
});

describe('multi-object scenes', () => {
  const twoOverlays = (): StudioState => {
    let st = studioReducer(s0(), { type: 'SET_KIND', kind: 'border' });
    st = studioReducer(st, { type: 'ADD_OBJECT', object: createOverlay('2d_filter', { url: 'sticker', isBuiltin: false, name: 'S' }) });
    return st;
  };

  it('a border and a sticker mix in one 2D scene; kind mirrors objects[0]', () => {
    const st = twoOverlays();
    expect(st.draft.objects.map((o) => (o as Overlay2D).overlayKind)).toEqual(['border', '2d_filter']);
    expect(st.draft.kind).toBe('border');
  });
  it('ADD_OBJECT rejects a family mismatch (no 3D object into a 2D scene)', () => {
    const st = studioReducer(s0(), { type: 'SET_KIND', kind: 'border' });
    const next = studioReducer(st, { type: 'ADD_OBJECT', object: createObject3D('model', { assetUrl: 'x' }) });
    expect(next).toBe(st);
  });
  it('ADD_OBJECT enforces the MAX_OBJECTS cap', () => {
    let st = studioReducer(s0(), { type: 'SET_KIND', kind: 'border' }); // 1 object
    for (let i = 0; i < MAX_OBJECTS + 3; i++) {
      st = studioReducer(st, { type: 'ADD_OBJECT', object: createOverlay('2d_filter', { url: `s${i}`, isBuiltin: false }) });
    }
    expect(st.draft.objects).toHaveLength(MAX_OBJECTS);
  });
  it('SELECT_OBJECT changes selection without marking dirty', () => {
    const st0 = studioReducer(twoOverlays(), { type: 'MARK_SAVED', id: 'x' });
    const firstId = st0.draft.objects[0].id;
    const st = studioReducer(st0, { type: 'SELECT_OBJECT', id: firstId });
    expect(st.draft.selectedId).toBe(firstId);
    expect(st.dirty).toBe(false);
  });
  it('DELETE_OBJECT removes it, reselects a neighbour, and recomputes kind', () => {
    const st0 = twoOverlays(); // [border, sticker], sticker selected
    const borderId = st0.draft.objects[0].id;
    const stickerId = st0.draft.objects[1].id;
    const st = studioReducer(st0, { type: 'DELETE_OBJECT', id: borderId });
    expect(st.draft.objects).toHaveLength(1);
    expect(st.draft.objects[0].id).toBe(stickerId);
    expect(st.draft.kind).toBe('2d_filter'); // first object is now the sticker
  });
  it('REORDER_OBJECT swaps neighbours and recomputes kind from the new first object', () => {
    const st0 = twoOverlays();
    const stickerId = st0.draft.objects[1].id;
    const st = studioReducer(st0, { type: 'REORDER_OBJECT', id: stickerId, dir: 'up' });
    expect(st.draft.objects[0].id).toBe(stickerId);
    expect(st.draft.kind).toBe('2d_filter');
  });
  it('REORDER_OBJECT past the ends is a no-op', () => {
    const st0 = twoOverlays();
    const firstId = st0.draft.objects[0].id;
    expect(studioReducer(st0, { type: 'REORDER_OBJECT', id: firstId, dir: 'up' })).toBe(st0);
  });
  it('UPDATE_OBJECT patches fields but never id/type', () => {
    const st0 = twoOverlays();
    const id = st0.draft.objects[1].id;
    const st = studioReducer(st0, {
      type: 'UPDATE_OBJECT',
      id,
      patch: { name: 'Renamed', transform: { scale: 2, x: 1, y: 2, rotation: 3 } } as Partial<Overlay2D>,
    });
    const o = st.draft.objects[1] as Overlay2D;
    expect(o.id).toBe(id);
    expect(o.type).toBe('overlay');
    expect(o.name).toBe('Renamed');
    expect(o.transform).toEqual({ scale: 2, x: 1, y: 2, rotation: 3 });
  });
  it('SET_OBJECT_ANIMATION sets the per-object animation preset', () => {
    const st0 = twoOverlays();
    const id = st0.draft.objects[1].id;
    const st = studioReducer(st0, { type: 'SET_OBJECT_ANIMATION', id, animation: 'float' });
    expect((st.draft.objects[1] as Overlay2D).animation).toBe('float');
  });
  it('SET_TRANSFORM edits the selected overlay only', () => {
    const st0 = twoOverlays(); // sticker selected
    const st = studioReducer(st0, { type: 'SET_TRANSFORM', transform: { scale: 3, x: 0, y: 0, rotation: 0 } });
    expect((selectedObject(st.draft) as Overlay2D).transform.scale).toBe(3);
    expect((st.draft.objects[0] as Overlay2D).transform.scale).toBe(1); // border untouched
  });
  it('SET_OCCLUSION toggles occlusion on the selected 3D object (opt-in)', () => {
    let st = studioReducer(initialState('3d_attachment'), { type: 'SELECT_HEAD_PIECE', pieceId: 'royal-crown' });
    expect((selectedObject(st.draft) as Object3D).occlusion).toBe(false);
    st = studioReducer(st, { type: 'SET_OCCLUSION', occlusion: true });
    expect((selectedObject(st.draft) as Object3D).occlusion).toBe(true);
  });
});

describe('dirty tracking', () => {
  it('LOAD resets dirty; edits set it; MARK_SAVED clears it and records the id', () => {
    let st = studioReducer(s0(), { type: 'LOAD', draft: initialDraft('border') });
    expect(st.dirty).toBe(false);
    st = studioReducer(st, { type: 'SET_NAME', name: 'x' });
    expect(st.dirty).toBe(true);
    st = studioReducer(st, { type: 'MARK_SAVED', id: 'abc' });
    expect(st.dirty).toBe(false);
    expect(st.draft.id).toBe('abc');
  });
});
