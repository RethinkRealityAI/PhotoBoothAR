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
 * `kind` is DERIVED from the objects (see deriveKind) and is 'composite' when
 * both a 2D overlay and a 3D object are present. Content PERSISTS across view
 * switches — SET_MODE ('2d'|'3d'|'preview') is a pure view flip that never
 * touches the draft, and SET_KIND is a thin alias that only flips the view.
 *
 * Anchor selection replicates Creator3D.handleAnchorSelect (same anchor is a
 * no-op; a new anchor resets offset/rotation but keeps scale). The one-frame
 * rule (placeFrame) always swaps the existing frame in place — preserving a
 * TOUCHED frame's transform/animation — while stickers and 3D objects ALWAYS
 * APPEND on pick (appendObject): a click never deletes or replaces content.
 */
import type {
  AssetCustomization, AssetLabelConfig, AssetPartStyle,
  ExperienceKind, GuestLetteringConfig, HeadAnchor, LayerAnimation, Transform2D,
} from '../../types';
import { BORDER_MAP } from '../borders';
import { HEAD_PIECE_MAP } from '../headPieces';
import { CHAR_WIDTH_RATIO, DEFAULT_LETTERING_COLOR, type GuestLetteringStyle } from '../letteringFit';
import { ASSET_CUSTOMIZATION, FINISH_TINT_STRENGTH } from './controlSpecs';
import { DEFAULT_FINISH, normalizeFinish, normalizeTint, normalizeTintStrength } from './finish';
import { moveByIndex } from './layerOrder';
import { isHandAnchorId } from '../handPose';
import type { TriggerConfig } from './triggers';

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

/** Soft cap on face/hand-triggered effects per scene (studio "Magic Triggers").
 *  Raised 4 → 6 with the hand-gesture sources so a scene can pair face + hand
 *  ceremonies without evicting its old triggers. */
export const MAX_TRIGGERS = 6;

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
  /**
   * Hide this overlay FROM GUESTS. Defaults undefined (== visible).
   *
   * This comment used to claim the flag was editor-only and "never persisted".
   * That is false and was false when written: draftMapping writes `hidden` onto
   * the saved layer (draftMapping.ts:267) and reads it back (:158), and the
   * booth honours it — so hiding a layer and saving publishes a scene without
   * it. Treat it as a publish control; the Layers eye is labelled accordingly.
   */
  hidden?: boolean;
  /**
   * Live per-guest lettering drawn over this frame in the booth (the guest's
   * own name, or one fixed line for everyone). Persisted at CONFIG level, not
   * layer level: draftMapping mirrors it to/from `config.lettering` beside
   * `config.opacity`, the same way layer 0's transform is mirrored. Undefined =
   * none, which is every scene that predates the feature.
   */
  lettering?: GuestLetteringConfig;
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
  /**
   * Material finish (lib/studio/finish.ts). OPTIONAL and undefined by default:
   * a Meshy import must keep the material it shipped with unless the host
   * explicitly restyles it, and `undefined` is what makes the persisted layer
   * omit the key entirely — so scenes saved before Wave 6 round-trip byte-for-
   * byte. Only ever set on `type: 'model'`; procedural head pieces carry their
   * own authored materials.
   */
  finish?: string;
  /** `#rrggbb` colour wash over the finish. */
  tint?: string;
  /** 0..1 — how far the tint carries (controlSpecs.FINISH_TINT_STRENGTH). */
  tintStrength?: number;
  /**
   * Hide this piece FROM GUESTS — persisted on save, exactly like
   * Overlay2D.hidden (see the note there; the old "never persisted" claim was
   * wrong). Defaults undefined (== visible).
   */
  hidden?: boolean;
  /**
   * Per-asset personalisation (types.AssetCustomization): recoloured template
   * regions and/or an engraved label. OPTIONAL and undefined by default, and
   * deleted rather than defaulted on reset (withCustomization) — the same
   * one-representation-of-unstyled rule `finish` follows, and the reason
   * draftToPayload must force the layers path when it is present.
   */
  customization?: AssetCustomization;
  /**
   * The asset's configurator descriptor (assetTemplate.AssetTemplate), carried
   * opaquely: this module is the persistence half and never renders, and typing
   * it here would make state.ts and assetTemplate.ts import each other (that
   * module already imports `normalizeCustomization` from this one). Consumers
   * run it through `normalizeTemplate`, which returns null for anything it does
   * not fully understand. Undefined = a plain asset with no configurator.
   */
  template?: unknown;
  /** Hand anchor id (lib/handPose HAND_ANCHORS) — present ⇒ the piece rides
   *  the tracked hand, not the head. Absent on every pre-existing object. */
  handAnchor?: string;
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
    // Omitted entirely when absent, so an overlay without guest lettering has
    // no such key at all (deep-equality snapshots stay byte-identical).
    ...(opts.lettering ? { lettering: { ...opts.lettering } } : {}),
  };
}

/**
 * The finish keys an object should CARRY, normalized, with every default
 * omitted entirely (never stored as `finish: 'original'`). Shared by
 * createObject3D and withFinish so "unstyled" has exactly one representation.
 */
function finishKeys(src: { finish?: unknown; tint?: unknown; tintStrength?: unknown }): Partial<Object3D> {
  const out: Partial<Object3D> = {};
  const finish = normalizeFinish(src.finish);
  if (finish !== DEFAULT_FINISH) out.finish = finish;
  const tint = normalizeTint(src.tint);
  if (tint) {
    out.tint = tint;
    // A strength without a tint is dead data, and full strength IS the default.
    const strength = normalizeTintStrength(src.tintStrength);
    if (strength !== FINISH_TINT_STRENGTH.max) out.tintStrength = strength;
  }
  return out;
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
    // Spread-in only when actually set, so an unstyled object has NO finish
    // keys at all — object-identity/deep-equality snapshots taken before Wave 6
    // stay byte-identical (the same idiom as createOverlay's `lettering`).
    ...finishKeys(opts),
    // Same idiom for per-asset customization: absent unless something is
    // actually customized, so a plain object round-trips byte-identically.
    ...customizationKeys(opts),
    // The configurator descriptor rides along opaquely, and only when the asset
    // actually has one (an untemplated model keeps NO template key).
    ...(opts.template ? { template: opts.template } : {}),
    // Hand-anchored gear: only when set, so head pieces keep NO handAnchor key.
    ...(opts.handAnchor !== undefined ? { handAnchor: opts.handAnchor } : {}),
  };
}

/**
 * Apply a SET_FINISH patch to one 3D object.
 *
 * Values at their DEFAULT are deleted rather than stored, so an object the host
 * styled and then reset carries no finish keys at all — identical bytes to an
 * object that was never touched. Without this, "back to original" would leave
 * `finish: 'original'` in the jsonb forever and every diff/round-trip test
 * would have to know about it.
 */
export function withFinish(
  o: Object3D,
  patch: { finish?: string; tint?: string | null; tintStrength?: number },
): Object3D {
  // Merge current + patch, then re-derive the keys through the single
  // normalizer — so there is exactly ONE representation of "unstyled",
  // whichever route the object took to get there.
  const merged = {
    finish: patch.finish !== undefined ? patch.finish : o.finish,
    // `null` is the explicit clear; `undefined` means "leave as it was".
    tint: patch.tint !== undefined ? patch.tint : o.tint,
    tintStrength: patch.tintStrength !== undefined ? patch.tintStrength : o.tintStrength,
  };
  const next: Object3D = { ...o };
  delete next.finish;
  delete next.tint;
  delete next.tintStrength;
  return { ...next, ...finishKeys(merged) };
}

/* — Per-asset customization ------------------------------------------------ */

/**
 * Validate ONE region's style out of untrusted jsonb. Returns undefined when
 * the region says nothing — a `{}` entry is dead weight that would make
 * "unstyled" have two byte-representations.
 */
function normalizePart(raw: unknown): AssetPartStyle | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const out: AssetPartStyle = {};
  const hex = normalizeTint(o.hex);
  if (hex) out.hex = hex;
  const finish = normalizeFinish(o.finish);
  // 'original' IS "leave the material alone", so it is never stored.
  if (finish !== DEFAULT_FINISH) out.finish = finish;
  return out.hex || out.finish ? out : undefined;
}

/** A style id the 2D lettering already defines — one list, not a second copy. */
function normalizeLabelStyle(raw: unknown): GuestLetteringStyle | null {
  return typeof raw === 'string' && Object.prototype.hasOwnProperty.call(CHAR_WIDTH_RATIO, raw)
    ? (raw as GuestLetteringStyle)
    : null;
}

function normalizeLabel(raw: unknown): AssetLabelConfig | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const slotId = typeof o.slotId === 'string' ? o.slotId.trim().slice(0, ASSET_CUSTOMIZATION.maxSlotIdLength) : '';
  if (!slotId) return undefined;
  const token = o.token === 'fixed' ? 'fixed' : o.token === 'guestName' ? 'guestName' : null;
  if (!token) return undefined;
  const style = normalizeLabelStyle(o.style);
  if (!style) return undefined;
  const text = typeof o.text === 'string' ? o.text.trim().slice(0, ASSET_CUSTOMIZATION.maxLabelLength) : '';
  // A 'fixed' engraving with nothing to say is the same as no label at all —
  // the same rule letteringFit.normalizeGuestLettering applies to 2D lettering.
  // 'guestName' keeps its slot with no text: the name arrives at booth time.
  if (token === 'fixed' && !text) return undefined;
  const hex = normalizeTint(o.hex) ?? (normalizeTint(DEFAULT_LETTERING_COLOR) as string);
  const label: AssetLabelConfig = { slotId, token, style, hex };
  if (text) label.text = text;
  return label;
}

/**
 * Validate an `ExperienceLayer.customization` value (untrusted jsonb, or a
 * partially-built patch) into the ONE canonical shape — or `undefined`, which
 * means "nothing is customized" and is what makes the key absent from storage.
 *
 * Every default is dropped, not written: no `finish: 'original'`, no empty
 * `parts: {}`, no `label` whose fixed text is blank. Region keys are emitted in
 * sorted order so the same customization always serialises the same way,
 * whatever order the host clicked the regions in.
 */
export function normalizeCustomization(raw: unknown): AssetCustomization | undefined {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const out: AssetCustomization = {};

  const rawParts = o.parts;
  if (rawParts !== null && typeof rawParts === 'object' && !Array.isArray(rawParts)) {
    const parts: Record<string, AssetPartStyle> = {};
    let kept = 0;
    for (const key of Object.keys(rawParts as Record<string, unknown>).sort()) {
      if (kept >= ASSET_CUSTOMIZATION.maxParts) break;
      const id = key.trim().slice(0, ASSET_CUSTOMIZATION.maxPartIdLength);
      if (!id) continue;
      const part = normalizePart((rawParts as Record<string, unknown>)[key]);
      if (!part) continue;
      parts[id] = part;
      kept += 1;
    }
    if (kept > 0) out.parts = parts;
  }

  const label = normalizeLabel(o.label);
  if (label) out.label = label;

  return out.parts || out.label ? out : undefined;
}

/** Spread-in form of the above — absent entirely when nothing is customized. */
function customizationKeys(src: { customization?: unknown }): Partial<Object3D> {
  const c = normalizeCustomization(src.customization);
  return c ? { customization: c } : {};
}

/**
 * Apply a SET_CUSTOMIZATION patch to one 3D object.
 *
 * Mirrors `withFinish` exactly, for the same reason: the merged result goes back
 * through the single normalizer, so an object the host styled and then cleared
 * carries NO customization key at all — identical bytes to one that was never
 * touched. `null` is the explicit clear (undefined means "leave it").
 */
export function withCustomization(
  o: Object3D,
  patch: {
    /** Restyle one region; `hex`/`finish` null clears that field. */
    part?: { id: string; hex?: string | null; finish?: string | null };
    /** Replace or (null) remove the engraved label. */
    label?: AssetLabelConfig | null;
  },
): Object3D {
  const current = o.customization;
  const parts: Record<string, AssetPartStyle> = { ...(current?.parts ?? {}) };

  if (patch.part) {
    const { id, hex, finish } = patch.part;
    const existing = parts[id] ?? {};
    const next: AssetPartStyle = {};
    const nextHex = hex !== undefined ? hex : existing.hex;
    if (nextHex) next.hex = nextHex;
    const nextFinish = finish !== undefined ? finish : existing.finish;
    if (nextFinish) next.finish = nextFinish;
    if (next.hex || next.finish) parts[id] = next;
    else delete parts[id];
  }

  const merged: AssetCustomization = {};
  if (Object.keys(parts).length) merged.parts = parts;
  const label = patch.label !== undefined ? patch.label : current?.label;
  if (label) merged.label = label;

  const next: Object3D = { ...o };
  delete next.customization;
  return { ...next, ...customizationKeys({ customization: merged }) };
}

/* — Draft ------------------------------------------------------------------ */

export interface StudioDraft {
  /** Set when editing an existing experience (?id= deep link). */
  id?: string;
  name: string;
  /**
   * DERIVED from the scene (deriveKind, run after every objects/filter
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
  /** Face-triggered effects (studio "Magic Triggers"). Empty for scenes with
   *  none — draftMapping omits config.triggers so those saves stay byte-identical. */
  triggers: TriggerConfig[];
}

export interface StudioState {
  mode: StudioMode;
  threeView: ThreeView;
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
    triggers: [],
  };
}

export function initialState(kind: StudioKind = 'shader'): StudioState {
  return {
    mode: kind === '3d_attachment' ? '3d' : '2d',
    // Default to LIVE. Opening 3D into the no-camera reference view meant
    // entering 3D turned tracking off rather than on, and the host had to find a
    // second control to get the WYSIWYG view they came for. The reference head
    // is still one tap away for precise placement without a face.
    threeView: 'live',
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
 * Whether one more object of `kind` would actually land.
 *
 * Adds past MAX_OBJECTS are silently ignored in the reducer (appendObject and
 * the ADD_OBJECT branch both bail), the dock only surfaced a counter from 15,
 * and a dropped drag past the cap simply vanished — so at the cap the studio
 * looked broken rather than full. Every add site now asks this FIRST and says
 * so when the answer is no. A frame is exempt: placeFrame swaps in place.
 */
export function canAddObject(d: StudioDraft, kind: 'frame' | 'cappable' = 'cappable'): boolean {
  if (kind === 'frame') return true;
  return sceneCounts(d).capped < MAX_OBJECTS;
}

/** The one sentence every refusal shows, so the wording cannot drift per surface. */
export const SCENE_FULL_MESSAGE =
  `This scene is full — ${MAX_OBJECTS} stickers and 3D pieces is the limit (the frame doesn't count). Remove a layer to add another.`;

/**
 * The 3D piece already occupying the SLOT a new add would land on, or null.
 *
 * The slot is the exact mount point, not the whole family: a crown + glasses
 * scene is legitimate multi-piece composition, but two visors on the nose
 * bridge (or two props in the same fist) physically overlap — that is when
 * the dock asks Replace-or-Add-both instead of silently stacking them.
 * Head slots compare `anchor` (hand-tracked pieces excluded); hand slots
 * compare `handAnchor`.
 */
export function slotConflict(
  d: StudioDraft,
  slot: { anchor?: HeadAnchor; handAnchor?: string },
): Object3D | null {
  const found = d.objects.find((o) => {
    if (o.type === 'overlay') return false;
    if (slot.handAnchor !== undefined) return o.handAnchor === slot.handAnchor;
    return o.handAnchor === undefined && o.anchor === (slot.anchor ?? 'crown');
  });
  return found !== undefined && found.type !== 'overlay' ? found : null;
}

/* ── Scene-level occlusion ────────────────────────────────────────────────
 *
 * Occlusion is stored PER OBJECT (`Object3D.occlusion`) but its EFFECT is
 * scene-global: exactly one FaceOccluder renders per canvas — Overlay3D and
 * Studio3DView both pick the FIRST head-anchored piece that opted in — and
 * every piece in that canvas then depth-tests against it. So a per-piece
 * switch was a lie: flipping it on any piece but the first did nothing
 * visible, and flipping it on the first silently occluded all the others.
 * The UI now shows ONE scene switch that reads as OR over the scene's 3D
 * pieces and writes to all of them; the per-object FIELD stays exactly as it
 * was, so every stored scene (and a library entry's `defaultOcclude`) keeps
 * working unchanged.
 */

/** Does this scene occlude? OR over its 3D objects — the honest read of a
 *  scene-global effect stored per piece. */
export function sceneOcclusion(d: StudioDraft): boolean {
  return d.objects.some((o) => is3D(o) && o.occlusion === true);
}

/**
 * The occlusion flag a newly added 3D piece should carry.
 *
 * A scene that already has 3D pieces INHERITS its own current setting, so the
 * scene switch never disagrees with what renders. The first 3D piece of a
 * BRAND-NEW draft (no `id`: never saved, not opened from an existing
 * experience) defaults ON, because hiding props behind the real head is what
 * a host expects. An EXISTING scene is never defaulted on — that would start
 * depth-clipping halos, back bands and oversized props at live events with no
 * host action.
 */
export function nextPieceOcclusion(d: StudioDraft): boolean {
  if (d.objects.some(is3D)) return sceneOcclusion(d);
  return d.id === undefined;
}

/** Apply the scene's occlusion default to a 3D object on its way into the
 *  scene. Never turns an opt-in OFF: a library entry's `defaultOcclude` (or
 *  any caller that asked for true) wins. */
function withSceneOcclusion(d: StudioDraft, obj: StudioObject): StudioObject {
  if (!is3D(obj) || obj.occlusion === true) return obj;
  return { ...obj, occlusion: nextPieceOcclusion(d) };
}

/**
 * The DERIVED draft kind from the current objects:
 *   • a 2D overlay AND a 3D object present → 'composite'
 *   • only overlays → objects[0].overlayKind ('border' | '2d_filter')
 *   • only 3D objects → '3d_attachment'
 *   • no objects → 'shader' (regardless of the filter slot)
 */
export function deriveKind(d: StudioDraft): DraftKind {
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
 * Stickers and 3D pieces ALWAYS APPEND (and select) — a click never deletes or
 * replaces anything. An earlier "browse-swap" heuristic silently replaced an
 * unmoved same-kind selection, which read as "my sticker just vanished" — the
 * exact confusion multiple-objects-by-default exists to prevent. Swapping a
 * design is now: delete (or undo) + add. Frames are the deliberate exception —
 * placeFrame swaps THE frame, because a scene holds at most one.
 * Returns null when the MAX_OBJECTS cap blocks the add.
 */
function appendObject(d: StudioDraft, obj: StudioObject): StudioDraft | null {
  // The cap counts stickers + 3D only (the frame is exempt); this helper only
  // ever adds cappable objects, so compare against the capped count.
  if (sceneCounts(d).capped >= MAX_OBJECTS) return null;
  const placed = withSceneOcclusion(d, obj);
  return { ...d, objects: [...d.objects, placed], selectedId: placed.id };
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
  | { type: 'SET_KIND'; kind: StudioKind }
  /**
   * Replace the whole draft. `dirty` defaults to FALSE (a freshly-loaded
   * experience matches its saved row), but a LOAD that creates UNSAVED work —
   * Duplicate, "use template", loading a starter scene — must pass `dirty:true`.
   * Without it the duplicate was unsaved AND the leave-guard was disarmed, so
   * one tap on the back arrow discarded it with no prompt at all.
   */
  | { type: 'LOAD'; draft: StudioDraft; dirty?: boolean }
  | { type: 'SET_NAME'; name: string }
  | { type: 'SELECT_SHADER'; shaderId: string; params: Record<string, number> }
  | { type: 'SET_SHADER_PARAM'; key: string; value: number }
  | { type: 'SET_SHADER_PARAMS'; params: Record<string, number> }
  | { type: 'CLEAR_FILTER' }
  | { type: 'SELECT_BUILTIN'; borderId: string; url: string }
  | { type: 'SET_OVERLAY_UPLOAD'; url: string; blob: Blob | null; overlayKind?: 'border' | '2d_filter'; name?: string }
  | { type: 'CLEAR_OVERLAY' }
  | { type: 'SET_TRANSFORM'; transform: Transform2D }
  | { type: 'SELECT_ANCHOR'; anchor: HeadAnchor }
  | { type: 'PATCH_ANCHOR_CONFIG'; patch: Partial<StudioAnchorConfig> }
  | { type: 'SELECT_HEAD_PIECE'; pieceId: string }
  /** `template` is the asset's configurator descriptor when the library row
   *  ships one (assetTemplate.AssetTemplate). Omitting it — every caller today
   *  — adds a plain, non-configurable model exactly as before. */
  | { type: 'SET_MODEL_ASSET'; url: string; name: string | null; scale?: number; template?: unknown; offsetCm?: { x: number; y: number; z: number }; rotationDeg?: { x: number; y: number; z: number }; occlude?: boolean; anchor?: HeadAnchor; handAnchor?: string }
  | { type: 'SET_THUMB'; url: string | null; blob: Blob | null }
  | { type: 'TOGGLE_PUBLISHED' }
  | { type: 'TOGGLE_FEATURED' }
  /**
   * Scene-level occlusion — writes EVERY 3D object in the draft, because one
   * occluder serves the whole canvas (see sceneOcclusion). Replaces the old
   * per-object SET_OCCLUSION, whose UI could not match what rendered.
   */
  | { type: 'SET_SCENE_OCCLUSION'; occlusion: boolean }
  /**
   * Restyle the SELECTED 3D object's material. Every field is optional so the
   * dock can change one without knowing the others; `tint: null` explicitly
   * CLEARS the tint (undefined would mean "leave it", and a host who picks
   * "no colour" must be able to get back to the exported look).
   */
  | { type: 'SET_FINISH'; finish?: string; tint?: string | null; tintStrength?: number }
  /**
   * Personalise the SELECTED 3D object: restyle one template region and/or set
   * the engraved label. Both fields optional so the dock can change one without
   * knowing the other; `label: null` and `part.hex/finish: null` are the
   * explicit clears (undefined means "leave it"), so the host can always get
   * back to the asset exactly as it shipped.
   */
  | { type: 'SET_CUSTOMIZATION'; part?: { id: string; hex?: string | null; finish?: string | null }; label?: AssetLabelConfig | null }
  | { type: 'SET_TEMPLATE_GUEST_PICK'; regionId: string; on: boolean }
  | { type: 'SET_SCENE_TAG'; scene: string | undefined }
  | { type: 'MARK_SAVED'; id: string }
  /* — multi-object scene actions — */
  | { type: 'ADD_OBJECT'; object: StudioObject; select?: boolean }
  | { type: 'DELETE_OBJECT'; id: string }
  | { type: 'SELECT_OBJECT'; id: string | null }
  | { type: 'REORDER_OBJECT'; id: string; dir: 'up' | 'down' }
  /** Splice-move an object to an absolute index in the flat paint order (drag-to-reorder). */
  | { type: 'MOVE_OBJECT'; id: string; toIndex: number }
  /** Rename a layer. Separate from UPDATE_OBJECT so it never coalesces with a transform edit. */
  | { type: 'RENAME_OBJECT'; id: string; name: string }
  | { type: 'UPDATE_OBJECT'; id: string; patch: Partial<Omit<Overlay2D, 'id' | 'type'>> | Partial<Omit<Object3D, 'id' | 'type'>> }
  | { type: 'SET_OBJECT_ANIMATION'; id: string; animation: LayerAnimation }
  /**
   * Switch a 3D piece between HEAD tracking and HAND tracking (the
   * wand-as-an-earring request works in both directions). `handAnchor` picks
   * the mount for hand mode ('grip' default); head mode keeps the object's
   * existing head anchor. A family switch zeroes offset/rotation — a visor's
   * brow nudge is meaningless on a wrist — but KEEPS scale (auto-fit is
   * family-independent).
   */
  | { type: 'SET_OBJECT_TRACKING'; id: string; tracking: 'head' | 'hand'; handAnchor?: string }
  /**
   * Repoint beam/animate triggers that named `fromId` at the CURRENTLY
   * SELECTED object. Dispatched right after a Replace-style add (delete old →
   * add new → retarget), when the reducer has already selected the
   * replacement — so "replace my visor" keeps its blast wired. Reveal
   * triggers are deliberately not touched (DELETE_OBJECT already drops them;
   * auto-revealing a piece the author never marked hidden would surprise).
   */
  | { type: 'RETARGET_TRIGGERS'; fromId: string }
  /* — face-triggered effects (Magic Triggers) — */
  | { type: 'ADD_TRIGGER'; trigger: TriggerConfig }
  | { type: 'UPDATE_TRIGGER'; id: string; patch: Partial<Omit<TriggerConfig, 'id'>> }
  | { type: 'REMOVE_TRIGGER'; id: string };

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
        threeView: 'live',
        draft: action.draft,
        // See the action's doc comment: a LOAD that creates unsaved work arms
        // the leave-guard instead of disarming it.
        dirty: action.dirty === true,
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
      const nd = overlayKind === 'border' ? placeFrame(d, obj) : appendObject(d, obj);
      if (!nd) return state;
      return { ...state, mode: '2d', dirty: true, draft: { ...nd, kind: deriveKind(nd) } };
    }
    case 'SET_OVERLAY_UPLOAD': {
      const sel = selectedObject(d);
      // The caller's browsing context (dock category / drag payload) names the
      // sub-kind explicitly; else inherit the selected overlay's, else frame.
      // (Without the explicit kind, uploading while browsing Stickers made a frame.)
      const overlayKind: 'border' | '2d_filter' =
        action.overlayKind ?? (sel && sel.type === 'overlay' ? sel.overlayKind : 'border');
      const obj = createOverlay(overlayKind, {
        url: action.url,
        blob: action.blob,
        isBuiltin: false,
        name: action.name?.trim() || 'Custom overlay',
      });
      const nd = overlayKind === 'border' ? placeFrame(d, obj) : appendObject(d, obj);
      if (!nd) return state;
      return { ...state, mode: '2d', dirty: true, draft: { ...nd, kind: deriveKind(nd) } };
    }
    case 'CLEAR_OVERLAY': {
      const sel = selectedObject(d);
      if (!sel || sel.type !== 'overlay') return state;
      // With no auto-default frame anymore, clearing a border DELETES it (same as
      // a sticker); the scene may be left frame-less.
      const objects = d.objects.filter((o) => o.id !== sel.id);
      const selectedId = objects.length ? objects[objects.length - 1].id : null;
      const nd = { ...d, objects, selectedId };
      return { ...state, dirty: true, draft: { ...nd, kind: deriveKind(nd) } };
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
      const nd = appendObject(d, obj);
      if (!nd) return state;
      // Creator UX: name a brand-new (unsaved, first-object) experience after the
      // piece; never rename when editing an existing one or adding to a scene.
      const name = !d.id && nd.objects.length === 1 ? piece.name : d.name;
      return { ...state, mode: '3d', dirty: true, draft: { ...nd, kind: deriveKind(nd), name } };
    }
    case 'SET_MODEL_ASSET': {
      // Optional auto-fit scale measured from the GLB at ADD time (head space
      // is metric cm; a raw ~1-unit Meshy model renders ~1cm). Stored in the
      // object's own transform so saved scenes and the booth are untouched.
      const obj = createObject3D('model', {
        assetUrl: action.url,
        name: action.name ?? 'Model',
        template: action.template,
        // Library entries carry their natural mount: eyewear at noseBridge,
        // a wand at the hand's grip. Absent = the historical default (crown).
        anchor: action.anchor,
        handAnchor: action.handAnchor,
        // offsetCm/rotationDeg: a library entry's authored starting placement
        // (a cap rides at the hairline, not the brow; a gauntlet lands sideways
        // on the wrist until turned) — the same fields the Placement sliders
        // edit, so the host can still move it and saved scenes are untouched.
        // DEGREES in, radians stored: the action speaks the authoring unit and
        // anchorConfig keeps the render unit, so neither side has to remember.
        anchorConfig: action.scale != null || action.offsetCm != null || action.rotationDeg != null
          ? {
              offset: action.offsetCm ?? { x: 0, y: 0, z: 0 },
              rotation: action.rotationDeg
                ? {
                    x: (action.rotationDeg.x * Math.PI) / 180,
                    y: (action.rotationDeg.y * Math.PI) / 180,
                    z: (action.rotationDeg.z * Math.PI) / 180,
                  }
                : { x: 0, y: 0, z: 0 },
              scale: action.scale ?? 1,
            }
          : undefined,
        // Absent stays absent: createObject3D's own `?? false` keeps every
        // existing add path byte-identical.
        occlusion: action.occlude,
      });
      const nd = appendObject(d, obj);
      if (!nd) return state;
      return { ...state, mode: '3d', dirty: true, draft: { ...nd, kind: deriveKind(nd) } };
    }
    case 'SET_THUMB':
      return { ...state, dirty: true, draft: { ...d, thumbUrl: action.url, thumbBlob: action.blob } };
    case 'TOGGLE_PUBLISHED':
      return { ...state, dirty: true, draft: { ...d, isPublished: !d.isPublished } };
    case 'TOGGLE_FEATURED':
      return { ...state, dirty: true, draft: { ...d, featured: !d.featured } };
    case 'SET_SCENE_OCCLUSION': {
      if (!d.objects.some(is3D)) return state;
      return {
        ...state,
        dirty: true,
        draft: {
          ...d,
          objects: d.objects.map((o) => (is3D(o) ? { ...o, occlusion: action.occlusion } : o)),
        },
      };
    }
    case 'SET_FINISH': {
      const sel = selectedObject(d);
      if (!sel || !is3D(sel)) return state;
      return {
        ...state,
        dirty: true,
        draft: { ...d, objects: mapObjects(d, sel.id, (o) => (is3D(o) ? withFinish(o, action) : o)) },
      };
    }
    case 'SET_CUSTOMIZATION': {
      const sel = selectedObject(d);
      if (!sel || !is3D(sel)) return state;
      // Same shape as SET_FINISH above: normalize through withCustomization and
      // mark dirty (no value-diff short-circuit — SET_FINISH has none either).
      return {
        ...state,
        dirty: true,
        draft: { ...d, objects: mapObjects(d, sel.id, (o) => (is3D(o) ? withCustomization(o, action) : o)) },
      };
    }
    case 'SET_TEMPLATE_GUEST_PICK': {
      // Stamp/clear `guestPick` on ONE region of the selected object's raw
      // template (the descriptor travels opaquely — see Object3D.template).
      // Raw-JSON clone so normalizeTemplate still owns validation downstream;
      // a malformed template is left untouched rather than "repaired".
      const sel = selectedObject(d);
      if (!sel || !is3D(sel) || sel.template === null || typeof sel.template !== 'object') return state;
      const clone = JSON.parse(JSON.stringify(sel.template)) as Record<string, unknown>;
      const regions = clone.regions;
      if (!Array.isArray(regions)) return state;
      let touched = false;
      for (const r of regions) {
        if (r !== null && typeof r === 'object' && (r as Record<string, unknown>).id === action.regionId) {
          if (action.on) (r as Record<string, unknown>).guestPick = true;
          else delete (r as Record<string, unknown>).guestPick;
          touched = true;
        }
      }
      if (!touched) return state;
      return {
        ...state,
        dirty: true,
        draft: { ...d, objects: mapObjects(d, sel.id, (o) => (is3D(o) ? { ...o, template: clone } : o)) },
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
      const obj = withSceneOcclusion(d, action.object);
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
      return { ...state, dirty: true, draft: { ...nd, kind: deriveKind(nd) } };
    }
    case 'DELETE_OBJECT': {
      const idx = d.objects.findIndex((o) => o.id === action.id);
      if (idx < 0) return state;
      const objects = d.objects.filter((o) => o.id !== action.id);
      let selectedId = d.selectedId;
      if (d.selectedId === action.id) selectedId = objects.length ? objects[Math.max(0, idx - 1)].id : null;
      // Drop any reveal trigger that targeted the deleted piece (no dangling refs).
      const triggers = d.triggers.some((t) => t.action.type === 'reveal' && t.action.objectId === action.id)
        ? d.triggers.filter((t) => !(t.action.type === 'reveal' && t.action.objectId === action.id))
        : d.triggers;
      const nd = { ...d, objects, selectedId, triggers };
      return { ...state, dirty: true, draft: { ...nd, kind: deriveKind(nd) } };
    }
    case 'SELECT_OBJECT': {
      if (action.id !== null && !d.objects.some((o) => o.id === action.id)) return state;
      if (action.id === d.selectedId) return state;
      // Selection is not a content edit — leaves `dirty` untouched.
      return { ...state, draft: { ...d, selectedId: action.id } };
    }
    case 'REORDER_OBJECT': {
      // Swaps ADJACENT ARRAY indices = one step of real paint order. The
      // "the list does not move" problem this used to have was never in the
      // reducer: the Layers panel rendered three FIXED BUCKETS while this acted
      // on the flat array, so a cross-bucket step changed the stage and nothing
      // in the list. The panel now renders ONE flat list in true array order
      // (src/lib/studio/layerOrder.ts), so every step is visible where it
      // happens. `dir` keeps its ORIGINAL array meaning ('up' = toward index 0)
      // so every existing caller and test is untouched; the new flat panel uses
      // MOVE_OBJECT, whose absolute index has no direction to misread at all.
      const idx = d.objects.findIndex((o) => o.id === action.id);
      if (idx < 0) return state;
      const swap = action.dir === 'up' ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= d.objects.length) return state;
      const objects = moveByIndex(d.objects, idx, swap);
      if (objects === d.objects) return state;
      const nd = { ...d, objects };
      return { ...state, dirty: true, draft: { ...nd, kind: deriveKind(nd) } };
    }
    case 'MOVE_OBJECT': {
      // Drag-to-reorder: a SPLICE-move, not a swap — dropping the top layer at
      // the bottom must land it there and shift the rest up, not trade places
      // with whatever happened to sit at that index.
      const idx = d.objects.findIndex((o) => o.id === action.id);
      if (idx < 0) return state;
      const objects = moveByIndex(d.objects, idx, action.toIndex);
      if (objects === d.objects) return state;
      const nd = { ...d, objects };
      return { ...state, dirty: true, draft: { ...nd, kind: deriveKind(nd) } };
    }
    case 'RENAME_OBJECT': {
      const name = action.name.trim().slice(0, 120);
      // An empty rename is a cancel, not a way to produce a nameless layer.
      if (!name) return state;
      const target = d.objects.find((o) => o.id === action.id);
      if (!target || target.name === name) return state;
      return {
        ...state,
        dirty: true,
        draft: { ...d, objects: mapObjects(d, action.id, (o) => ({ ...o, name })) },
      };
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
      return { ...state, dirty: true, draft: { ...nd, kind: deriveKind(nd) } };
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
    case 'SET_OBJECT_TRACKING': {
      const target = d.objects.find((o) => o.id === action.id);
      if (!target || target.type === 'overlay') return state;
      const wantHand = action.tracking === 'hand';
      const wasHand = target.handAnchor !== undefined;
      const nextHandAnchor = wantHand
        ? (isHandAnchorId(action.handAnchor) ? action.handAnchor : (target.handAnchor ?? 'grip'))
        : undefined;
      if (wantHand === wasHand && nextHandAnchor === target.handAnchor) return state;
      const objects = mapObjects(d, action.id, (o) => {
        const next = { ...(o as Object3D) };
        if (nextHandAnchor !== undefined) next.handAnchor = nextHandAnchor;
        else delete next.handAnchor;
        if (wantHand !== wasHand) {
          // Cross-family placement tuning does not transfer (a visor's brow
          // offset floats a wand off the fist). Scale survives.
          next.anchorConfig = {
            ...next.anchorConfig,
            offset: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
          };
        }
        return next;
      });
      return { ...state, dirty: true, draft: { ...d, objects } };
    }
    case 'RETARGET_TRIGGERS': {
      const toId = d.selectedId;
      if (toId === null || toId === action.fromId) return state;
      let changed = false;
      const triggers = d.triggers.map((t) => {
        const a = t.action;
        if ((a.type === 'beam' || a.type === 'animate') && a.objectId === action.fromId) {
          changed = true;
          return { ...t, action: { ...a, objectId: toId } };
        }
        return t;
      });
      if (!changed) return state;
      return { ...state, dirty: true, draft: { ...d, triggers } };
    }
    case 'ADD_TRIGGER': {
      // Soft cap: adds past MAX_TRIGGERS are ignored (the dock also gates the button).
      if (d.triggers.length >= MAX_TRIGGERS) return state;
      return { ...state, dirty: true, draft: { ...d, triggers: [...d.triggers, action.trigger] } };
    }
    case 'UPDATE_TRIGGER': {
      if (!d.triggers.some((t) => t.id === action.id)) return state;
      // id is immutable — a patch never changes a trigger's identity.
      return {
        ...state,
        dirty: true,
        draft: { ...d, triggers: d.triggers.map((t) => (t.id === action.id ? { ...t, ...action.patch, id: t.id } : t)) },
      };
    }
    case 'REMOVE_TRIGGER': {
      if (!d.triggers.some((t) => t.id === action.id)) return state;
      return { ...state, dirty: true, draft: { ...d, triggers: d.triggers.filter((t) => t.id !== action.id) } };
    }
  }
}
