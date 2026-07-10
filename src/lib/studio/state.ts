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
 * MIXED SCENES (W4): a draft holds ONE ordered list of objects that freely mixes
 * 2D and 3D — at most ONE frame (overlayKind 'border'), any number of stickers
 * ('2d_filter'), and any number of 3D objects (model/headpiece). A single
 * scene-level filter slot (`shaderId`, where 'none' == empty) rides alongside.
 * `kind` is DERIVED from the objects (see recomputeKind) and is 'composite' when
 * both a 2D overlay and a 3D object are present. Content PERSISTS across view
 * switches — SET_MODE ('2d'|'3d'|'preview') is a pure view flip that never
 * touches the draft, and SET_KIND is a thin alias that only flips the view.
 *
 * Anchor selection replicates Creator3D.handleAnchorSelect (same anchor is a
 * no-op; a new anchor resets offset/rotation but keeps scale). The one-frame
 * rule (placeFrame) always swaps the existing frame in place — preserving a
 * TOUCHED frame's transform/animation — while stickers and 3D objects keep the
 * browse-swap-vs-committed-add rule (addOrReplaceObject + isUntouched).
 */
import type { ExperienceKind, HeadAnchor, LayerAnimation, Transform2D } from '../../types';
import { BORDER_MAP } from '../borders';
import { HEAD_PIECE_MAP } from '../headPieces';

export type StudioMode = '2d' | '3d' | 'preview';
export type ThreeView = 'live' | 'orbit';
/** The kinds a draft can be *created* with (composite is only ever derived). */
export type StudioKind = Exclude<ExperienceKind, 'composite'>;
/** The DERIVED draft kind — a StudioKind, or 'composite' for a mixed 2D+3D scene. */
export type DraftKind = ExperienceKind;

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

/**
 * Soft cap on objects per scene — keeps the layers panel + booth render sane.
 * Counts stickers + 3D objects only; the single frame ('border' overlay) is
 * EXEMPT (a scene may hold 1 frame + MAX_OBJECTS others). See sceneCounts.
 */
export const MAX_OBJECTS = 20;

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
   * DERIVED from the scene (recomputeKind, run after every objects/filter
   * mutation): 'composite' when a 2D overlay and a 3D object coexist; else the
   * lone family — objects[0].overlayKind ('border'/'2d_filter') for overlays,
   * '3d_attachment' for 3D, or 'shader' when there are no objects at all. Never
   * set this by hand; consumers read it, the reducer computes it.
   */
  kind: DraftKind;
  isPublished: boolean;
  featured: boolean;
  /* — the ONE scene-level filter slot ('none' == empty) — */
  shaderId: string;
  shaderParams: Record<string, number>;
  /* — scene objects (frame + stickers + 3D, freely mixed) — */
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

/**
 * A brand-new draft starts EMPTY — no auto-inserted default overlay (mixed
 * scenes make an auto-object confusing; the first dock click adds it). `kind`
 * only picks the initial name here; the reducer derives it from then on. The
 * filter slot starts empty ('none') EXCEPT initialDraft('shader'), which
 * pre-selects DEFAULT_SHADER_ID so opening the shader studio shows a filter.
 */
export function initialDraft(kind: StudioKind = 'shader'): StudioDraft {
  return {
    name: kind === '3d_attachment' ? 'Untitled 3D Experience' : 'Untitled Experience',
    kind,
    isPublished: true,
    featured: true,
    shaderId: kind === 'shader' ? DEFAULT_SHADER_ID : 'none',
    shaderParams: {},
    objects: [],
    selectedId: null,
    thumbUrl: null,
    thumbBlob: null,
  };
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

/**
 * Whether the draft has anything to preview: at least one object, OR a filter
 * in the slot (shaderId !== 'none'). Mirrors the SET_MODE preview guard.
 */
export function draftHasContent(d: StudioDraft): boolean {
  return d.objects.length > 0 || d.shaderId !== 'none';
}

/** The currently-selected scene object, or null. */
export function selectedObject(d: StudioDraft): StudioObject | null {
  return d.objects.find((o) => o.id === d.selectedId) ?? null;
}

function is3D(o: StudioObject): o is Object3D {
  return o.type !== 'overlay';
}

function isFrame(o: StudioObject): o is Overlay2D {
  return o.type === 'overlay' && o.overlayKind === 'border';
}

/**
 * Scene composition counts for the UI + cap: at most one `frame`, plus the
 * number of `stickers` and `threeD` objects. `capped` (stickers + threeD) is
 * the number compared against MAX_OBJECTS — the frame is exempt.
 */
export function sceneCounts(d: StudioDraft): { frame: 0 | 1; stickers: number; threeD: number; capped: number } {
  let frame: 0 | 1 = 0;
  let stickers = 0;
  let threeD = 0;
  for (const o of d.objects) {
    if (o.type === 'overlay') {
      if (o.overlayKind === 'border') frame = 1;
      else stickers += 1;
    } else {
      threeD += 1;
    }
  }
  return { frame, stickers, threeD, capped: stickers + threeD };
}

/**
 * The DERIVED draft kind from the current objects:
 *   • a 2D overlay AND a 3D object present → 'composite'
 *   • only overlays → objects[0].overlayKind ('border' | '2d_filter')
 *   • only 3D objects → '3d_attachment'
 *   • no objects → 'shader' (regardless of the filter slot)
 */
function recomputeKind(d: StudioDraft): DraftKind {
  const hasOverlay = d.objects.some((o) => o.type === 'overlay');
  const has3D = d.objects.some((o) => o.type !== 'overlay');
  if (hasOverlay && has3D) return 'composite';
  if (hasOverlay) return (d.objects[0] as Overlay2D).overlayKind;
  if (has3D) return '3d_attachment';
  return 'shader';
}

function mapObjects(d: StudioDraft, id: string, fn: (o: StudioObject) => StudioObject): StudioObject[] {
  return d.objects.map((o) => (o.id === id ? fn(o) : o));
}

/**
 * True while an object is still exactly as the catalog created it — default
 * placement and no animation. Such an object is "being browsed", not placed:
 * the user clicked it to look, and hasn't committed to it by moving/editing it.
 */
function isUntouched(o: StudioObject): boolean {
  if (o.animation !== 'none') return false;
  if (o.type === 'overlay') {
    const t = o.transform;
    return t.scale === 1 && t.x === 0 && t.y === 0 && t.rotation === 0;
  }
  // 3D: untouched = still on the piece's own preset anchor/config (or the
  // plain defaults for a GLB model, which has no preset).
  const preset = o.type === 'headpiece' && o.proceduralId ? HEAD_PIECE_MAP[o.proceduralId]?.config : undefined;
  const da = preset?.anchor ?? 'crown';
  const doff = preset?.offset ?? DEFAULT_ANCHOR_CONFIG.offset;
  const drot = preset?.rotation ?? DEFAULT_ANCHOR_CONFIG.rotation;
  const dscale = preset?.scale ?? 1;
  const c = o.anchorConfig;
  return (
    o.anchor === da &&
    c.scale === dscale &&
    c.offset.x === doff.x && c.offset.y === doff.y && c.offset.z === doff.z &&
    c.rotation.x === drot.x && c.rotation.y === drot.y && c.rotation.z === drot.z
  );
}

/**
 * ADD-vs-REPLACE rule for the click-to-add actions (SELECT_BUILTIN,
 * SET_OVERLAY_UPLOAD, SELECT_HEAD_PIECE, SET_MODEL_ASSET):
 *   • REPLACE in place when the selected object is the same type (and, for 2D
 *     overlays, the same border/sticker sub-kind) AND still untouched — the
 *     browse-to-compare flow: click through frames or head pieces and each
 *     click swaps the one you're looking at.
 *   • ADD (and select) otherwise — once an object has been placed or edited
 *     (dragged, scaled, re-anchored, animated), the next pick grows the scene,
 *     which is how multi-object scenes are built from plain clicks and drops
 *     (a drop positions its object right after adding, marking it touched).
 * Returns null when the MAX_OBJECTS cap blocks an add.
 */
function addOrReplaceObject(
  d: StudioDraft,
  obj: StudioObject,
  sameType: StudioObject['type'],
): StudioDraft | null {
  const sel = selectedObject(d);
  const sameSubkind =
    sel?.type === 'overlay' && obj.type === 'overlay' ? sel.overlayKind === obj.overlayKind : true;
  if (sel && sel.type === sameType && sameSubkind && isUntouched(sel)) {
    return { ...d, objects: d.objects.map((o) => (o.id === sel.id ? obj : o)), selectedId: obj.id };
  }
  // The cap counts stickers + 3D only (the frame is exempt); this helper only
  // ever adds cappable objects, so compare against the capped count.
  if (sceneCounts(d).capped >= MAX_OBJECTS) return null;
  return { ...d, objects: [...d.objects, obj], selectedId: obj.id };
}

/**
 * The ONE-FRAME rule for adding a 'border' overlay: if a frame already exists it
 * is REPLACED in place (keeping its array index), else the frame is appended.
 * The frame is exempt from MAX_OBJECTS, so a first frame always fits. When
 * swapping a TOUCHED frame we carry over its transform + animation (the user
 * already placed it; they're just trying a different design). Always selects the
 * resulting frame; callers may override selection afterwards.
 */
function placeFrame(d: StudioDraft, frame: Overlay2D): StudioDraft {
  const idx = d.objects.findIndex(isFrame);
  if (idx >= 0) {
    const existing = d.objects[idx] as Overlay2D;
    const merged: Overlay2D = isUntouched(existing)
      ? frame
      : { ...frame, transform: { ...existing.transform }, animation: existing.animation };
    return { ...d, objects: d.objects.map((o, i) => (i === idx ? merged : o)), selectedId: merged.id };
  }
  return { ...d, objects: [...d.objects, frame], selectedId: frame.id };
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
  | { type: 'CLEAR_FILTER' }
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

function modeForKind(kind: DraftKind): Exclude<StudioMode, 'preview'> {
  return kind === '3d_attachment' ? '3d' : '2d';
}

export function studioReducer(state: StudioState, action: StudioAction): StudioState {
  const d = state.draft;
  switch (action.type) {
    case 'SET_MODE': {
      // Pure VIEW switch — never touches the draft (content persists across
      // flips). Preview needs something to show: any object OR a filter slot.
      if (action.mode === 'preview' && d.objects.length === 0 && d.shaderId === 'none') return state;
      if (action.mode === state.mode) return state;
      return { ...state, mode: action.mode };
    }
    case 'SET_THREE_VIEW':
      return state.threeView === action.view ? state : { ...state, threeView: action.view };
    case 'SET_PAUSED':
      return state.paused === action.paused ? state : { ...state, paused: action.paused };
    case 'SET_KIND': {
      // The dock's category tabs are becoming pure catalog-browsing UI in a later
      // wave; for now the dock still dispatches SET_KIND. With the new semantics
      // it ONLY flips the view to the matching world ('3d_attachment' → '3d', else
      // '2d') — it never creates/deletes/resets objects and never changes
      // draft.kind (which is derived). This makes it a thin alias for SET_MODE.
      const mode = modeForKind(action.kind);
      if (mode === state.mode) return state;
      return { ...state, mode };
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
    case 'CLEAR_FILTER':
      // Empty the single scene-level filter slot.
      if (d.shaderId === 'none' && Object.keys(d.shaderParams).length === 0) return state;
      return { ...state, dirty: true, draft: { ...d, shaderId: 'none', shaderParams: {} } };
    case 'SELECT_BUILTIN': {
      const info = BORDER_MAP[action.borderId];
      const overlayKind: 'border' | '2d_filter' = info?.kind ?? 'border';
      const obj = createOverlay(overlayKind, {
        url: action.url,
        isBuiltin: true,
        builtinId: action.borderId,
        name: info?.name ?? 'Overlay',
      });
      // The one-frame rule wins for borders (always swap the frame in place);
      // stickers keep the browse-swap-vs-committed-add rule.
      const nd = overlayKind === 'border' ? placeFrame(d, obj) : addOrReplaceObject(d, obj, 'overlay');
      if (!nd) return state;
      return { ...state, mode: '2d', dirty: true, draft: { ...nd, kind: recomputeKind(nd) } };
    }
    case 'SET_OVERLAY_UPLOAD': {
      const sel = selectedObject(d);
      // Uploads inherit the selected overlay's sub-kind, else default to a frame.
      const overlayKind: 'border' | '2d_filter' =
        sel && sel.type === 'overlay' ? sel.overlayKind : 'border';
      const obj = createOverlay(overlayKind, {
        url: action.url,
        blob: action.blob,
        isBuiltin: false,
        name: 'Custom overlay',
      });
      const nd = overlayKind === 'border' ? placeFrame(d, obj) : addOrReplaceObject(d, obj, 'overlay');
      if (!nd) return state;
      return { ...state, mode: '2d', dirty: true, draft: { ...nd, kind: recomputeKind(nd) } };
    }
    case 'CLEAR_OVERLAY': {
      const sel = selectedObject(d);
      if (!sel || sel.type !== 'overlay') return state;
      // With no auto-default frame anymore, clearing a border DELETES it (same as
      // a sticker); the scene may be left frame-less.
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
      return { ...state, mode: '3d', dirty: true, draft: { ...nd, kind: recomputeKind(nd), name } };
    }
    case 'SET_MODEL_ASSET': {
      const obj = createObject3D('model', { assetUrl: action.url, name: action.name ?? 'Model' });
      const nd = addOrReplaceObject(d, obj, 'model');
      if (!nd) return state;
      return { ...state, mode: '3d', dirty: true, draft: { ...nd, kind: recomputeKind(nd) } };
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
      // Mixed scenes: no family-match rejection. A 'border' overlay obeys the
      // one-frame rule (replace the existing frame in place; exempt from the
      // cap); everything else appends subject to the MAX_OBJECTS cap.
      const obj = action.object;
      let nd: StudioDraft;
      if (isFrame(obj)) {
        nd = placeFrame(d, obj);
        if (action.select === false) nd = { ...nd, selectedId: d.selectedId };
      } else {
        if (sceneCounts(d).capped >= MAX_OBJECTS) return state; // cap — ignore beyond
        const objects = [...d.objects, obj];
        const selectedId = action.select === false ? d.selectedId : obj.id;
        nd = { ...d, objects, selectedId };
      }
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
