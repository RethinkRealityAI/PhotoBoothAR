/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Maps between the studio's editing draft and the persisted `experiences`
 * row shapes. A scene is an ordered list of objects; on save the FULL list is
 * written to `config.layers` (ExperienceLayer[]) whenever the scene has more
 * than one object OR any object carries a non-'none' animation. The legacy
 * singular fields (asset_url, config.transform / config.anchor /
 * config.procedural / config.occlusion) ALWAYS mirror layer 0 so renderers
 * that don't know about layers — and the frozen legacy events — keep working.
 *
 * A single plain object (no animation) writes byte-identically to what the old
 * Creator2D/Creator3D handleSave produced: no `config.layers` key at all.
 *
 * A mixed scene ('composite': both 2D overlays and 3D objects present) ALWAYS
 * writes config.layers (every object, in order) regardless of count or
 * animation, since kind-driven single-family renderers can't render it any
 * other way. Its legacy singular mirror is best-effort: the first 2D overlay
 * claims asset_url/config.transform, and the first 3D object separately
 * mirrors into config.anchor/config.procedural.
 *
 * A scene-level filter slot (draft.shaderId, 'none' = empty) can ride
 * alongside ANY scene that has objects; when occupied it is written to
 * config.ambientShader (never config.shader, which stays reserved for
 * filter-only 'shader' experiences that have no objects at all).
 *
 * Pure — asset/thumbnail uploads happen in the shell, which resolves each
 * object's post-upload URL and passes it in via `resolvedUrls`.
 */
import type {
  AnchorConfig,
  Experience,
  ExperienceConfig,
  ExperienceDraft,
  ExperienceLayer,
} from '../../types';
import { defaultParams } from '../shaders';
import {
  createObject3D,
  createOverlay,
  deriveKind,
  initialDraft,
  type DraftKind,
  type Object3D,
  type Overlay2D,
  type StudioAnchorConfig,
  type StudioDraft,
  type StudioKind,
  type StudioObject,
} from './state';
import { parseTriggers, type TriggerConfig } from './triggers';

const STUDIO_KINDS: readonly StudioKind[] = ['shader', 'border', '2d_filter', '3d_attachment'];

export function isStudioKind(kind: string): kind is StudioKind {
  return (STUDIO_KINDS as readonly string[]).includes(kind);
}

/**
 * Resolves an object id to its post-upload asset URL. The shell may supply a
 * Map (built during upload) or a function; either is fine since this stays pure.
 */
export type UrlResolver = ((objectId: string) => string | null) | Map<string, string | null>;

function resolve(r: UrlResolver, id: string): string | null {
  return typeof r === 'function' ? r(id) : (r.get(id) ?? null);
}

/**
 * Builds a `UrlResolver` from each object's URL ALREADY on the draft — no
 * upload happens. Used by "Save as template" (PropertiesDock), which persists
 * a snapshot of the CURRENT scene without re-uploading anything (unlike the
 * shell's handleSave, which uploads builtin SVGs / pending blobs fresh on
 * every save). Overlay objects reuse `obj.url` verbatim (a builtin's data:
 * URL or a previously-uploaded http url); 3D objects reuse `obj.assetUrl`
 * (null for procedural head pieces, which have no GLB asset).
 *
 * Returns null when any overlay still carries a pending, un-uploaded `blob`
 * (a custom image picked but never saved) — callers should surface that as
 * "save your experience first" rather than silently dropping the asset.
 */
export function existingUrlResolver(draft: StudioDraft): UrlResolver | null {
  const map = new Map<string, string | null>();
  for (const obj of draft.objects) {
    if (obj.type === 'overlay') {
      if (obj.blob) return null;
      map.set(obj.id, obj.url ?? null);
    } else {
      map.set(obj.id, obj.type === 'headpiece' && obj.proceduralId ? null : (obj.assetUrl ?? null));
    }
  }
  return map;
}

function anchorToStudio(a: AnchorConfig): StudioAnchorConfig {
  return {
    offset: { ...(a.offset ?? { x: 0, y: 0, z: 0 }) },
    rotation: { ...(a.rotation ?? { x: 0, y: 0, z: 0 }) },
    scale: a.scale ?? 1,
  };
}

/**
 * Resolve parsed triggers against the freshly-rebuilt scene. Object ids are
 * regenerated on load, so a `reveal` action's stored objectId is remapped
 * through `idMap` (stored layer id → new object id) to the live piece; a reveal
 * whose target no longer exists is DROPPED. Burst / filterPulse actions
 * reference no object, so they always survive.
 */
function finalizeTriggers(raw: TriggerConfig[], idMap: Map<string, string>): TriggerConfig[] {
  const out: TriggerConfig[] = [];
  for (const t of raw) {
    if (t.action.type === 'reveal') {
      const newId = idMap.get(t.action.objectId);
      if (!newId) continue; // target piece gone → drop
      out.push({ ...t, action: { ...t.action, objectId: newId } });
    } else {
      out.push(t);
    }
  }
  return out;
}

/**
 * Derives a draft's kind from its objects — mirrors state.ts's private
 * recomputeKind exactly (composite when both families are present; else the
 * lone family's kind; 'shader' when the scene is empty). Recomputing here
 * (rather than trusting a caller-supplied kind) keeps a draft/payload's
 * `kind` field always in sync with what the scene actually contains.
 */
/** Rebuilds a scene object from a stored `config.layers` entry (either family). */
function layerToObject(l: ExperienceLayer): StudioObject {
  let obj: StudioObject;
  if (l.kind === '3d_attachment') {
    obj = createObject3D(l.procedural ? 'headpiece' : 'model', {
      assetUrl: l.asset_url ?? undefined,
      proceduralId: l.procedural,
      name: l.name,
      anchor: l.anchor?.anchor,
      anchorConfig: l.anchor ? anchorToStudio(l.anchor) : undefined,
      animation: l.animation ?? 'none',
      // Occlusion is opt-IN: only an explicit `true` enables it.
      occlusion: l.occlusion === true,
    });
  } else {
    // Stored assets load as custom so builtin sync never overwrites them.
    obj = createOverlay(l.kind === '2d_filter' ? '2d_filter' : 'border', {
      url: l.asset_url ?? null,
      isBuiltin: false,
      name: l.name,
      transform: l.transform,
      animation: l.animation ?? 'none',
    });
  }
  // Hidden persists with the layer (kept in the scene, rendered nowhere) so a
  // reload never silently loses — or silently re-shows — a hidden layer.
  if (l.hidden === true) obj.hidden = true;
  return obj;
}

/**
 * Build an editing draft from a stored experience (?id= deep link). A
 * 'composite' experience (mixed 2D + 3D layers) loads too — it has no single
 * StudioKind of its own, so initialDraft seeds it with an arbitrary base
 * ('border') that is fully overwritten below.
 */
export function experienceToDraft(exp: Experience): StudioDraft | null {
  if (!isStudioKind(exp.kind) && exp.kind !== 'composite') return null;
  const draft = initialDraft(isStudioKind(exp.kind) ? exp.kind : 'border');
  draft.id = exp.id;
  draft.name = exp.name;
  draft.isPublished = exp.is_published;
  draft.featured = exp.featured;
  draft.thumbUrl = exp.thumbnail_url ?? null;
  draft.scene = typeof exp.config?.scene === 'string' ? exp.config.scene : undefined;

  const rawTriggers = parseTriggers(exp.config?.triggers);
  // Object ids are regenerated on load; record stored-layer-id → new-object-id
  // as layers are rebuilt so reveal triggers can be remapped to the live pieces.
  const idMap = new Map<string, string>();
  const fromLayers = (ls: ExperienceLayer[]): StudioObject[] =>
    ls.map((l) => {
      const o = layerToObject(l);
      idMap.set(l.id, o.id);
      return o;
    });

  if (exp.kind === 'shader') {
    const sid = exp.config?.shader?.shaderId ?? draft.shaderId;
    draft.shaderId = sid;
    draft.shaderParams = exp.config?.shader?.params ?? defaultParams(sid);
    draft.triggers = finalizeTriggers(rawTriggers, idMap);
    return draft;
  }

  // The scene-level filter slot rides alongside any non-shader scene.
  if (exp.config?.ambientShader) {
    const sid = exp.config.ambientShader.shaderId;
    draft.shaderId = sid;
    draft.shaderParams = exp.config.ambientShader.params ?? defaultParams(sid);
  }

  const layers = exp.config?.layers;

  if (exp.kind === 'composite') {
    draft.objects = fromLayers(layers ?? []);
    draft.selectedId = draft.objects[0]?.id ?? null;
    draft.kind = deriveKind(draft);
    draft.triggers = finalizeTriggers(rawTriggers, idMap);
    return draft;
  }

  if (exp.kind === 'border' || exp.kind === '2d_filter') {
    if (layers?.length) {
      // Full multi-object scene from config.layers.
      draft.objects = fromLayers(layers);
    } else if (exp.asset_url) {
      // Legacy single overlay from the singular fields.
      draft.objects = [
        createOverlay(exp.kind, {
          url: exp.asset_url,
          isBuiltin: false,
          transform: exp.config?.transform,
        }),
      ];
    }
    // else: keep initialDraft's default built-in overlay.
    draft.selectedId = draft.objects[0]?.id ?? null;
    draft.kind = draft.objects[0]?.type === 'overlay' ? draft.objects[0].overlayKind : exp.kind;
    draft.triggers = finalizeTriggers(rawTriggers, idMap);
    return draft;
  }

  // 3d_attachment
  if (layers?.length) {
    draft.objects = fromLayers(layers);
  } else if (exp.asset_url || exp.config?.procedural) {
    const a = exp.config?.anchor;
    draft.objects = [
      createObject3D(exp.config?.procedural ? 'headpiece' : 'model', {
        assetUrl: exp.asset_url ?? undefined,
        proceduralId: exp.config?.procedural ?? undefined,
        anchor: a?.anchor,
        anchorConfig: a ? anchorToStudio(a) : undefined,
        occlusion: exp.config?.occlusion === true,
      }),
    ];
  }
  // else: an empty 3D scene (no asset yet).
  draft.selectedId = draft.objects[0]?.id ?? null;
  draft.kind = draft.objects[0] ? '3d_attachment' : exp.kind;
  draft.triggers = finalizeTriggers(rawTriggers, idMap);
  return draft;
}

function overlayLayer(o: Overlay2D, r: UrlResolver): ExperienceLayer {
  const layer: ExperienceLayer = {
    id: o.id,
    kind: o.overlayKind,
    asset_url: resolve(r, o.id),
    transform: { ...o.transform },
    opacity: 1,
  };
  if (o.name) layer.name = o.name;
  if (o.animation !== 'none') layer.animation = o.animation;
  if (o.hidden) layer.hidden = true;
  return layer;
}

function object3DLayer(o: Object3D, r: UrlResolver): ExperienceLayer {
  const layer: ExperienceLayer = {
    id: o.id,
    kind: '3d_attachment',
    // Procedural pieces have no GLB asset.
    asset_url: o.type === 'headpiece' && o.proceduralId ? null : resolve(r, o.id),
    anchor: {
      anchor: o.anchor,
      offset: { ...o.anchorConfig.offset },
      rotation: { ...o.anchorConfig.rotation },
      scale: o.anchorConfig.scale,
    },
  };
  if (o.proceduralId) layer.procedural = o.proceduralId;
  if (o.name) layer.name = o.name;
  if (o.animation !== 'none') layer.animation = o.animation;
  if (o.occlusion) layer.occlusion = true;
  if (o.hidden) layer.hidden = true;
  return layer;
}

/**
 * Build the create/update payload from a draft. `resolvedUrls` maps each
 * object's id to its post-upload URL (or null); `resolvedThumbUrl` is the
 * uploaded thumbnail URL (or null). The saved `kind` is recomputed from
 * `draft.objects` (deriveKind) rather than trusted verbatim, so it always
 * matches what the scene actually contains.
 */
export function draftToPayload(
  draft: StudioDraft,
  resolvedUrls: UrlResolver,
  resolvedThumbUrl: string | null,
): ExperienceDraft {
  const config: ExperienceConfig = {};
  let assetUrl: string | null = null;
  const kind = deriveKind(draft);
  // A reveal trigger references a piece by id, so that scene must persist
  // config.layers (each layer carries its id) even when it would otherwise take
  // the byte-identical singular path. Scenes with no reveal are unaffected.
  const revealActive = draft.triggers.some((t) => t.action.type === 'reveal');

  if (kind === 'shader') {
    config.shader = { shaderId: draft.shaderId, params: draft.shaderParams };
  } else if (kind === 'border' || kind === '2d_filter') {
    const objs = draft.objects.filter((o): o is Overlay2D => o.type === 'overlay');
    const anyAnim = objs.some((o) => o.animation !== 'none');
    // A hidden object forces the layers path: the singular mirror alone can't
    // express "kept but not rendered", so the booth must read layers to skip it.
    const anyHidden = objs.some((o) => o.hidden === true);
    const layer0 = objs[0];
    // Legacy mirror of layer 0.
    config.transform = layer0 ? { ...layer0.transform } : { scale: 1, x: 0, y: 0, rotation: 0 };
    config.opacity = 1;
    if (layer0) assetUrl = resolve(resolvedUrls, layer0.id);
    if (objs.length > 1 || anyAnim || anyHidden || revealActive) config.layers = objs.map((o) => overlayLayer(o, resolvedUrls));
    // The scene-level filter slot ('none' = empty) can ride alongside any scene.
    if (draft.shaderId !== 'none') config.ambientShader = { shaderId: draft.shaderId, params: draft.shaderParams };
  } else if (kind === '3d_attachment') {
    const objs = draft.objects.filter((o): o is Object3D => o.type !== 'overlay');
    const anyAnim = objs.some((o) => o.animation !== 'none');
    // Hidden forces the layers path — see the 2D branch note.
    const anyHidden = objs.some((o) => o.hidden === true);
    const layer0 = objs[0];
    if (layer0) {
      // Legacy mirror of layer 0.
      config.anchor = {
        anchor: layer0.anchor,
        offset: { ...layer0.anchorConfig.offset },
        rotation: { ...layer0.anchorConfig.rotation },
        scale: layer0.anchorConfig.scale,
      };
      if (layer0.proceduralId) config.procedural = layer0.proceduralId;
      // Occlusion is opt-IN — mirror only when layer 0 enables it.
      if (layer0.occlusion) config.occlusion = true;
      assetUrl = layer0.type === 'headpiece' && layer0.proceduralId ? null : resolve(resolvedUrls, layer0.id);
    }
    if (objs.length > 1 || anyAnim || anyHidden || revealActive) config.layers = objs.map((o) => object3DLayer(o, resolvedUrls));
    // The scene-level filter slot ('none' = empty) can ride alongside any scene.
    if (draft.shaderId !== 'none') config.ambientShader = { shaderId: draft.shaderId, params: draft.shaderParams };
  } else {
    // composite — a mixed 2D + 3D scene: EVERY object becomes a layer, in
    // order. The legacy singular-field mirror is best-effort (old kind-driven
    // renderers never match kind 'composite' to begin with): the first 2D
    // overlay wins the one asset_url/transform slot; the first 3D object
    // separately mirrors into anchor/procedural (its own GLB asset_url has no
    // slot left, so it's dropped from the singular mirror).
    config.layers = draft.objects.map((o) => (o.type === 'overlay' ? overlayLayer(o, resolvedUrls) : object3DLayer(o, resolvedUrls)));

    const firstOverlay = draft.objects.find((o): o is Overlay2D => o.type === 'overlay');
    const first3D = draft.objects.find((o): o is Object3D => o.type !== 'overlay');
    if (firstOverlay) {
      config.transform = { ...firstOverlay.transform };
      config.opacity = 1;
      assetUrl = resolve(resolvedUrls, firstOverlay.id);
    }
    if (first3D) {
      config.anchor = {
        anchor: first3D.anchor,
        offset: { ...first3D.anchorConfig.offset },
        rotation: { ...first3D.anchorConfig.rotation },
        scale: first3D.anchorConfig.scale,
      };
      if (first3D.proceduralId) config.procedural = first3D.proceduralId;
      if (first3D.occlusion) config.occlusion = true;
    }
    // The scene-level filter slot ('none' = empty) can ride alongside any scene.
    if (draft.shaderId !== 'none') config.ambientShader = { shaderId: draft.shaderId, params: draft.shaderParams };
  }

  if (draft.scene) config.scene = draft.scene;
  // Face-triggered effects — omitted entirely when empty so trigger-less scenes
  // save byte-identically (no config.triggers key at all).
  if (draft.triggers.length) config.triggers = draft.triggers;

  return {
    name: draft.name,
    kind,
    asset_url: assetUrl,
    thumbnail_url: resolvedThumbUrl,
    config,
    is_published: draft.isPublished,
    featured: draft.featured,
    sort_order: 0,
  };
}
