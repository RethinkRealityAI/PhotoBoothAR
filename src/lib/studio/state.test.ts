import { describe, it, expect } from 'vitest';
import {
  studioReducer,
  initialState,
  initialDraft,
  draftHasContent,
  selectedObject,
  sceneCounts,
  createOverlay,
  createObject3D,
  MAX_OBJECTS,
  MAX_TRIGGERS,
  type StudioState,
  type Overlay2D,
  type Object3D,
} from './state';
import type { TriggerConfig } from './triggers';
import { BUILTIN_BORDERS } from '../borders';
import { HEAD_PIECE_MAP } from '../headPieces';

const s0 = (): StudioState => initialState('shader');
const only = <T extends { type: string }>(arr: T[]): T => {
  expect(arr).toHaveLength(1);
  return arr[0];
};
const firstBorderId = (): string => BUILTIN_BORDERS.find((b) => b.kind === 'border')!.id;
const borders = BUILTIN_BORDERS.filter((b) => b.kind === 'border');
const stickers = BUILTIN_BORDERS.filter((b) => b.kind === '2d_filter');

describe('initialDraft', () => {
  it('every kind starts with an EMPTY scene (no auto-inserted overlay)', () => {
    // W4: mixed scenes drop the auto default border/sticker — the first dock click adds it.
    for (const kind of ['border', '2d_filter', 'shader', '3d_attachment'] as const) {
      expect(initialDraft(kind).objects).toEqual([]);
      expect(initialDraft(kind).selectedId).toBeNull();
    }
  });
  it('the filter slot starts empty EXCEPT for shader (which pre-selects a filter)', () => {
    // W4: shaderId 'none' == empty slot; only initialDraft('shader') seeds DEFAULT_SHADER_ID.
    expect(initialDraft('shader').shaderId).not.toBe('none');
    expect(initialDraft('border').shaderId).toBe('none');
    expect(initialDraft('2d_filter').shaderId).toBe('none');
    expect(initialDraft('3d_attachment').shaderId).toBe('none');
  });
});

describe('draftHasContent', () => {
  it('a shader draft has content (its filter slot is filled)', () => {
    expect(draftHasContent(initialDraft('shader'))).toBe(true);
  });
  it('an empty scene with an empty filter slot has no content', () => {
    // W4: 3d/border/2d_filter drafts now start empty AND with shaderId 'none'.
    expect(draftHasContent(initialDraft('3d_attachment'))).toBe(false);
    const withPiece = studioReducer(initialState('3d_attachment'), { type: 'SELECT_HEAD_PIECE', pieceId: 'royal-crown' });
    expect(draftHasContent(withPiece.draft)).toBe(true);
  });
  it('a filter alone (no objects) is enough content to preview', () => {
    // W4: a filter-only scene is previewable; the preview guard allows objects OR a filter.
    let st = initialState('3d_attachment'); // shaderId 'none', empty
    expect(draftHasContent(st.draft)).toBe(false);
    expect(studioReducer(st, { type: 'SET_MODE', mode: 'preview' }).mode).not.toBe('preview');
    st = studioReducer(st, { type: 'SELECT_SHADER', shaderId: 'vhs', params: {} });
    expect(draftHasContent(st.draft)).toBe(true);
    expect(studioReducer(st, { type: 'SET_MODE', mode: 'preview' }).mode).toBe('preview');
  });
});

describe('mode transitions (pure view switch — content persists)', () => {
  it('SET_MODE never resets or deletes draft content', () => {
    // W4: SET_MODE is a pure view flip; switching 2d↔3d keeps every object + the filter slot.
    let st = studioReducer(s0(), { type: 'SELECT_BUILTIN', borderId: firstBorderId(), url: 'u' });
    st = studioReducer(st, { type: 'SELECT_HEAD_PIECE', pieceId: 'royal-crown' }); // composite, mode 3d
    const objs = st.draft.objects;
    st = studioReducer(st, { type: 'SET_MODE', mode: '2d' });
    expect(st.mode).toBe('2d');
    expect(st.draft.objects).toBe(objs); // same reference — nothing rebuilt
    st = studioReducer(st, { type: 'SET_MODE', mode: '3d' });
    expect(st.draft.objects).toBe(objs);
    expect(st.draft.kind).toBe('composite');
  });
  it('entering 3D carries name/flags because SET_MODE never rebuilds the draft', () => {
    // W4: no more draft-rebuild on entering 3d — the draft is left untouched.
    let st = studioReducer(s0(), { type: 'SET_NAME', name: 'Gala Look' });
    st = studioReducer(st, { type: 'TOGGLE_PUBLISHED' });
    st = studioReducer(st, { type: 'SET_MODE', mode: '3d' });
    expect(st.mode).toBe('3d');
    expect(st.draft.name).toBe('Gala Look');
    expect(st.draft.isPublished).toBe(false);
    expect(st.draft.objects).toEqual([]);
    expect(st.draft.kind).toBe('shader'); // empty scene → derived 'shader', unchanged
  });
  it('preview is allowed once the draft has content and keeps the draft', () => {
    const st = studioReducer(s0(), { type: 'SET_MODE', mode: 'preview' });
    expect(st.mode).toBe('preview');
    expect(st.draft.kind).toBe('shader');
  });
  it('preview is a no-op with no objects and no filter', () => {
    // W4: filter-only preview guard — empty scene + empty slot cannot enter preview.
    const st = initialState('3d_attachment'); // empty, shaderId 'none'
    expect(studioReducer(st, { type: 'SET_MODE', mode: 'preview' }).mode).not.toBe('preview');
  });
});

describe('SET_KIND (thin view-flip alias; never mutates the scene)', () => {
  it('SET_KIND to a 2D kind only flips the view and creates nothing', () => {
    // W4: SET_KIND no longer restores/creates an overlay; it just sets the view.
    const st = studioReducer(initialState('3d_attachment'), { type: 'SET_KIND', kind: 'border' });
    expect(st.mode).toBe('2d');
    expect(st.draft.objects).toEqual([]);
    expect(st.draft.kind).toBe('3d_attachment'); // draft.kind (derived) is NOT touched by SET_KIND
  });
  it('SET_KIND to 3d_attachment flips the view to 3d and keeps the scene intact', () => {
    // W4: family switch no longer empties the scene.
    let st = studioReducer(s0(), { type: 'SELECT_BUILTIN', borderId: firstBorderId(), url: 'u' });
    const objs = st.draft.objects;
    st = studioReducer(st, { type: 'SET_KIND', kind: '3d_attachment' });
    expect(st.mode).toBe('3d');
    expect(st.draft.objects).toBe(objs);
  });
  it('SET_KIND that does not change the view is a no-op', () => {
    const st = studioReducer(s0(), { type: 'SET_KIND', kind: 'border' }); // already in 2d → no-op
    expect(studioReducer(st, { type: 'SET_KIND', kind: '2d_filter' })).toBe(st);
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
  it('SET_MODEL_ASSET stores the measured auto-fit scale in the new object', () => {
    const st = studioReducer(s0(), { type: 'SET_MODEL_ASSET', url: 'https://cdn/x.glb', name: 'x.glb', scale: 7.4 });
    const model = selectedObject(st.draft) as Object3D;
    expect(model.anchorConfig.scale).toBe(7.4);
    expect(model.anchorConfig.offset).toEqual({ x: 0, y: 0, z: 0 });
  });
  it('SET_MODEL_ASSET without a scale keeps the legacy default of 1', () => {
    const st = studioReducer(s0(), { type: 'SET_MODEL_ASSET', url: 'https://cdn/x.glb', name: 'x.glb' });
    expect((selectedObject(st.draft) as Object3D).anchorConfig.scale).toBe(1);
  });
  it('picking a second head piece ADDS it (clicks never replace — W4-D UI/UX HIGH #1)', () => {
    // Old-expected: the tiara REPLACED a still-untouched crown (1 object).
    // New-expected: it appends (2 objects) — "multiple 3D models" is the
    // user-locked default and a click must never silently delete content.
    let st = studioReducer(s0(), { type: 'SELECT_HEAD_PIECE', pieceId: 'royal-crown' });
    st = studioReducer(st, { type: 'SELECT_HEAD_PIECE', pieceId: 'queen-tiara' });
    expect(st.draft.objects.map((o) => (o as Object3D).proceduralId)).toEqual(['royal-crown', 'queen-tiara']);
    expect((selectedObject(st.draft) as Object3D).proceduralId).toBe('queen-tiara');
  });
});

describe('SET_OVERLAY_UPLOAD explicit sub-kind', () => {
  it('honors the caller-named overlayKind over selection inheritance', () => {
    // W4: uploading while browsing the Sticker catalog must make a sticker even
    // when a frame is selected (and vice versa) — the action names the kind.
    let st = studioReducer(s0(), { type: 'SELECT_BUILTIN', borderId: firstBorderId(), url: 'f' }); // frame, selected
    st = studioReducer(st, { type: 'SET_OVERLAY_UPLOAD', url: 's1', blob: null, overlayKind: '2d_filter' });
    const kinds = st.draft.objects.map((o) => (o as Overlay2D).overlayKind);
    expect(kinds).toEqual(['border', '2d_filter']);
    expect((selectedObject(st.draft) as Overlay2D).overlayKind).toBe('2d_filter');
  });
  it('an explicit border upload swaps the existing frame (one-frame rule)', () => {
    let st = studioReducer(s0(), { type: 'SELECT_BUILTIN', borderId: firstBorderId(), url: 'f' });
    st = studioReducer(st, { type: 'SET_OVERLAY_UPLOAD', url: 'custom-frame', blob: null, overlayKind: 'border' });
    const frames = st.draft.objects.filter((o) => (o as Overlay2D).overlayKind === 'border');
    expect(frames).toHaveLength(1);
    expect((frames[0] as Overlay2D).url).toBe('custom-frame');
  });
});

describe('append-on-pick (multi-object by default)', () => {
  it('an EDITED head piece is kept: the next pick ADDS a second object', () => {
    let st = studioReducer(s0(), { type: 'SELECT_HEAD_PIECE', pieceId: 'royal-crown' });
    st = studioReducer(st, { type: 'PATCH_ANCHOR_CONFIG', patch: { offset: { x: 0, y: 1.5, z: 0 } } });
    st = studioReducer(st, { type: 'SELECT_HEAD_PIECE', pieceId: 'queen-tiara' });
    expect(st.draft.objects.map((o) => (o as Object3D).proceduralId)).toEqual(['royal-crown', 'queen-tiara']);
    expect((selectedObject(st.draft) as Object3D).proceduralId).toBe('queen-tiara');
  });
  it('a MOVED sticker is kept: the next sticker click ADDS a second sticker', () => {
    let st = studioReducer(s0(), { type: 'SELECT_BUILTIN', borderId: stickers[0].id, url: 'u1' });
    st = studioReducer(st, { type: 'SET_TRANSFORM', transform: { scale: 1.2, x: 5, y: 0, rotation: 0 } });
    st = studioReducer(st, { type: 'SELECT_BUILTIN', borderId: stickers[1].id, url: 'u2' });
    expect(st.draft.objects).toHaveLength(2);
    expect((st.draft.objects[0] as Overlay2D).transform.x).toBe(5); // original kept
  });
  it('an UNTOUCHED sticker is ALSO kept: sticker clicks always append, never swap', () => {
    // W4-D (UI/UX HIGH #1): the old browse-swap silently replaced an unmoved
    // sticker on the next click — the user's exact "why was my thing deleted"
    // confusion. Stickers/3D now ALWAYS append; only the frame swaps (one-frame).
    let st = studioReducer(s0(), { type: 'SELECT_BUILTIN', borderId: stickers[0].id, url: 'u1' });
    st = studioReducer(st, { type: 'SELECT_BUILTIN', borderId: stickers[1].id, url: 'u2' });
    expect(st.draft.objects).toHaveLength(2);
    expect(st.draft.objects.map((o) => (o as Overlay2D).builtinId)).toEqual([stickers[0].id, stickers[1].id]);
  });
  it('cross-sub-kind click never replaces: a sticker ADDS next to a selected frame', () => {
    const sticker = stickers[0];
    let st = studioReducer(s0(), { type: 'SELECT_BUILTIN', borderId: firstBorderId(), url: 'bu' }); // untouched frame selected
    st = studioReducer(st, { type: 'SELECT_BUILTIN', borderId: sticker.id, url: 'su' });
    expect(st.draft.objects.map((o) => (o as Overlay2D).overlayKind)).toEqual(['border', '2d_filter']);
  });
  it('an ANIMATED head piece is kept on the next pick too', () => {
    let st = studioReducer(s0(), { type: 'SELECT_HEAD_PIECE', pieceId: 'royal-crown' });
    st = studioReducer(st, { type: 'SET_OBJECT_ANIMATION', id: st.draft.objects[0].id, animation: 'float' });
    st = studioReducer(st, { type: 'SELECT_HEAD_PIECE', pieceId: 'queen-tiara' });
    expect(st.draft.objects).toHaveLength(2);
  });
});

describe('multi-object scenes', () => {
  const twoOverlays = (): StudioState => {
    let st = studioReducer(s0(), { type: 'SELECT_BUILTIN', borderId: firstBorderId(), url: 'bu' }); // frame
    st = studioReducer(st, { type: 'ADD_OBJECT', object: createOverlay('2d_filter', { url: 'sticker', isBuiltin: false, name: 'S' }) });
    return st;
  };

  it('a border and a sticker mix in one 2D scene; kind mirrors objects[0]', () => {
    const st = twoOverlays();
    expect(st.draft.objects.map((o) => (o as Overlay2D).overlayKind)).toEqual(['border', '2d_filter']);
    expect(st.draft.kind).toBe('border');
  });
  it('ADD_OBJECT accepts a 3D object into a 2D scene → composite (no family rejection)', () => {
    // W4: the 2D/3D family-match rejection is removed; scenes mix freely.
    let st = studioReducer(s0(), { type: 'SELECT_BUILTIN', borderId: firstBorderId(), url: 'bu' });
    st = studioReducer(st, { type: 'ADD_OBJECT', object: createObject3D('model', { assetUrl: 'x' }) });
    expect(st.draft.objects).toHaveLength(2);
    expect(st.draft.kind).toBe('composite');
  });
  it('ADD_OBJECT enforces the MAX_OBJECTS cap on stickers/3D; the frame is EXEMPT', () => {
    // W4: cap raised to 20 and counts stickers+3D only — the lone frame does not consume it.
    let st = studioReducer(s0(), { type: 'SELECT_BUILTIN', borderId: firstBorderId(), url: 'bu' }); // 1 frame
    for (let i = 0; i < MAX_OBJECTS + 3; i++) {
      st = studioReducer(st, { type: 'ADD_OBJECT', object: createOverlay('2d_filter', { url: `s${i}`, isBuiltin: false }) });
    }
    const c = sceneCounts(st.draft);
    expect(c.capped).toBe(MAX_OBJECTS);
    expect(c.frame).toBe(1);
    expect(st.draft.objects).toHaveLength(MAX_OBJECTS + 1); // frame + MAX_OBJECTS others
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
  it('objects default to hidden === undefined (visible)', () => {
    const st = twoOverlays();
    expect((st.draft.objects[0] as Overlay2D).hidden).toBeUndefined();
    expect((st.draft.objects[1] as Overlay2D).hidden).toBeUndefined();
  });
  it('UPDATE_OBJECT toggles the editor-only hidden flag', () => {
    const st0 = twoOverlays();
    const id = st0.draft.objects[1].id;
    const shown = st0.draft.objects[1] as Overlay2D;
    const st1 = studioReducer(st0, { type: 'UPDATE_OBJECT', id, patch: { hidden: !shown.hidden } });
    expect((st1.draft.objects[1] as Overlay2D).hidden).toBe(true);
    const st2 = studioReducer(st1, { type: 'UPDATE_OBJECT', id, patch: { hidden: !(st1.draft.objects[1] as Overlay2D).hidden } });
    expect((st2.draft.objects[1] as Overlay2D).hidden).toBe(false);
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

describe('face-triggered effects (Magic Triggers)', () => {
  const trig = (id: string, over: Partial<TriggerConfig> = {}): TriggerConfig => ({
    id,
    source: 'smile',
    action: { type: 'burst', style: 'confetti' },
    ...over,
  });

  it('a fresh draft starts with no triggers', () => {
    expect(initialDraft('shader').triggers).toEqual([]);
    expect(initialDraft('3d_attachment').triggers).toEqual([]);
  });

  it('ADD_TRIGGER appends and marks dirty; UPDATE patches (never id); REMOVE deletes', () => {
    let st = studioReducer(s0(), { type: 'ADD_TRIGGER', trigger: trig('a') });
    expect(st.draft.triggers).toHaveLength(1);
    expect(st.dirty).toBe(true);
    st = studioReducer(st, { type: 'ADD_TRIGGER', trigger: trig('b', { source: 'wink' }) });
    expect(st.draft.triggers.map((t) => t.id)).toEqual(['a', 'b']);

    st = studioReducer(st, { type: 'UPDATE_TRIGGER', id: 'a', patch: { action: { type: 'reveal', objectId: 'obj-1' } } });
    expect(st.draft.triggers[0].action).toEqual({ type: 'reveal', objectId: 'obj-1' });
    // Patch cannot change identity even if it tries to.
    st = studioReducer(st, { type: 'UPDATE_TRIGGER', id: 'a', patch: { source: 'browRaise' } as Partial<TriggerConfig> });
    expect(st.draft.triggers[0].id).toBe('a');
    expect(st.draft.triggers[0].source).toBe('browRaise');

    st = studioReducer(st, { type: 'REMOVE_TRIGGER', id: 'a' });
    expect(st.draft.triggers.map((t) => t.id)).toEqual(['b']);
  });

  it('UPDATE_TRIGGER / REMOVE_TRIGGER on an unknown id are no-ops', () => {
    const st = studioReducer(s0(), { type: 'ADD_TRIGGER', trigger: trig('a') });
    expect(studioReducer(st, { type: 'UPDATE_TRIGGER', id: 'zzz', patch: { cooldownMs: 100 } })).toBe(st);
    expect(studioReducer(st, { type: 'REMOVE_TRIGGER', id: 'zzz' })).toBe(st);
  });

  it('ADD_TRIGGER enforces the MAX_TRIGGERS cap', () => {
    let st = s0();
    for (let i = 0; i < MAX_TRIGGERS + 2; i++) st = studioReducer(st, { type: 'ADD_TRIGGER', trigger: trig(`t${i}`) });
    expect(st.draft.triggers).toHaveLength(MAX_TRIGGERS);
  });

  it('deleting a scene piece drops a reveal trigger that targeted it', () => {
    let st = studioReducer(s0(), { type: 'SELECT_HEAD_PIECE', pieceId: 'royal-crown' });
    const pieceId = st.draft.objects[0].id;
    st = studioReducer(st, { type: 'ADD_TRIGGER', trigger: trig('r', { action: { type: 'reveal', objectId: pieceId } }) });
    st = studioReducer(st, { type: 'ADD_TRIGGER', trigger: trig('b', { action: { type: 'burst', style: 'confetti' } }) });
    st = studioReducer(st, { type: 'DELETE_OBJECT', id: pieceId });
    // The reveal is gone (its target vanished); the burst (no target) survives.
    expect(st.draft.triggers.map((t) => t.id)).toEqual(['b']);
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

/* — W4: mixed scenes (derived kind, one-frame rule, filter slot) ---------- */

describe('mixed scenes: derived kind + one-frame rule (W4)', () => {
  const withFrame = (): StudioState =>
    studioReducer(s0(), { type: 'SELECT_BUILTIN', borderId: firstBorderId(), url: 'bu' });

  it("kind derives to 'composite' when a 2D overlay and a 3D object coexist", () => {
    let st = withFrame();
    expect(st.draft.kind).toBe('border');
    st = studioReducer(st, { type: 'SELECT_HEAD_PIECE', pieceId: 'royal-crown' });
    expect(st.draft.kind).toBe('composite');
    // remove the 3D object → back to a 2D-only kind
    const pieceId = st.draft.objects.find((o) => o.type !== 'overlay')!.id;
    st = studioReducer(st, { type: 'DELETE_OBJECT', id: pieceId });
    expect(st.draft.kind).toBe('border');
  });

  it("kind derives to '3d_attachment' for a 3D-only scene and 'shader' once emptied", () => {
    let st = studioReducer(s0(), { type: 'SELECT_HEAD_PIECE', pieceId: 'royal-crown' });
    expect(st.draft.kind).toBe('3d_attachment');
    st = studioReducer(st, { type: 'DELETE_OBJECT', id: st.draft.objects[0].id });
    expect(st.draft.kind).toBe('shader'); // no objects at all
  });

  it('a second frame REPLACES the existing frame in place (untouched); never grows', () => {
    let st = studioReducer(s0(), { type: 'SELECT_BUILTIN', borderId: borders[0].id, url: 'u1' });
    st = studioReducer(st, { type: 'ADD_OBJECT', object: createOverlay('2d_filter', { url: 's', isBuiltin: false }) });
    expect(sceneCounts(st.draft).frame).toBe(1);
    st = studioReducer(st, { type: 'SELECT_BUILTIN', borderId: borders[1].id, url: 'u2' });
    expect(sceneCounts(st.draft).frame).toBe(1); // still exactly one frame
    const frame = st.draft.objects.find((o) => (o as Overlay2D).overlayKind === 'border') as Overlay2D;
    expect(frame.builtinId).toBe(borders[1].id); // swapped design
    expect(st.draft.objects).toHaveLength(2); // frame + sticker, no growth
  });

  it('swapping a TOUCHED frame preserves its transform + animation', () => {
    let st = studioReducer(s0(), { type: 'SELECT_BUILTIN', borderId: borders[0].id, url: 'u1' });
    const frameId = st.draft.objects[0].id;
    st = studioReducer(st, { type: 'SET_TRANSFORM', transform: { scale: 1.4, x: 7, y: -3, rotation: 12 } });
    st = studioReducer(st, { type: 'SET_OBJECT_ANIMATION', id: frameId, animation: 'float' });
    st = studioReducer(st, { type: 'SELECT_BUILTIN', borderId: borders[1].id, url: 'u2' });
    const frame = st.draft.objects.find((o) => (o as Overlay2D).overlayKind === 'border') as Overlay2D;
    expect(frame.builtinId).toBe(borders[1].id); // new design applied
    expect(frame.transform).toEqual({ scale: 1.4, x: 7, y: -3, rotation: 12 }); // placement kept
    expect(frame.animation).toBe('float');
  });

  it('the frame keeps its array index when swapped', () => {
    let st = studioReducer(s0(), { type: 'ADD_OBJECT', object: createOverlay('2d_filter', { url: 's', isBuiltin: false }) });
    st = studioReducer(st, { type: 'ADD_OBJECT', object: createOverlay('border', { url: 'u1', isBuiltin: true, builtinId: borders[0].id }) });
    expect((st.draft.objects[1] as Overlay2D).overlayKind).toBe('border'); // frame at index 1
    st = studioReducer(st, { type: 'SELECT_BUILTIN', borderId: borders[1].id, url: 'u2' });
    expect((st.draft.objects[1] as Overlay2D).builtinId).toBe(borders[1].id); // replaced at index 1
    expect((st.draft.objects[0] as Overlay2D).overlayKind).toBe('2d_filter'); // sticker untouched
  });

  it('the filter slot rides alongside objects; CLEAR_FILTER empties only the slot', () => {
    let st = withFrame();
    st = studioReducer(st, { type: 'SELECT_HEAD_PIECE', pieceId: 'royal-crown' }); // composite
    st = studioReducer(st, { type: 'SELECT_SHADER', shaderId: 'vhs', params: { grain: 0.5 } });
    expect(st.draft.shaderId).toBe('vhs');
    expect(st.draft.kind).toBe('composite'); // the filter does not affect the derived kind
    st = studioReducer(st, { type: 'CLEAR_FILTER' });
    expect(st.draft.shaderId).toBe('none');
    expect(st.draft.shaderParams).toEqual({});
    expect(st.draft.objects).toHaveLength(2); // objects untouched
    expect(st.draft.kind).toBe('composite');
  });

  it('CLEAR_FILTER on an already-empty slot is a no-op', () => {
    const st = initialState('3d_attachment'); // shaderId 'none', no params
    expect(studioReducer(st, { type: 'CLEAR_FILTER' })).toBe(st);
  });
});

describe('sceneCounts (W4)', () => {
  it('counts frame (0|1), stickers, threeD, and capped = stickers + threeD', () => {
    let st = studioReducer(s0(), { type: 'SELECT_BUILTIN', borderId: firstBorderId(), url: 'bu' }); // frame
    st = studioReducer(st, { type: 'ADD_OBJECT', object: createOverlay('2d_filter', { url: 's1', isBuiltin: false }) });
    st = studioReducer(st, { type: 'ADD_OBJECT', object: createOverlay('2d_filter', { url: 's2', isBuiltin: false }) });
    st = studioReducer(st, { type: 'SELECT_HEAD_PIECE', pieceId: 'royal-crown' });
    expect(sceneCounts(st.draft)).toEqual({ frame: 1, stickers: 2, threeD: 1, capped: 3 });
  });
  it('an empty scene is all zeros', () => {
    expect(sceneCounts(initialDraft('shader'))).toEqual({ frame: 0, stickers: 0, threeD: 0, capped: 0 });
  });
});
