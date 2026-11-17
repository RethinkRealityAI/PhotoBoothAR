/**
 * Regression tests for the 2026-11 Studio UI/UX audit fixes. Each block names
 * the finding it pins. Kept in one file so the whole set can be run against
 * the pre-fix modules to prove each test failed before its fix.
 */
import { afterEach, describe, it, expect } from 'vitest';
import {
  studioReducer,
  initialState,
  createOverlay,
  createObject3D,
  draftContentUnchanged,
  pruneTriggersFor,
  preserveViewOnTimeTravel,
  type StudioAction,
  type StudioState,
  type Overlay2D,
} from './state';
import { withHistory, initHistory } from './history';
import { saveUploadFailures, uploadFailureMessage } from './draftSafety';
import { isDuplicateTrigger, sameTriggerAction, type TriggerConfig } from './triggers';
import {
  clearTriggerTestSubscribers,
  hasTriggerTestSubscriber,
  requestTriggerTest,
  subscribeTriggerTest,
  subscribeTriggerTestAvailability,
  type TriggerTestRequest,
} from './fxBus';

const blobA = new Blob(['a'], { type: 'image/png' });
const blobB = new Blob(['b'], { type: 'image/png' });

function withUpload(blob: Blob = blobA): StudioState {
  return studioReducer(initialState('shader'), {
    type: 'ADD_OBJECT',
    object: createOverlay('2d_filter', { url: 'blob:local', blob, isBuiltin: false, name: 'Logo' }),
  });
}

describe('#1 MARK_SAVED only clears dirty when the saved draft is still current', () => {
  it('an edit made while the save was in flight stays dirty', () => {
    const atSave = withUpload();
    const saved = atSave.draft;
    const edited = studioReducer(atSave, { type: 'SET_NAME', name: 'edited mid-save' });
    const after = studioReducer(edited, { type: 'MARK_SAVED', id: 'row1', saved });
    expect(after.dirty).toBe(true);
    expect(after.draft.name).toBe('edited mid-save');
    expect(after.draft.id).toBe('row1');
  });
  it('an unchanged draft is marked clean', () => {
    const st = withUpload();
    expect(studioReducer(st, { type: 'MARK_SAVED', id: 'row1', saved: st.draft }).dirty).toBe(false);
  });
  it('a selection change during the save is not unsaved work', () => {
    const st = withUpload();
    const reselected = studioReducer(st, { type: 'SELECT_OBJECT', id: null });
    expect(reselected.draft).not.toBe(st.draft);
    expect(studioReducer(reselected, { type: 'MARK_SAVED', id: 'r', saved: st.draft }).dirty).toBe(false);
  });
  it('draftContentUnchanged ignores selectedId only', () => {
    const st = withUpload();
    expect(draftContentUnchanged(st.draft, { ...st.draft, selectedId: null })).toBe(true);
    expect(draftContentUnchanged(st.draft, { ...st.draft, name: 'x' })).toBe(false);
  });
});

describe('#27 MARK_SAVED swaps an uploaded blob for its stored URL', () => {
  it('the same blob is replaced, so the next save does not re-upload it', () => {
    const st = withUpload();
    const id = st.draft.objects[0].id;
    const after = studioReducer(st, { type: 'MARK_SAVED', id: 'r', saved: st.draft, uploaded: { [id]: 'https://cdn/logo.png' } });
    const o = after.draft.objects[0] as Overlay2D;
    expect(o.url).toBe('https://cdn/logo.png');
    expect(o.blob).toBeNull();
  });
  it('an image re-picked during the save is kept (it is new work)', () => {
    const st = withUpload(blobA);
    const id = st.draft.objects[0].id;
    const repicked = studioReducer(st, { type: 'UPDATE_OBJECT', id, patch: { blob: blobB, url: 'blob:new' } });
    const after = studioReducer(repicked, { type: 'MARK_SAVED', id: 'r', saved: st.draft, uploaded: { [id]: 'https://cdn/a.png' } });
    const o = after.draft.objects[0] as Overlay2D;
    expect(o.blob).toBe(blobB);
    expect(o.url).toBe('blob:new');
    expect(after.dirty).toBe(true);
  });
  it('the thumbnail swaps the same way', () => {
    const st = studioReducer(withUpload(), { type: 'SET_THUMB', url: 'blob:t', blob: blobB });
    const after = studioReducer(st, { type: 'MARK_SAVED', id: 'r', saved: st.draft, thumbUrl: 'https://cdn/t.png' });
    expect(after.draft.thumbUrl).toBe('https://cdn/t.png');
    expect(after.draft.thumbBlob).toBeNull();
  });
  it('a bare {id} keeps the old unconditional behaviour', () => {
    const st = studioReducer(withUpload(), { type: 'SET_NAME', name: 'n' });
    const after = studioReducer(st, { type: 'MARK_SAVED', id: 'r' });
    expect(after.dirty).toBe(false);
    expect((after.draft.objects[0] as Overlay2D).blob).toBe(blobA);
  });
});

describe('#2 saveUploadFailures — a layer that would save without its image', () => {
  it('flags an overlay whose upload returned null, and a failed thumbnail', () => {
    const st = studioReducer(withUpload(), { type: 'SET_THUMB', url: 'blob:t', blob: blobB });
    const id = st.draft.objects[0].id;
    expect(saveUploadFailures(st.draft, new Map([[id, null]]), null)).toEqual(['Logo', 'Thumbnail']);
    expect(saveUploadFailures(st.draft, new Map([[id, 'https://cdn/x.png']]), 'https://cdn/t.png')).toEqual([]);
  });
  it('3D pieces with no URL (procedural) are not failures', () => {
    const st = studioReducer(initialState('shader'), { type: 'SELECT_HEAD_PIECE', pieceId: 'royal-crown' });
    expect(saveUploadFailures(st.draft, new Map([[st.draft.objects[0].id, null]]), null)).toEqual([]);
  });
  it('the message is plain and says nothing was saved', () => {
    expect(uploadFailureMessage(['Logo'])).toMatch(/“Logo” didn't upload — nothing was saved/);
    expect(uploadFailureMessage(['a', 'b'])).toMatch(/^2 images didn't upload/);
    expect(uploadFailureMessage([])).toBe('');
  });
});

const historyReducer = withHistory<StudioState, StudioAction>(studioReducer, {
  record: (a) => a.type !== 'SET_MODE' && a.type !== 'SET_THREE_VIEW' && a.type !== 'SELECT_OBJECT' && a.type !== 'SET_KIND',
  clear: (a) => a.type === 'LOAD' || a.type === 'MARK_SAVED',
  preserve: preserveViewOnTimeTravel,
});

describe('#13 BATCH — one compound edit is one undo step', () => {
  it('folds every action and undoes in one step', () => {
    let h = initHistory(initialState('shader'));
    h = historyReducer(h, {
      type: 'BATCH',
      actions: [
        { type: 'SET_MODEL_ASSET', url: 'https://cdn/visor.glb', name: 'Visor' },
        { type: 'ADD_TRIGGER', trigger: { id: 't', source: 'smile', action: { type: 'burst', style: 'confetti' } } },
      ],
    });
    expect(h.present.draft.objects).toHaveLength(1);
    expect(h.present.draft.triggers).toHaveLength(1);
    expect(h.past).toHaveLength(1);
    h = historyReducer(h, { type: 'UNDO' });
    expect(h.present.draft.objects).toHaveLength(0);
    expect(h.present.draft.triggers).toHaveLength(0);
  });
  it('Replace as a BATCH keeps the blast wired to the replacement', () => {
    let st = studioReducer(initialState('shader'), { type: 'SET_MODEL_ASSET', url: 'https://cdn/old.glb', name: 'old' });
    const oldId = st.draft.selectedId as string;
    st = studioReducer(st, { type: 'ADD_TRIGGER', trigger: { id: 'b', source: 'smile', action: { type: 'beam', style: 'optic', objectId: oldId } } });
    st = studioReducer(st, {
      type: 'BATCH',
      actions: [
        { type: 'DELETE_OBJECT', id: oldId },
        { type: 'SET_MODEL_ASSET', url: 'https://cdn/new.glb', name: 'new' },
        { type: 'RETARGET_TRIGGERS', fromId: oldId },
      ],
    });
    expect(st.draft.triggers[0].action).toEqual({ type: 'beam', style: 'optic', objectId: st.draft.selectedId });
  });
});

describe('#14 a host delete prunes triggers that named the piece', () => {
  const trig = (id: string, action: TriggerConfig['action']): TriggerConfig => ({ id, source: 'smile', action });
  it('drops animate, unpins beam, keeps unrelated triggers', () => {
    let st = studioReducer(initialState('shader'), { type: 'SET_MODEL_ASSET', url: 'https://cdn/a.glb', name: 'a' });
    const id = st.draft.selectedId as string;
    st = studioReducer(st, { type: 'ADD_TRIGGER', trigger: trig('an', { type: 'animate', objectId: id, preset: 'spin' }) });
    st = studioReducer(st, { type: 'ADD_TRIGGER', trigger: trig('bm', { type: 'beam', style: 'energy', objectId: id }) });
    st = studioReducer(st, { type: 'ADD_TRIGGER', trigger: trig('bu', { type: 'burst', style: 'hearts' }) });
    st = studioReducer(st, { type: 'DELETE_OBJECT', id, pruneTriggers: true });
    expect(st.draft.triggers).toEqual([
      trig('bm', { type: 'beam', style: 'energy' }),
      trig('bu', { type: 'burst', style: 'hearts' }),
    ]);
  });
  it('pruneTriggersFor returns the same array when nothing referenced the id', () => {
    const ts = [trig('x', { type: 'burst', style: 'confetti' })];
    expect(pruneTriggersFor(ts, 'nope')).toBe(ts);
  });
});

describe('#4 a 3D add from the 2D view switches the stage to 3D', () => {
  it('ADD_OBJECT of a selected 3D prop leaves 2D', () => {
    const st = studioReducer(initialState('shader'), { type: 'ADD_OBJECT', object: createObject3D('model', { assetUrl: 'https://cdn/crown.glb' }) });
    expect(st.mode).toBe('3d');
  });
  it('an unselected (background) 3D add and 2D adds keep the view', () => {
    const a = studioReducer(initialState('shader'), { type: 'ADD_OBJECT', object: createObject3D('model', { assetUrl: 'x' }), select: false });
    expect(a.mode).toBe('2d');
    const b = studioReducer(initialState('shader'), { type: 'ADD_OBJECT', object: createOverlay('2d_filter', { url: 's', isBuiltin: false }) });
    expect(b.mode).toBe('2d');
  });
});

describe('#16 undo/redo restores content but keeps the current view', () => {
  it('Ctrl+Z in Preview stays in Preview', () => {
    let h = initHistory(initialState('shader')); // shader slot set → previewable
    h = historyReducer(h, { type: 'ADD_OBJECT', object: createOverlay('2d_filter', { url: 's', isBuiltin: false }) });
    h = historyReducer(h, { type: 'SET_NAME', name: 'n' });
    h = historyReducer(h, { type: 'SET_MODE', mode: 'preview' });
    h = historyReducer(h, { type: 'UNDO' });
    expect(h.present.draft.name).not.toBe('n');
    expect(h.present.mode).toBe('preview');
    h = historyReducer(h, { type: 'REDO' });
    expect(h.present.mode).toBe('preview');
  });
  it('falls back when Preview would have nothing to show', () => {
    const from = { ...initialState('shader'), mode: 'preview' as const };
    const to = { ...initialState('3d_attachment') }; // empty, shader 'none'
    expect(preserveViewOnTimeTravel(from, to).mode).toBe(to.mode);
  });
});

describe('#12 duplicate detection shared by add and in-place edit', () => {
  const ts: TriggerConfig[] = [{ id: 'a', source: 'smile', action: { type: 'beam', style: 'optic' } }];
  it('an absent beam colour equals auto', () => {
    expect(sameTriggerAction({ type: 'beam', style: 'optic' }, { type: 'beam', style: 'optic', color: 'auto' })).toBe(true);
  });
  it('editing a row is not a duplicate of itself, but is of another row', () => {
    expect(isDuplicateTrigger(ts, 'smile', { type: 'beam', style: 'optic' }, 'a')).toBe(false);
    expect(isDuplicateTrigger(ts, 'smile', { type: 'beam', style: 'optic' }, 'b')).toBe(true);
    expect(isDuplicateTrigger(ts, 'wink', { type: 'beam', style: 'optic' })).toBe(false);
  });
});

describe('#12 fxBus trigger-test channel', () => {
  afterEach(() => clearTriggerTestSubscribers());
  it('reports false with no stage, delivers when subscribed, and signals availability', () => {
    const req: TriggerTestRequest = { source: 'pinch', action: { type: 'burst', style: 'sparkles' } };
    expect(requestTriggerTest(req)).toBe(false);
    let pings = 0;
    subscribeTriggerTestAvailability(() => { pings += 1; });
    const got: TriggerTestRequest[] = [];
    const off = subscribeTriggerTest((r) => got.push(r));
    expect(hasTriggerTestSubscriber()).toBe(true);
    expect(requestTriggerTest(req)).toBe(true);
    expect(got).toEqual([req]);
    off();
    expect(hasTriggerTestSubscriber()).toBe(false);
    expect(pings).toBe(2);
  });
});
