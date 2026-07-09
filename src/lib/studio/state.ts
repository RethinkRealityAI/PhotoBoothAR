/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Studio editor state — a pure reducer driving the unified StudioShell
 * (mode switching, the current draft experience, and edit-session flags).
 * Kept free of React/Three/Supabase so vitest (node env) can exercise every
 * transition. Undo/redo lives in ./history.ts as a {past,present,future}
 * wrapper around this reducer.
 *
 * SCENES: a draft now holds an ORDERED list of objects within one mode.
 *   - 2D scenes (kind 'border'/'2d_filter'): objects are Overlay2D — borders and
 *     stickers freely mixable; the draft's `kind` mirrors objects[0].overlayKind.
 *   - 3D scenes (kind '3d_attachment'): objects are Object3D — GLB models or
 *     procedural head pieces, each with its own anchor/animation/occlusion.
 *   - Shader (kind 'shader'): stays exactly as before — a single frame treatment,
 *     no objects. `objects` is always [] for a shader draft.
 *
 * Kind-switch semantics replicate the old Creator2D.handleKindChange for the
 * single-object case (border/sticker restore a built-in default; shader clears
 * the overlay), and anchor selection replicates Creator3D.handleAnchorSelect
 * (same anchor is a no-op; a new anchor resets offset/rotation but keeps scale).
 */
import type { ExperienceKind, HeadAnchor, LayerAnimation, Transform2D } from '../../types';
import { BORDER_MAP, BUILTIN_BORDERS, toDataUrl } from '../borders';
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

/** Hard cap on objects per scene — keeps the layers panel + booth render sane. */
export const MAX_OBJECTS = 8;

/* — Scene objects ---------------------------------------------------------- */

/** A single 2D overlay (border or sticker) within a 2D scene. */
export interface Overlay2D {
  id: string;
  type: 'overlay';
  overlayKind: 'border' | '2d_filter';
  /** Rendered image (data: URL for built-ins, blob:/https: for uploads). */
  url: string | null;
  /** Blob pending upload for a custom overlay (upload happens at save). */
  blob: Blob | null;
  isBuiltin: boolean;
  /** Built-in border id when this overlay came from the catalog. */
  builtinId?: string;
  name: string;
  transform: Transform2D;
  animation: LayerAnimation;
}

/** A single 3D attachment (GLB model or procedural head piece) within a 3D scene. */
export interface Object3D {
  id: string;
  type: 'model' | 'headpiece';
  /** GLB asset URL (models) — null/undefined for procedural pieces. */
  assetUrl?: string;
  /** Built-in procedural head-piece id (head pieces). */
  proceduralId?: string;
  name: string;
  anchor: HeadAnchor;
  anchorConfig: StudioAnchorConfig;
  animation: LayerAnimation;
  /** Per-object head occlusion opt-in (opt-IN: never surprise-hides an asset). */
  occlusion: boolean;
}

export type StudioObject = Overlay2D | Object3D;

// Deterministic, module-counter object ids — stable across a test run and never
// collide within a session (Date.now would be fine in the app but not in tests).
let objectCounter = 0;
function nextObjectId(): string {
  return `obj-${++objectCounter}`;
}

export function createOverlay(
  overlayKind: 'border' | '2d_filter',
  opts: Partial<Omit<Overlay2D, 'id' | 'type' | 'overlayKind'>> = {},
): Overlay2D {
  return {
    id: nextObjectId(),
    type: 'overlay',
    overlayKind,
    url: opts.url ?? null,
    blob: opts.blob ?? null,
    isBuiltin: opts.isBuiltin ?? true,
    builtinId: opts.builtinId,
    name: opts.name ?? 'Overlay',
    transform: opts.transform ? { ...opts.transform } : { ...DEFAULT_TRANSFORM },
    animation: opts.animation ?? 'none',
  };
}

export function createObject3D(
  type: 'model' | 'headpiece',
  opts: Partial<Omit<Object3D, 'id' | 'type'>> = {},
): Object3D {
  return {
    id: nextObjectId(),
    type,
    assetUrl: opts.assetUrl,
    proceduralId: opts.proceduralId,
    name: opts.name ?? (type === 'headpiece' ? 'Head Piece' : 'Model'),
    anchor: opts.anchor ?? 'crown',
    anchorConfig: opts.anchorConfig
      ? {
          offset: { ...opts.anchorConfig.offset },
          rotation: { ...opts.anchorConfig.rotation },
          scale: opts.anchorConfig.scale,
        }
      : {
          offset: { ...DEFAULT_ANCHOR_CONFIG.offset },
          rotation: { ...DEFAULT_ANCHOR_CONFIG.rotation },
          scale: 1,
        },
    animation: opts.animation ?? 'none',
    occlusion: opts.occlusion ?? false,
  };
}

/* — Draft ------------------------------------------------------------------ */

export interface StudioDraft {
  /** Set when editing an existing experience (?id= deep link). */
  id?: string;
  name: string;
  /**
   * Drives the mode: 'shader'|'border'|'2d_filter' are the 2D family, and for
   * a 2D scene this mirrors objects[0].overlayKind (recomputed on add/reorder/
   * delete); '3d_attachment' is the 3D family.
   */
  kind: StudioKind;
  isPublished: boolean;
  featured: boolean;
  /* — shader (single, no objects) — */
  shaderId: string;
  shaderParams: Record<string, number>;
  /* — scene objects (empty for a shader draft) — */
  objects: StudioObject[];
  selectedId: string | null;
  /* — shared — */
  thumbUrl: string | null;
  thumbBlob: Blob | null;
  /** Scene Director grouping tag (config.scene on save). */
  scene?: string;
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

function builtinOverlay(borderId: string, kind: 'border' | '2d_filter'): Overlay2D | null {
  const b = BUILTIN_BORDERS.find((x) => x.id === borderId && x.kind === kind);
  return b
    ? createOverlay(kind, { url: toDataUrl(b.svg), isBuiltin: true, builtinId: b.id, name: b.name })
    : null;
}

function defaultOverlayFor(kind: 'border' | '2d_filter'): Overlay2D | null {
  const b = BUILTIN_BORDERS.find((x) => x.kind === kind);
  return b ? builtinOverlay(b.id, kind) : null;
}

export function initialDraft(kind: StudioKind = 'shader'): StudioDraft {
  const draft: StudioDraft = {
    name: kind === '3d_attachment' ? 'Untitled 3D Experience' : 'Untitled Experience',
    kind,
    isPublished: true,
    featured: true,
    shaderId: DEFAULT_SHADER_ID,
    shaderParams: {},
    objects: [],
    selectedId: null,
    thumbUrl: null,
    thumbBlob: null,
  };
  if (kind === 'border' || kind === '2d_filter') {
    const def = defaultOverlayFor(kind);
    if (def) {
      draft.objects = [def];
      draft.selectedId = def.id;
    }
  }
  return draft;
}

export function initialState(kind: StudioKind = 'shader'): StudioState {
  return {
    mode: kind === '3d_attachment' ? '3d' : '2d',
    // Default to the reference-head ("Model") view so entering 3D shows the head
    // + anchor dots to place onto — not the camera, which needs a detected face.
    threeView: 'orbit',
    paused: false,
    draft: initialDraft(kind),
    dirty: false,
  };
}

/** Modes that need the draft to have visible content before entering. */
export function draftHasContent(d: StudioDraft): boolean {
  if (d.kind === 'shader') return true; // a shader is always previewable
  return d.objects.length > 0;
}

/** The currently-selected scene object, or null. */
export function selectedObject(d: StudioDraft): StudioObject | null {
  return d.objects.find((o) => o.id === d.selectedId) ?? null;
}

function is3D(o: StudioObject): o is Object3D {
  return o.type !== 'overlay';
}

/**
 * The draft `kind` for a 2D/3D scene follows its first object; a shader draft
 * (empty objects) keeps 'shader', and an empty 2D/3D scene keeps its family.
 */
function recomputeKind(d: StudioDraft): StudioKind {
  const first = d.objects[0];
  if (first) return first.type === 'overlay' ? first.overlayKind : '3d_attachment';
  return d.kind;
}

function mapObjects(d: StudioDraft, id: string, fn: (o: StudioObject) => StudioObject): StudioObject[] {
  return d.objects.map((o) => (o.id === id ? fn(o) : o));
}

/**
 * ADD-vs-REPLACE rule for the click-to-add actions (SELECT_BUILTIN,
 * SET_OVERLAY_UPLOAD, SELECT_HEAD_PIECE, SET_MODEL_ASSET): they ADD a new
 * object (and select it) when the scene has room, EXCEPT when the currently-
 * selected object is the SAME kind AND the scene has exactly one object — then
 * they REPLACE it in place. This preserves today's single-object Creator UX
 * (clicking a second border swaps the one you have) while letting a populated
 * scene grow. Returns null when the MAX_OBJECTS cap blocks an add.
 */
function addOrReplaceObject(
  d: StudioDraft,
  obj: StudioObject,
  sameType: StudioObject['type'],
): StudioDraft | null {
  const sel = selectedObject(d);
  if (sel && sel.type === sameType && d.objects.length === 1) {
    return { ...d, objects: [obj], selectedId: obj.id };
  }
  if (d.objects.length >= MAX_OBJECTS) return null;
  return { ...d, objects: [...d.objects, obj], selectedId: obj.id };
}

/* — Actions ---------------------------------------------------------------- */

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
  | { type: 'MARK_SAVED'; id: string }
  /* — multi-object scene actions — */
  | { type: 'ADD_OBJECT'; object: StudioObject; select?: boolean }
  | { type: 'DELETE_OBJECT'; id: string }
  | { type: 'SELECT_OBJECT'; id: string | null }
  | { type: 'REORDER_OBJECT'; id: string; dir: 'up' | 'down' }
  | { type: 'UPDATE_OBJECT'; id: string; patch: Partial<Omit<Overlay2D, 'id' | 'type'>> | Partial<Omit<Object3D, 'id' | 'type'>> }
  | { type: 'SET_OBJECT_ANIMATION'; id: string; animation: LayerAnimation };

function modeForKind(kind: StudioKind): StudioMode {
  return kind === '3d_attachment' ? '3d' : '2d';
}

function draftFamily(kind: StudioKind): '2d' | '3d' | 'shader' {
  if (kind === '3d_attachment') return '3d';
  if (kind === 'shader') return 'shader';
  return '2d';
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
      // With a populated 2D scene we don't destroy the objects: switching the
      // 2D sub-kind only changes the default overlayKind for the NEXT add.
      if (d.objects.length > 1 && (action.kind === 'border' || action.kind === '2d_filter')) {
        return { ...state, dirty: true, draft: { ...d, kind: action.kind } };
      }
      // Single-object (or family) switch: replicate the old handleKindChange reset.
      let objects: StudioObject[] = [];
      let selectedId: string | null = null;
      if (action.kind === 'border' || action.kind === '2d_filter') {
        const prev = selectedObject(d);
        const keepId = prev && prev.type === 'overlay' ? prev.builtinId : undefined;
        const def = (keepId && builtinOverlay(keepId, action.kind)) || defaultOverlayFor(action.kind);
        if (def) {
          objects = [def];
          selectedId = def.id;
        }
      }
      // shader / 3d_attachment start empty (shader has no objects; a 3D scene is
      // populated by SELECT_HEAD_PIECE/SET_MODEL_ASSET).
      return {
        ...state,
        mode: modeForKind(action.kind),
        dirty: true,
        draft: { ...d, kind: action.kind, objects, selectedId },
      };
    }
    case 'LOAD':
      return {
        mode: modeForKind(action.draft.kind),
        threeView: 'orbit',
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
    case 'SELECT_BUILTIN': {
      const info = BORDER_MAP[action.borderId];
      const overlayKind: 'border' | '2d_filter' =
        info?.kind ?? (d.kind === 'border' || d.kind === '2d_filter' ? d.kind : 'border');
      const obj = createOverlay(overlayKind, {
        url: action.url,
        isBuiltin: true,
        builtinId: action.borderId,
        name: info?.name ?? 'Overlay',
      });
      const nd = addOrReplaceObject(d, obj, 'overlay');
      if (!nd) return state;
      return { ...state, mode: '2d', dirty: true, draft: { ...nd, kind: recomputeKind(nd) } };
    }
    case 'SET_OVERLAY_UPLOAD': {
      const sel = selectedObject(d);
      const overlayKind: 'border' | '2d_filter' =
        sel && sel.type === 'overlay'
          ? sel.overlayKind
          : d.kind === 'border' || d.kind === '2d_filter'
            ? d.kind
            : 'border';
      const obj = createOverlay(overlayKind, {
        url: action.url,
        blob: action.blob,
        isBuiltin: false,
        name: 'Custom overlay',
      });
      const nd = addOrReplaceObject(d, obj, 'overlay');
      if (!nd) return state;
      return { ...state, mode: '2d', dirty: true, draft: { ...nd, kind: recomputeKind(nd) } };
    }
    case 'CLEAR_OVERLAY': {
      const sel = selectedObject(d);
      if (!sel || sel.type !== 'overlay') return state;
      if (sel.overlayKind === 'border') {
        // Borders fall back to the current (or default) built-in, in place.
        const def = (sel.builtinId && builtinOverlay(sel.builtinId, 'border')) || defaultOverlayFor('border');
        if (!def) return state;
        const objects = mapObjects(d, sel.id, () => ({ ...def, id: sel.id }));
        return { ...state, dirty: true, draft: { ...d, objects } };
      }
      // Stickers clear entirely — the object is removed from the scene.
      const objects = d.objects.filter((o) => o.id !== sel.id);
      const selectedId = objects.length ? objects[objects.length - 1].id : null;
      const nd = { ...d, objects, selectedId };
      return { ...state, dirty: true, draft: { ...nd, kind: recomputeKind(nd) } };
    }
    case 'SET_TRANSFORM': {
      const sel = selectedObject(d);
      if (!sel || sel.type !== 'overlay') return state;
      return {
        ...state,
        dirty: true,
        draft: { ...d, objects: mapObjects(d, sel.id, (o) => ({ ...o, transform: action.transform })) },
      };
    }
    case 'SELECT_ANCHOR': {
      const sel = selectedObject(d);
      if (!sel || !is3D(sel)) return state;
      if (action.anchor === sel.anchor) return state;
      return {
        ...state,
        dirty: true,
        draft: {
          ...d,
          objects: mapObjects(d, sel.id, (o) =>
            is3D(o)
              ? {
                  ...o,
                  anchor: action.anchor,
                  anchorConfig: { offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: o.anchorConfig.scale },
                }
              : o,
          ),
        },
      };
    }
    case 'PATCH_ANCHOR_CONFIG': {
      const sel = selectedObject(d);
      if (!sel || !is3D(sel)) return state;
      return {
        ...state,
        dirty: true,
        draft: {
          ...d,
          objects: mapObjects(d, sel.id, (o) =>
            is3D(o) ? { ...o, anchorConfig: { ...o.anchorConfig, ...action.patch } } : o,
          ),
        },
      };
    }
    case 'SELECT_HEAD_PIECE': {
      const piece = HEAD_PIECE_MAP[action.pieceId];
      if (!piece) return state;
      const obj = createObject3D('headpiece', {
        proceduralId: piece.id,
        name: piece.name,
        anchor: piece.config.anchor,
        anchorConfig: { offset: { ...piece.config.offset }, rotation: { ...piece.config.rotation }, scale: piece.config.scale },
      });
      const nd = addOrReplaceObject(d, obj, 'headpiece');
      if (!nd) return state;
      // Creator UX: name a brand-new (unsaved, first-object) experience after the
      // piece; never rename when editing an existing one or adding to a scene.
      const name = !d.id && nd.objects.length === 1 ? piece.name : d.name;
      return { ...state, mode: '3d', dirty: true, draft: { ...nd, kind: '3d_attachment', name } };
    }
    case 'SET_MODEL_ASSET': {
      const obj = createObject3D('model', { assetUrl: action.url, name: action.name ?? 'Model' });
      const nd = addOrReplaceObject(d, obj, 'model');
      if (!nd) return state;
      return { ...state, mode: '3d', dirty: true, draft: { ...nd, kind: '3d_attachment' } };
    }
    case 'SET_THUMB':
      return { ...state, dirty: true, draft: { ...d, thumbUrl: action.url, thumbBlob: action.blob } };
    case 'TOGGLE_PUBLISHED':
      return { ...state, dirty: true, draft: { ...d, isPublished: !d.isPublished } };
    case 'TOGGLE_FEATURED':
      return { ...state, dirty: true, draft: { ...d, featured: !d.featured } };
    case 'SET_OCCLUSION': {
      const sel = selectedObject(d);
      if (!sel || !is3D(sel)) return state;
      return {
        ...state,
        dirty: true,
        draft: { ...d, objects: mapObjects(d, sel.id, (o) => (is3D(o) ? { ...o, occlusion: action.occlusion } : o)) },
      };
    }
    case 'SET_SCENE_TAG':
      return { ...state, dirty: true, draft: { ...d, scene: action.scene } };
    case 'MARK_SAVED':
      return { ...state, dirty: false, draft: { ...d, id: action.id } };
    case 'ADD_OBJECT': {
      const obj = action.object;
      const objFamily = obj.type === 'overlay' ? '2d' : '3d';
      if (objFamily !== draftFamily(d.kind)) return state; // enforce mode match
      if (d.objects.length >= MAX_OBJECTS) return state; // cap — ignore beyond
      const objects = [...d.objects, obj];
      const selectedId = action.select === false ? d.selectedId : obj.id;
      const nd = { ...d, objects, selectedId };
      return { ...state, dirty: true, draft: { ...nd, kind: recomputeKind(nd) } };
    }
    case 'DELETE_OBJECT': {
      const idx = d.objects.findIndex((o) => o.id === action.id);
      if (idx < 0) return state;
      const objects = d.objects.filter((o) => o.id !== action.id);
      let selectedId = d.selectedId;
      if (d.selectedId === action.id) selectedId = objects.length ? objects[Math.max(0, idx - 1)].id : null;
      const nd = { ...d, objects, selectedId };
      return { ...state, dirty: true, draft: { ...nd, kind: recomputeKind(nd) } };
    }
    case 'SELECT_OBJECT': {
      if (action.id !== null && !d.objects.some((o) => o.id === action.id)) return state;
      if (action.id === d.selectedId) return state;
      // Selection is not a content edit — leaves `dirty` untouched.
      return { ...state, draft: { ...d, selectedId: action.id } };
    }
    case 'REORDER_OBJECT': {
      const idx = d.objects.findIndex((o) => o.id === action.id);
      if (idx < 0) return state;
      const swap = action.dir === 'up' ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= d.objects.length) return state;
      const objects = [...d.objects];
      [objects[idx], objects[swap]] = [objects[swap], objects[idx]];
      const nd = { ...d, objects };
      return { ...state, dirty: true, draft: { ...nd, kind: recomputeKind(nd) } };
    }
    case 'UPDATE_OBJECT': {
      const idx = d.objects.findIndex((o) => o.id === action.id);
      if (idx < 0) return state;
      const objects = mapObjects(d, action.id, (o) => {
        // id/type are immutable — a patch can never change an object's identity.
        const { id: _id, type: _type, ...rest } = action.patch as Record<string, unknown>;
        void _id;
        void _type;
        return { ...o, ...rest } as StudioObject;
      });
      const nd = { ...d, objects };
      return { ...state, dirty: true, draft: { ...nd, kind: recomputeKind(nd) } };
    }
    case 'SET_OBJECT_ANIMATION': {
      const idx = d.objects.findIndex((o) => o.id === action.id);
      if (idx < 0) return state;
      return {
        ...state,
        dirty: true,
        draft: { ...d, objects: mapObjects(d, action.id, (o) => ({ ...o, animation: action.animation })) },
      };
    }
  }
}
