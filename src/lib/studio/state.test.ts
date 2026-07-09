import { describe, it, expect } from 'vitest';
import {
  studioReducer,
  initialState,
  initialDraft,
  draftHasContent,
  type StudioState,
} from './state';
import { BUILTIN_BORDERS } from '../borders';
import { HEAD_PIECE_MAP } from '../headPieces';

const s0 = (): StudioState => initialState('shader');

describe('initialDraft', () => {
  it('border/sticker drafts start with a built-in overlay selected', () => {
    for (const kind of ['border', '2d_filter'] as const) {
      const d = initialDraft(kind);
      expect(d.selectedBorderId).toBe(BUILTIN_BORDERS.find((b) => b.kind === kind)!.id);
      expect(d.overlayUrl).toMatch(/^data:image\/svg\+xml/);
      expect(d.overlayIsBuiltin).toBe(true);
    }
  });
  it('shader and 3d drafts start with no overlay', () => {
    expect(initialDraft('shader').overlayUrl).toBeNull();
    expect(initialDraft('3d_attachment').overlayUrl).toBeNull();
  });
});

describe('draftHasContent', () => {
  it('shader always has content', () => {
    expect(draftHasContent(initialDraft('shader'))).toBe(true);
  });
  it('3d needs an asset or a head piece', () => {
    const d = initialDraft('3d_attachment');
    expect(draftHasContent(d)).toBe(false);
    expect(draftHasContent({ ...d, proceduralId: 'royal-crown' })).toBe(true);
    expect(draftHasContent({ ...d, assetUrl: 'https://x/y.glb' })).toBe(true);
  });
  it('sticker needs an overlay; zero-content sticker cannot enter preview', () => {
    let st = studioReducer(s0(), { type: 'SET_KIND', kind: '2d_filter' });
    st = studioReducer(st, { type: 'CLEAR_OVERLAY' });
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

describe('kind switching (Creator2D handleKindChange semantics)', () => {
  it('switching to border restores a built-in border', () => {
    const st = studioReducer(s0(), { type: 'SET_KIND', kind: 'border' });
    expect(st.draft.overlayIsBuiltin).toBe(true);
    expect(st.draft.overlayUrl).toMatch(/^data:/);
    expect(BUILTIN_BORDERS.find((b) => b.id === st.draft.selectedBorderId)?.kind).toBe('border');
  });
  it('switching to shader clears the overlay', () => {
    let st = studioReducer(s0(), { type: 'SET_KIND', kind: 'border' });
    st = studioReducer(st, { type: 'SET_KIND', kind: 'shader' });
    expect(st.draft.overlayUrl).toBeNull();
    expect(st.draft.overlayBlob).toBeNull();
  });
  it('switching kind drops a pending custom upload blob', () => {
    let st = studioReducer(s0(), { type: 'SET_KIND', kind: '2d_filter' });
    st = studioReducer(st, { type: 'SET_OVERLAY_UPLOAD', url: 'blob:x', blob: new Blob(['x']) });
    st = studioReducer(st, { type: 'SET_KIND', kind: 'border' });
    expect(st.draft.overlayBlob).toBeNull();
    expect(st.draft.overlayIsBuiltin).toBe(true);
  });
  it('switching to a 3D kind moves the mode to 3d', () => {
    const st = studioReducer(s0(), { type: 'SET_KIND', kind: '3d_attachment' });
    expect(st.mode).toBe('3d');
  });
});

describe('anchor selection (Creator3D handleAnchorSelect semantics)', () => {
  it('same anchor is a no-op', () => {
    const st = s0();
    expect(studioReducer(st, { type: 'SELECT_ANCHOR', anchor: 'crown' })).toBe(st);
  });
  it('new anchor resets offset/rotation but keeps scale', () => {
    let st = studioReducer(s0(), { type: 'PATCH_ANCHOR_CONFIG', patch: { offset: { x: 1, y: 2, z: 3 }, scale: 2.5 } });
    st = studioReducer(st, { type: 'SELECT_ANCHOR', anchor: 'noseBridge' });
    expect(st.draft.anchor).toBe('noseBridge');
    expect(st.draft.anchorConfig.offset).toEqual({ x: 0, y: 0, z: 0 });
    expect(st.draft.anchorConfig.scale).toBe(2.5);
  });
});

describe('head pieces and model assets', () => {
  it('selecting a head piece applies its preset anchor+config and enters 3d', () => {
    const st = studioReducer(s0(), { type: 'SELECT_HEAD_PIECE', pieceId: 'neon-shades' });
    const def = HEAD_PIECE_MAP['neon-shades'];
    expect(st.mode).toBe('3d');
    expect(st.draft.proceduralId).toBe('neon-shades');
    expect(st.draft.assetUrl).toBeNull();
    expect(st.draft.anchor).toBe(def.anchor);
    expect(st.draft.anchorConfig.offset).toEqual(def.config.offset);
  });
  it('unknown head piece id is a no-op', () => {
    const st = s0();
    expect(studioReducer(st, { type: 'SELECT_HEAD_PIECE', pieceId: 'nope' })).toBe(st);
  });
  it('a GLB asset overrides any procedural piece', () => {
    let st = studioReducer(s0(), { type: 'SELECT_HEAD_PIECE', pieceId: 'royal-crown' });
    st = studioReducer(st, { type: 'SET_MODEL_ASSET', url: 'https://cdn/x.glb', name: 'x.glb' });
    expect(st.draft.assetUrl).toBe('https://cdn/x.glb');
    expect(st.draft.proceduralId).toBeNull();
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
