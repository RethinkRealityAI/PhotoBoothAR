import { describe, it, expect } from 'vitest';
import { ASSET_CUSTOMIZATION } from './controlSpecs';
import {
  normalizeCustomization,
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
  canAddObject,
  slotConflict,
  SCENE_FULL_MESSAGE,
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
  it('SET_OBJECT_TRACKING switches head → hand (default grip), zeroing placement but keeping scale', () => {
    let st = studioReducer(s0(), { type: 'SET_MODEL_ASSET', url: 'https://cdn/wand.glb', name: 'wand', scale: 7.4, offsetCm: { x: 0, y: 1.5, z: 1 } });
    const id = st.draft.selectedId as string;
    st = studioReducer(st, { type: 'SET_OBJECT_TRACKING', id, tracking: 'hand' });
    const o = selectedObject(st.draft) as Object3D;
    expect(o.handAnchor).toBe('grip');
    expect(o.anchorConfig.scale).toBe(7.4); // auto-fit survives the family switch
    expect(o.anchorConfig.offset).toEqual({ x: 0, y: 0, z: 0 }); // head nudge does not
    expect(st.dirty).toBe(true);
  });
  it('SET_OBJECT_TRACKING hand → head clears handAnchor entirely (no stale key)', () => {
    let st = studioReducer(s0(), { type: 'SET_MODEL_ASSET', url: 'https://cdn/wand.glb', name: 'wand', handAnchor: 'grip' });
    const id = st.draft.selectedId as string;
    st = studioReducer(st, { type: 'SET_OBJECT_TRACKING', id, tracking: 'head' });
    const o = selectedObject(st.draft) as Object3D;
    expect(o.handAnchor).toBeUndefined();
    expect('handAnchor' in o).toBe(false);
  });
  it('SET_OBJECT_TRACKING same-family mount swap (grip → wristBack) keeps placement tuning', () => {
    let st = studioReducer(s0(), { type: 'SET_MODEL_ASSET', url: 'https://cdn/wand.glb', name: 'wand', handAnchor: 'grip' });
    const id = st.draft.selectedId as string;
    st = studioReducer(st, { type: 'PATCH_ANCHOR_CONFIG', patch: { offset: { x: 1, y: 2, z: 3 } } });
    st = studioReducer(st, { type: 'SET_OBJECT_TRACKING', id, tracking: 'hand', handAnchor: 'wristBack' });
    const o = selectedObject(st.draft) as Object3D;
    expect(o.handAnchor).toBe('wristBack');
    expect(o.anchorConfig.offset).toEqual({ x: 1, y: 2, z: 3 });
  });
  it('SET_OBJECT_TRACKING is a no-op on overlays, unknown ids and no-change calls', () => {
    const st = studioReducer(s0(), { type: 'SET_MODEL_ASSET', url: 'https://cdn/x.glb', name: 'x' });
    const id = st.draft.selectedId as string;
    expect(studioReducer(st, { type: 'SET_OBJECT_TRACKING', id: 'ghost', tracking: 'hand' })).toBe(st);
    expect(studioReducer(st, { type: 'SET_OBJECT_TRACKING', id, tracking: 'head' })).toBe(st);
    // A bogus handAnchor id degrades to 'grip', never a broken stored string.
    const hand = studioReducer(st, { type: 'SET_OBJECT_TRACKING', id, tracking: 'hand', handAnchor: 'elbow' });
    expect((selectedObject(hand.draft) as Object3D).handAnchor).toBe('grip');
  });

  it('RETARGET_TRIGGERS repoints beam/animate at the selected object, leaves reveal alone', () => {
    let st = studioReducer(s0(), { type: 'SET_MODEL_ASSET', url: 'https://cdn/old.glb', name: 'old' });
    const oldId = st.draft.selectedId as string;
    st = studioReducer(st, { type: 'ADD_TRIGGER', trigger: { id: 't1', source: 'smile', action: { type: 'beam', style: 'optic', objectId: oldId } } });
    st = studioReducer(st, { type: 'ADD_TRIGGER', trigger: { id: 't2', source: 'wink', action: { type: 'animate', objectId: oldId, preset: 'shake' } } });
    st = studioReducer(st, { type: 'ADD_TRIGGER', trigger: { id: 't3', source: 'smile', action: { type: 'burst', style: 'confetti' } } });
    // Replace flow: delete old → add new (selected) → retarget.
    st = studioReducer(st, { type: 'DELETE_OBJECT', id: oldId });
    st = studioReducer(st, { type: 'SET_MODEL_ASSET', url: 'https://cdn/new.glb', name: 'new' });
    const newId = st.draft.selectedId as string;
    st = studioReducer(st, { type: 'RETARGET_TRIGGERS', fromId: oldId });
    const byId = Object.fromEntries(st.draft.triggers.map((t) => [t.id, t.action]));
    expect(byId.t1).toEqual({ type: 'beam', style: 'optic', objectId: newId });
    expect(byId.t2).toEqual({ type: 'animate', objectId: newId, preset: 'shake' });
    expect(byId.t3).toEqual({ type: 'burst', style: 'confetti' });
  });
  it('RETARGET_TRIGGERS with nothing selected or nothing matching is a no-op', () => {
    let st = studioReducer(s0(), { type: 'SET_MODEL_ASSET', url: 'https://cdn/x.glb', name: 'x' });
    st = studioReducer(st, { type: 'ADD_TRIGGER', trigger: { id: 't1', source: 'smile', action: { type: 'burst', style: 'confetti' } } });
    expect(studioReducer(st, { type: 'RETARGET_TRIGGERS', fromId: 'ghost' })).toBe(st);
  });

  it('slotConflict flags only the SAME mount point, never the whole family', () => {
    let st = studioReducer(s0(), { type: 'SET_MODEL_ASSET', url: 'https://cdn/visor.glb', name: 'visor', anchor: 'noseBridge' });
    const visorId = st.draft.selectedId as string;
    st = studioReducer(st, { type: 'SET_MODEL_ASSET', url: 'https://cdn/wand.glb', name: 'wand', handAnchor: 'grip' });
    // Second visor on the nose bridge → conflict with the first.
    expect(slotConflict(st.draft, { anchor: 'noseBridge' })?.id).toBe(visorId);
    // Crown + noseBridge is legitimate composition — no conflict.
    expect(slotConflict(st.draft, { anchor: 'crown' })).toBeNull();
    // Hand slots compare handAnchor: second grip prop conflicts, wrist doesn't.
    expect(slotConflict(st.draft, { handAnchor: 'grip' })?.id).toBe(st.draft.selectedId);
    expect(slotConflict(st.draft, { handAnchor: 'wristBack' })).toBeNull();
    // A hand-tracked piece never blocks a head slot (its `anchor` is vestigial).
    expect(slotConflict(st.draft, { anchor: 'crown' })).toBeNull();
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

  it('LOAD with dirty:true ARMS the leave-guard — the duplicate/template hole', () => {
    // Duplicate strips the id and LOADs. With dirty forced false the copy was
    // unsaved AND unguarded: one tap on back discarded it with no prompt.
    const st = studioReducer(s0(), { type: 'LOAD', draft: initialDraft('border'), dirty: true });
    expect(st.dirty).toBe(true);
  });

  it('LOAD without the flag still defaults to clean (opening a saved experience)', () => {
    expect(studioReducer(s0(), { type: 'LOAD', draft: initialDraft('border') }).dirty).toBe(false);
    expect(studioReducer(s0(), { type: 'LOAD', draft: initialDraft('border'), dirty: false }).dirty).toBe(false);
  });
});

/** A frame + a sticker, the shape most reorder/rename assertions need. */
const twoOverlayScene = (): StudioState => {
  let st = studioReducer(s0(), { type: 'SELECT_BUILTIN', borderId: firstBorderId(), url: 'bu' });
  st = studioReducer(st, { type: 'ADD_OBJECT', object: createOverlay('2d_filter', { url: 'sticker', isBuiltin: false, name: 'S' }) });
  return st;
};

describe('MOVE_OBJECT — drag-to-reorder', () => {
  const fourLayers = (): StudioState => {
    let st = s0();
    for (const s of stickers.slice(0, 4)) st = studioReducer(st, { type: 'SELECT_BUILTIN', borderId: s.id, url: 'u' });
    return st;
  };

  it('splice-moves rather than swapping', () => {
    const st0 = fourLayers();
    const ids = st0.draft.objects.map((o) => o.id);
    const st = studioReducer(st0, { type: 'MOVE_OBJECT', id: ids[0], toIndex: 3 });
    expect(st.draft.objects.map((o) => o.id)).toEqual([ids[1], ids[2], ids[3], ids[0]]);
  });

  it('moves backwards too', () => {
    const st0 = fourLayers();
    const ids = st0.draft.objects.map((o) => o.id);
    const st = studioReducer(st0, { type: 'MOVE_OBJECT', id: ids[3], toIndex: 0 });
    expect(st.draft.objects.map((o) => o.id)).toEqual([ids[3], ids[0], ids[1], ids[2]]);
  });

  it('marks the draft dirty and recomputes kind', () => {
    const st0 = twoOverlayScene();
    const st = studioReducer(st0, { type: 'MOVE_OBJECT', id: st0.draft.objects[1].id, toIndex: 0 });
    expect(st.dirty).toBe(true);
    expect(st.draft.kind).toBe('2d_filter');
  });

  it('is a strict no-op for an unknown id or a move to the same place', () => {
    const st0 = fourLayers();
    expect(studioReducer(st0, { type: 'MOVE_OBJECT', id: 'nope', toIndex: 0 })).toBe(st0);
    expect(studioReducer(st0, { type: 'MOVE_OBJECT', id: st0.draft.objects[2].id, toIndex: 2 })).toBe(st0);
  });

  it('clamps an out-of-range target instead of losing the layer', () => {
    const st0 = fourLayers();
    const ids = st0.draft.objects.map((o) => o.id);
    const st = studioReducer(st0, { type: 'MOVE_OBJECT', id: ids[0], toIndex: 999 });
    expect(st.draft.objects).toHaveLength(4);
    expect(st.draft.objects[3].id).toBe(ids[0]);
  });

  it('never drops or duplicates a layer', () => {
    const st0 = fourLayers();
    const ids = st0.draft.objects.map((o) => o.id);
    for (let from = 0; from < 4; from++) {
      for (let to = 0; to < 4; to++) {
        const st = studioReducer(st0, { type: 'MOVE_OBJECT', id: ids[from], toIndex: to });
        expect(new Set(st.draft.objects.map((o) => o.id))).toEqual(new Set(ids));
      }
    }
  });
});

describe('RENAME_OBJECT', () => {
  it('renames a layer and marks the draft dirty', () => {
    const st0 = twoOverlayScene();
    const id = st0.draft.objects[1].id;
    const st = studioReducer(st0, { type: 'RENAME_OBJECT', id, name: '  Balloon arch  ' });
    expect(st.draft.objects[1].name).toBe('Balloon arch');
    expect(st.dirty).toBe(true);
  });

  it('refuses an empty name rather than producing a nameless layer', () => {
    const st0 = twoOverlayScene();
    expect(studioReducer(st0, { type: 'RENAME_OBJECT', id: st0.draft.objects[0].id, name: '   ' })).toBe(st0);
  });

  it('bounds an absurd name', () => {
    const st0 = twoOverlayScene();
    const st = studioReducer(st0, { type: 'RENAME_OBJECT', id: st0.draft.objects[0].id, name: 'x'.repeat(1000) });
    expect(st.draft.objects[0].name.length).toBe(120);
  });

  it('is a no-op for an unknown id or an unchanged name', () => {
    const st0 = twoOverlayScene();
    const o = st0.draft.objects[0];
    expect(studioReducer(st0, { type: 'RENAME_OBJECT', id: 'nope', name: 'x' })).toBe(st0);
    expect(studioReducer(st0, { type: 'RENAME_OBJECT', id: o.id, name: o.name })).toBe(st0);
  });

  it('never changes the object identity or count', () => {
    const st0 = twoOverlayScene();
    const st = studioReducer(st0, { type: 'RENAME_OBJECT', id: st0.draft.objects[0].id, name: 'Renamed' });
    expect(st.draft.objects).toHaveLength(2);
    expect(st.draft.objects[0].id).toBe(st0.draft.objects[0].id);
    expect(st.draft.objects[0].type).toBe(st0.draft.objects[0].type);
  });
});

describe('canAddObject — the cap must be askable BEFORE the add', () => {
  it('is true on an empty scene and false at the cap', () => {
    let st = s0();
    expect(canAddObject(st.draft)).toBe(true);
    for (let i = 0; i < MAX_OBJECTS; i++) {
      st = studioReducer(st, { type: 'ADD_OBJECT', object: createOverlay('2d_filter', { url: 'u' }) });
    }
    expect(sceneCounts(st.draft).capped).toBe(MAX_OBJECTS);
    expect(canAddObject(st.draft)).toBe(false);
  });

  it('always allows a frame — placeFrame swaps in place and is cap-exempt', () => {
    let st = s0();
    for (let i = 0; i < MAX_OBJECTS; i++) {
      st = studioReducer(st, { type: 'ADD_OBJECT', object: createOverlay('2d_filter', { url: 'u' }) });
    }
    expect(canAddObject(st.draft, 'frame')).toBe(true);
    const withFrame = studioReducer(st, { type: 'ADD_OBJECT', object: createOverlay('border', { url: 'f' }) });
    expect(withFrame.draft.objects).toHaveLength(MAX_OBJECTS + 1);
  });

  it('agrees with what the reducer actually does', () => {
    let st = s0();
    for (let i = 0; i < MAX_OBJECTS + 3; i++) {
      const allowed = canAddObject(st.draft);
      const next = studioReducer(st, { type: 'ADD_OBJECT', object: createOverlay('2d_filter', { url: 'u' }) });
      expect(next !== st).toBe(allowed);
      st = next;
    }
  });

  it('the shared refusal message names the real limit', () => {
    expect(SCENE_FULL_MESSAGE).toContain(String(MAX_OBJECTS));
    expect(SCENE_FULL_MESSAGE.length).toBeGreaterThan(20);
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

describe('SET_FINISH (W6 material finishes)', () => {
  const with3D = () => {
    let st = initialState('3d_attachment');
    st = studioReducer(st, { type: 'ADD_OBJECT', object: createObject3D('model', { assetUrl: 'https://cdn/a.glb' }), select: true });
    return st;
  };

  it('sets a finish on the selected 3D object and marks the draft dirty', () => {
    let st = with3D();
    st = studioReducer(st, { type: 'SET_FINISH', finish: 'gold' });
    expect((selectedObject(st.draft) as Object3D).finish).toBe('gold');
    expect(st.dirty).toBe(true);
  });

  it('resetting to original DELETES the key rather than storing the default', () => {
    let st = with3D();
    st = studioReducer(st, { type: 'SET_FINISH', finish: 'gold' });
    st = studioReducer(st, { type: 'SET_FINISH', finish: 'original' });
    const o = selectedObject(st.draft) as Object3D;
    expect('finish' in o).toBe(false);
  });

  it('tint: null is an explicit CLEAR and drops the orphaned strength with it', () => {
    let st = with3D();
    st = studioReducer(st, { type: 'SET_FINISH', tint: '#ff0000' });
    st = studioReducer(st, { type: 'SET_FINISH', tintStrength: 0.3 });
    let o = selectedObject(st.draft) as Object3D;
    expect(o.tint).toBe('#ff0000');
    expect(o.tintStrength).toBeCloseTo(0.3);
    st = studioReducer(st, { type: 'SET_FINISH', tint: null });
    o = selectedObject(st.draft) as Object3D;
    expect('tint' in o).toBe(false);
    expect('tintStrength' in o).toBe(false);
  });

  it('one field at a time — changing the finish keeps the tint', () => {
    let st = with3D();
    st = studioReducer(st, { type: 'SET_FINISH', tint: '#00ff00', tintStrength: 0.5 });
    st = studioReducer(st, { type: 'SET_FINISH', finish: 'chrome' });
    const o = selectedObject(st.draft) as Object3D;
    expect(o.finish).toBe('chrome');
    expect(o.tint).toBe('#00ff00');
    expect(o.tintStrength).toBeCloseTo(0.5);
  });

  it('normalizes hostile input instead of storing it', () => {
    let st = with3D();
    st = studioReducer(st, { type: 'SET_FINISH', finish: 'javascript:alert(1)', tint: 'url(evil)' });
    const o = selectedObject(st.draft) as Object3D;
    expect('finish' in o).toBe(false);
    expect('tint' in o).toBe(false);
  });

  it('is a no-op with nothing selected, and never touches a 2D overlay', () => {
    const empty = initialState('3d_attachment');
    expect(studioReducer(empty, { type: 'SET_FINISH', finish: 'gold' })).toBe(empty);

    let st = initialState('2d_filter');
    st = studioReducer(st, { type: 'ADD_OBJECT', object: createOverlay('2d_filter', { url: 'blob:x', isBuiltin: false }), select: true });
    const before = st;
    expect(studioReducer(st, { type: 'SET_FINISH', finish: 'gold' })).toBe(before);
  });
});

describe('SET_CUSTOMIZATION (per-asset personalisation)', () => {
  const with3D = () => {
    let st = initialState('3d_attachment');
    st = studioReducer(st, { type: 'ADD_OBJECT', object: createObject3D('model', { assetUrl: 'https://cdn/hat.glb' }), select: true });
    return st;
  };
  const sel = (st: ReturnType<typeof with3D>) => selectedObject(st.draft) as Object3D;

  it('a fresh object carries NO customization key at all', () => {
    expect('customization' in sel(with3D())).toBe(false);
  });

  it('styles one region and marks the draft dirty', () => {
    let st = with3D();
    st = studioReducer(st, { type: 'SET_CUSTOMIZATION', part: { id: 'band', hex: '#D4A017' } });
    expect(sel(st).customization).toEqual({ parts: { band: { hex: '#d4a017' } } });
    expect(st.dirty).toBe(true);
  });

  it('regions accumulate, one field at a time', () => {
    let st = with3D();
    st = studioReducer(st, { type: 'SET_CUSTOMIZATION', part: { id: 'band', hex: '#d4a017' } });
    st = studioReducer(st, { type: 'SET_CUSTOMIZATION', part: { id: 'band', finish: 'chrome' } });
    st = studioReducer(st, { type: 'SET_CUSTOMIZATION', part: { id: 'crown', finish: 'matte' } });
    expect(sel(st).customization?.parts).toEqual({
      band: { hex: '#d4a017', finish: 'chrome' },
      crown: { finish: 'matte' },
    });
  });

  it("finish 'original' is the default and is never stored", () => {
    let st = with3D();
    st = studioReducer(st, { type: 'SET_CUSTOMIZATION', part: { id: 'band', finish: 'original' } });
    expect('customization' in sel(st)).toBe(false);
  });

  it('clearing the last region REMOVES the key rather than leaving an empty object', () => {
    let st = with3D();
    st = studioReducer(st, { type: 'SET_CUSTOMIZATION', part: { id: 'band', hex: '#d4a017', finish: 'gold' } });
    st = studioReducer(st, { type: 'SET_CUSTOMIZATION', part: { id: 'band', hex: null, finish: null } });
    expect('customization' in sel(st)).toBe(false);
  });

  it('label: set, keep across a region edit, then null-clear', () => {
    let st = with3D();
    const label = { slotId: 'front', token: 'guestName' as const, style: 'script' as const, hex: '#ffffff' };
    st = studioReducer(st, { type: 'SET_CUSTOMIZATION', label });
    expect(sel(st).customization?.label).toEqual(label);
    st = studioReducer(st, { type: 'SET_CUSTOMIZATION', part: { id: 'band', hex: '#ff0000' } });
    expect(sel(st).customization?.label).toEqual(label);
    st = studioReducer(st, { type: 'SET_CUSTOMIZATION', label: null });
    expect(sel(st).customization?.label).toBeUndefined();
    expect(sel(st).customization?.parts).toEqual({ band: { hex: '#ff0000' } });
  });

  it('normalizes hostile input instead of storing it', () => {
    let st = with3D();
    st = studioReducer(st, { type: 'SET_CUSTOMIZATION', part: { id: 'evil', hex: 'url(javascript:alert(1))', finish: 'DROP TABLE' } });
    expect('customization' in sel(st)).toBe(false);
  });

  it('is a no-op with nothing selected, and never touches a 2D overlay', () => {
    const empty = initialState('3d_attachment');
    expect(studioReducer(empty, { type: 'SET_CUSTOMIZATION', part: { id: 'band', hex: '#fff' } })).toBe(empty);
    let st = initialState('border');
    st = studioReducer(st, { type: 'ADD_OBJECT', object: createOverlay('border', { url: 'x' }), select: true });
    const before = st;
    expect(studioReducer(st, { type: 'SET_CUSTOMIZATION', part: { id: 'band', hex: '#fff' } })).toBe(before);
  });
});

describe('normalizeCustomization', () => {
  it('rejects non-objects and empty shapes without throwing', () => {
    for (const v of [null, undefined, 42, 'x', [], {}, { parts: {} }, { parts: [] }, { label: {} }]) {
      expect(normalizeCustomization(v)).toBeUndefined();
    }
  });

  it('emits region keys in sorted order so the same styling always serialises the same', () => {
    const a = normalizeCustomization({ parts: { zeta: { hex: '#111111' }, alpha: { hex: '#222222' } } });
    const b = normalizeCustomization({ parts: { alpha: { hex: '#222222' }, zeta: { hex: '#111111' } } });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(Object.keys(a!.parts!)).toEqual(['alpha', 'zeta']);
  });

  it('caps the number of regions at the shared bound', () => {
    const parts: Record<string, { hex: string }> = {};
    for (let i = 0; i < ASSET_CUSTOMIZATION.maxParts + 7; i += 1) parts[`r${String(i).padStart(2, '0')}`] = { hex: '#010203' };
    expect(Object.keys(normalizeCustomization({ parts })!.parts!)).toHaveLength(ASSET_CUSTOMIZATION.maxParts);
  });

  it('trims a label to the shared length bound and drops a blank fixed line', () => {
    const long = 'x'.repeat(ASSET_CUSTOMIZATION.maxLabelLength + 20);
    const c = normalizeCustomization({ label: { slotId: 'front', token: 'fixed', text: long, style: 'block', hex: '#ABCDEF' } });
    expect(c!.label!.text).toHaveLength(ASSET_CUSTOMIZATION.maxLabelLength);
    expect(c!.label!.hex).toBe('#abcdef');
    expect(normalizeCustomization({ label: { slotId: 'front', token: 'fixed', text: '   ', style: 'block', hex: '#fff' } })).toBeUndefined();
  });

  it('a guestName label keeps its slot with no text — the name arrives at booth time', () => {
    const c = normalizeCustomization({ label: { slotId: 'front', token: 'guestName', style: 'script', hex: '#fff' } });
    expect(c!.label).toEqual({ slotId: 'front', token: 'guestName', style: 'script', hex: '#ffffff' });
    expect('text' in c!.label!).toBe(false);
  });

  it('rejects an unknown style and an unknown token outright', () => {
    expect(normalizeCustomization({ label: { slotId: 'f', token: 'guestName', style: 'comic', hex: '#fff' } })).toBeUndefined();
    expect(normalizeCustomization({ label: { slotId: 'f', token: 'sql', style: 'block', hex: '#fff' } })).toBeUndefined();
    expect(normalizeCustomization({ label: { slotId: '', token: 'guestName', style: 'block', hex: '#fff' } })).toBeUndefined();
  });
});

describe('SET_MODEL_ASSET carries a configurator template when the asset ships one', () => {
  it('stores it on the object, and omits the key entirely when absent', () => {
    const tpl = { id: 'hat', glbUrl: 'https://cdn/hat.glb' };
    let st = studioReducer(initialState('3d_attachment'), { type: 'SET_MODEL_ASSET', url: 'https://cdn/hat.glb', name: 'Hat', template: tpl });
    expect((selectedObject(st.draft) as Object3D).template).toEqual(tpl);
    st = studioReducer(initialState('3d_attachment'), { type: 'SET_MODEL_ASSET', url: 'https://cdn/m.glb', name: 'M' });
    expect('template' in (selectedObject(st.draft) as Object3D)).toBe(false);
  });
});
