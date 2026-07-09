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
  initialDraft,
  type Object3D,
  type Overlay2D,
  type StudioAnchorConfig,
  type StudioDraft,
  type StudioKind,
} from './state';

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

function anchorToStudio(a: AnchorConfig): StudioAnchorConfig {
  return {
    offset: { ...(a.offset ?? { x: 0, y: 0, z: 0 }) },
    rotation: { ...(a.rotation ?? { x: 0, y: 0, z: 0 }) },
    scale: a.scale ?? 1,
  };
}

/** Build an editing draft from a stored experience (?id= deep link). */
export function experienceToDraft(exp: Experience): StudioDraft | null {
  if (!isStudioKind(exp.kind)) return null;
  const draft = initialDraft(exp.kind);
  draft.id = exp.id;
  draft.name = exp.name;
  draft.isPublished = exp.is_published;
  draft.featured = exp.featured;
  draft.thumbUrl = exp.thumbnail_url ?? null;
  draft.scene = typeof exp.config?.scene === 'string' ? exp.config.scene : undefined;

  if (exp.kind === 'shader') {
    const sid = exp.config?.shader?.shaderId ?? draft.shaderId;
    draft.shaderId = sid;
    draft.shaderParams = exp.config?.shader?.params ?? defaultParams(sid);
    return draft;
  }

  const layers = exp.config?.layers;

  if (exp.kind === 'border' || exp.kind === '2d_filter') {
    if (layers?.length) {
      // Full multi-object scene from config.layers.
      draft.objects = layers.map((l) =>
        createOverlay(l.kind === '2d_filter' ? '2d_filter' : 'border', {
          // Stored assets load as custom so builtin sync never overwrites them.
          url: l.asset_url ?? null,
          isBuiltin: false,
          name: l.name,
          transform: l.transform,
          animation: l.animation ?? 'none',
        }),
      );
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
    return draft;
  }

  // 3d_attachment
  if (layers?.length) {
    draft.objects = layers.map((l) =>
      createObject3D(l.procedural ? 'headpiece' : 'model', {
        assetUrl: l.asset_url ?? undefined,
        proceduralId: l.procedural,
        name: l.name,
        anchor: l.anchor?.anchor,
        anchorConfig: l.anchor ? anchorToStudio(l.anchor) : undefined,
        animation: l.animation ?? 'none',
        // Occlusion is opt-IN: only an explicit `true` enables it.
        occlusion: l.occlusion === true,
      }),
    );
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
  return layer;
}

/**
 * Build the create/update payload from a draft. `resolvedUrls` maps each
 * object's id to its post-upload URL (or null); `resolvedThumbUrl` is the
 * uploaded thumbnail URL (or null).
 */
export function draftToPayload(
  draft: StudioDraft,
  resolvedUrls: UrlResolver,
  resolvedThumbUrl: string | null,
): ExperienceDraft {
  const config: ExperienceConfig = {};
  let assetUrl: string | null = null;

  if (draft.kind === 'shader') {
    config.shader = { shaderId: draft.shaderId, params: draft.shaderParams };
  } else if (draft.kind === 'border' || draft.kind === '2d_filter') {
    const objs = draft.objects.filter((o): o is Overlay2D => o.type === 'overlay');
    const anyAnim = objs.some((o) => o.animation !== 'none');
    const layer0 = objs[0];
    // Legacy mirror of layer 0.
    config.transform = layer0 ? { ...layer0.transform } : { scale: 1, x: 0, y: 0, rotation: 0 };
    config.opacity = 1;
    if (layer0) assetUrl = resolve(resolvedUrls, layer0.id);
    if (objs.length > 1 || anyAnim) config.layers = objs.map((o) => overlayLayer(o, resolvedUrls));
  } else {
    // 3d_attachment
    const objs = draft.objects.filter((o): o is Object3D => o.type !== 'overlay');
    const anyAnim = objs.some((o) => o.animation !== 'none');
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
    if (objs.length > 1 || anyAnim) config.layers = objs.map((o) => object3DLayer(o, resolvedUrls));
  }

  if (draft.scene) config.scene = draft.scene;

  return {
    name: draft.name,
    kind: draft.kind,
    asset_url: assetUrl,
    thumbnail_url: resolvedThumbUrl,
    config,
    is_published: draft.isPublished,
    featured: draft.featured,
    sort_order: 0,
  };
}
