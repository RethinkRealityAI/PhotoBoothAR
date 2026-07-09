/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Studio editor state — a pure reducer driving the unified StudioShell
 * (mode switching, the current draft experience, and edit-session flags).
 * Kept free of React/Three/Supabase so vitest (node env) can exercise every
 * transition. Undo/redo, if ever needed, is a {past,present,future} wrapper
 * around this reducer.
 *
 * Kind-switch semantics replicate the old Creator2D.handleKindChange exactly
 * (border/sticker restore a built-in default; shader clears the overlay), and
 * anchor selection replicates Creator3D.handleAnchorSelect (same anchor is a
 * no-op; a new anchor resets offset/rotation but keeps scale).
 */
import type { ExperienceKind, HeadAnchor, Transform2D } from '../../types';
import { BUILTIN_BORDERS, toDataUrl } from '../borders';
import { HEAD_PIECE_MAP } from '../headPieces';

export type StudioMode = '2d' | '3d' | 'preview';
export type ThreeView = 'live' | 'orbit';
export type StudioKind = Exclude<ExperienceKind, 'composite'>;

export interface Vec3Obj { x: number; y: number; z: number }

export interface StudioAnchorConfig {
  offset: Vec3Obj;
  rotation: Vec3Obj;
  scale: number;
}

export const DEFAULT_TRANSFORM: Transform2D = { scale: 1, x: 0, y: 0, rotation: 0 };
export const DEFAULT_ANCHOR_CONFIG: StudioAnchorConfig = {
  offset: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: 1,
};

export interface StudioDraft {
  /** Set when editing an existing experience (?id= deep link). */
  id?: string;
  name: string;
  kind: StudioKind;
  isPublished: boolean;
  featured: boolean;
  /* — 2D — */
  shaderId: string;
  shaderParams: Record<string, number>;
  overlayUrl: string | null;
  /** Blob pending upload for a custom overlay (upload happens at save). */
  overlayBlob: Blob | null;
  overlayIsBuiltin: boolean;
  selectedBorderId: string;
  transform: Transform2D;
  /* — 3D — */
  assetUrl: string | null;
  proceduralId: string | null;
  assetName: string | null;
  anchor: HeadAnchor;
  anchorConfig: StudioAnchorConfig;
  /* — shared — */
  thumbUrl: string | null;
  thumbBlob: Blob | null;
  /** Scene Director grouping tag (config.scene on save). */
  scene?: string;
  /** Per-experience occlusion opt-out (config.occlusion === false). */
  occlusion: boolean;
}

export interface StudioState {
  mode: StudioMode;
  threeView: ThreeView;
  paused: boolean;
  draft: StudioDraft;
  /** True once the draft diverged from its loaded/initial snapshot. */
  dirty: boolean;
}

const DEFAULT_SHADER_ID = 'golden-hour-bloom';

function defaultBorderFor(kind: 'border' | '2d_filter'): { id: string; url: string } | null {
  const b = BUILTIN_BORDERS.find((x) => x.kind === kind);
  return b ? { id: b.id, url: toDataUrl(b.svg) } : null;
}

export function initialDraft(kind: StudioKind = 'shader'): StudioDraft {
  const draft: StudioDraft = {
    name: kind === '3d_attachment' ? 'Untitled 3D Experience' : 'Untitled Experience',
    kind,
    isPublished: true,
    featured: true,
    shaderId: DEFAULT_SHADER_ID,
    shaderParams: {},
    overlayUrl: null,
    overlayBlob: null,
    overlayIsBuiltin: true,
    selectedBorderId: '',
    transform: { ...DEFAULT_TRANSFORM },
    assetUrl: null,
    proceduralId: null,
    assetName: null,
    anchor: 'crown',
    anchorConfig: {
      offset: { ...DEFAULT_ANCHOR_CONFIG.offset },
      rotation: { ...DEFAULT_ANCHOR_CONFIG.rotation },
      scale: 1,
    },
    thumbUrl: null,
    thumbBlob: null,
    occlusion: true,
  };
  if (kind === 'border' || kind === '2d_filter') {
    const def = defaultBorderFor(kind);
    if (def) {
      draft.selectedBorderId = def.id;
      draft.overlayUrl = def.url;
    }
  }
  return draft;
}

export function initialState(kind: StudioKind = 'shader'): StudioState {
  return {
    mode: kind === '3d_attachment' ? '3d' : '2d',
    threeView: 'live',
    paused: false,
    draft: initialDraft(kind),
    dirty: false,
  };
}

/** Modes that need the draft to have visible content before entering. */
export function draftHasContent(d: StudioDraft): boolean {
  switch (d.kind) {
    case 'shader':
      return true; // a shader is always previewable
    case 'border':
    case '2d_filter':
      return d.overlayUrl !== null;
    case '3d_attachment':
      return d.assetUrl !== null || d.proceduralId !== null;
  }
}

export type StudioAction =
  | { type: 'SET_MODE'; mode: StudioMode }
  | { type: 'SET_THREE_VIEW'; view: ThreeView }
  | { type: 'SET_PAUSED'; paused: boolean }
  | { type: 'SET_KIND'; kind: StudioKind }
  | { type: 'LOAD'; draft: StudioDraft }
  | { type: 'SET_NAME'; name: string }
  | { type: 'SELECT_SHADER'; shaderId: string; params: Record<string, number> }
  | { type: 'SET_SHADER_PARAM'; key: string; value: number }
  | { type: 'SET_SHADER_PARAMS'; params: Record<string, number> }
  | { type: 'SELECT_BUILTIN'; borderId: string; url: string }
  | { type: 'SET_OVERLAY_UPLOAD'; url: string; blob: Blob | null }
  | { type: 'CLEAR_OVERLAY' }
  | { type: 'SET_TRANSFORM'; transform: Transform2D }
  | { type: 'SELECT_ANCHOR'; anchor: HeadAnchor }
  | { type: 'PATCH_ANCHOR_CONFIG'; patch: Partial<StudioAnchorConfig> }
  | { type: 'SELECT_HEAD_PIECE'; pieceId: string }
  | { type: 'SET_MODEL_ASSET'; url: string; name: string | null }
  | { type: 'SET_THUMB'; url: string | null; blob: Blob | null }
  | { type: 'TOGGLE_PUBLISHED' }
  | { type: 'TOGGLE_FEATURED' }
  | { type: 'SET_OCCLUSION'; occlusion: boolean }
  | { type: 'SET_SCENE_TAG'; scene: string | undefined }
  | { type: 'MARK_SAVED'; id: string };

function modeForKind(kind: StudioKind): StudioMode {
  return kind === '3d_attachment' ? '3d' : '2d';
}

export function studioReducer(state: StudioState, action: StudioAction): StudioState {
  const d = state.draft;
  switch (action.type) {
    case 'SET_MODE': {
      // Preview needs something to show; 3D↔2D switching flips the draft kind
      // only when the current kind belongs to the other world (so toggling to
      // 3D from a shader draft starts a 3D draft rather than showing nothing).
      if (action.mode === 'preview' && !draftHasContent(d)) return state;
      if (action.mode === state.mode) return state;
      let draft = d;
      if (action.mode === '3d' && d.kind !== '3d_attachment') {
        draft = { ...initialDraft('3d_attachment'), name: d.name, isPublished: d.isPublished, featured: d.featured };
      } else if (action.mode === '2d' && d.kind === '3d_attachment') {
        draft = { ...initialDraft('shader'), name: d.name, isPublished: d.isPublished, featured: d.featured };
      }
      return { ...state, mode: action.mode, draft };
    }
    case 'SET_THREE_VIEW':
      return state.threeView === action.view ? state : { ...state, threeView: action.view };
    case 'SET_PAUSED':
      return state.paused === action.paused ? state : { ...state, paused: action.paused };
    case 'SET_KIND': {
      if (action.kind === d.kind) return state;
      const next: StudioDraft = { ...d, kind: action.kind, overlayBlob: null };
      if (action.kind === 'border' || action.kind === '2d_filter') {
        next.overlayIsBuiltin = true;
        const keep = BUILTIN_BORDERS.find((b) => b.id === d.selectedBorderId && b.kind === action.kind);
        const def = keep ? { id: keep.id, url: toDataUrl(keep.svg) } : defaultBorderFor(action.kind);
        if (def) {
          next.selectedBorderId = def.id;
          next.overlayUrl = def.url;
        }
      } else if (action.kind === 'shader') {
        next.overlayUrl = null;
      }
      return {
        ...state,
        mode: modeForKind(action.kind),
        draft: next,
        dirty: true,
      };
    }
    case 'LOAD':
      return {
        mode: modeForKind(action.draft.kind),
        threeView: 'live',
        paused: false,
        draft: action.draft,
        dirty: false,
      };
    case 'SET_NAME':
      return { ...state, dirty: true, draft: { ...d, name: action.name } };
    case 'SELECT_SHADER':
      return { ...state, dirty: true, draft: { ...d, shaderId: action.shaderId, shaderParams: action.params } };
    case 'SET_SHADER_PARAM':
      return {
        ...state,
        dirty: true,
        draft: { ...d, shaderParams: { ...d.shaderParams, [action.key]: action.value } },
      };
    case 'SET_SHADER_PARAMS':
      return { ...state, dirty: true, draft: { ...d, shaderParams: action.params } };
    case 'SELECT_BUILTIN':
      return {
        ...state,
        dirty: true,
        draft: { ...d, selectedBorderId: action.borderId, overlayUrl: action.url, overlayIsBuiltin: true, overlayBlob: null },
      };
    case 'SET_OVERLAY_UPLOAD':
      return {
        ...state,
        dirty: true,
        draft: { ...d, overlayUrl: action.url, overlayBlob: action.blob, overlayIsBuiltin: false },
      };
    case 'CLEAR_OVERLAY': {
      // Borders fall back to the current built-in; stickers clear entirely.
      if (d.kind === 'border') {
        const keep = BUILTIN_BORDERS.find((b) => b.id === d.selectedBorderId && b.kind === 'border');
        const def = keep ? { id: keep.id, url: toDataUrl(keep.svg) } : defaultBorderFor('border');
        return {
          ...state,
          dirty: true,
          draft: {
            ...d,
            overlayBlob: null,
            overlayIsBuiltin: true,
            selectedBorderId: def?.id ?? d.selectedBorderId,
            overlayUrl: def?.url ?? null,
          },
        };
      }
      return { ...state, dirty: true, draft: { ...d, overlayUrl: null, overlayBlob: null, overlayIsBuiltin: false } };
    }
    case 'SET_TRANSFORM':
      return { ...state, dirty: true, draft: { ...d, transform: action.transform } };
    case 'SELECT_ANCHOR': {
      if (action.anchor === d.anchor) return state;
      return {
        ...state,
        dirty: true,
        draft: {
          ...d,
          anchor: action.anchor,
          anchorConfig: {
            offset: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: d.anchorConfig.scale,
          },
        },
      };
    }
    case 'PATCH_ANCHOR_CONFIG':
      return {
        ...state,
        dirty: true,
        draft: { ...d, anchorConfig: { ...d.anchorConfig, ...action.patch } },
      };
    case 'SELECT_HEAD_PIECE': {
      const piece = HEAD_PIECE_MAP[action.pieceId];
      if (!piece) return state;
      return {
        ...state,
        mode: '3d',
        dirty: true,
        draft: {
          ...d,
          kind: '3d_attachment',
          proceduralId: piece.id,
          assetUrl: null,
          assetName: piece.name,
          name: d.id ? d.name : piece.name,
          anchor: piece.config.anchor,
          anchorConfig: {
            offset: { ...piece.config.offset },
            rotation: { ...piece.config.rotation },
            scale: piece.config.scale,
          },
        },
      };
    }
    case 'SET_MODEL_ASSET':
      return {
        ...state,
        mode: '3d',
        dirty: true,
        draft: { ...d, kind: '3d_attachment', assetUrl: action.url, assetName: action.name, proceduralId: null },
      };
    case 'SET_THUMB':
      return { ...state, dirty: true, draft: { ...d, thumbUrl: action.url, thumbBlob: action.blob } };
    case 'TOGGLE_PUBLISHED':
      return { ...state, dirty: true, draft: { ...d, isPublished: !d.isPublished } };
    case 'TOGGLE_FEATURED':
      return { ...state, dirty: true, draft: { ...d, featured: !d.featured } };
    case 'SET_OCCLUSION':
      return { ...state, dirty: true, draft: { ...d, occlusion: action.occlusion } };
    case 'SET_SCENE_TAG':
      return { ...state, dirty: true, draft: { ...d, scene: action.scene } };
    case 'MARK_SAVED':
      return { ...state, dirty: false, draft: { ...d, id: action.id } };
  }
}
