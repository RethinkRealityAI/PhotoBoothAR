/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Maps between the studio's editing draft and the persisted `experiences`
 * row shapes. The payload shapes are byte-compatible with what the old
 * Creator2D/Creator3D handleSave wrote, so every saved experience keeps
 * loading and the booth renders unchanged. Pure — asset/thumbnail uploads
 * happen in the shell; this module only maps resolved URLs.
 */
import type { Experience, ExperienceConfig, ExperienceDraft } from '../../types';
import { defaultParams } from '../shaders';
import { initialDraft, type StudioDraft, type StudioKind } from './state';

const STUDIO_KINDS: readonly StudioKind[] = ['shader', 'border', '2d_filter', '3d_attachment'];

export function isStudioKind(kind: string): kind is StudioKind {
  return (STUDIO_KINDS as readonly string[]).includes(kind);
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
  draft.occlusion = exp.config?.occlusion !== false;

  if (exp.kind === 'shader') {
    const sid = exp.config?.shader?.shaderId ?? draft.shaderId;
    draft.shaderId = sid;
    draft.shaderParams = exp.config?.shader?.params ?? defaultParams(sid);
    return draft;
  }

  if (exp.kind === 'border' || exp.kind === '2d_filter') {
    if (exp.asset_url) {
      // Load the stored asset exactly as saved; treat as custom so builtin
      // sync never overwrites it (Creator2D edit-load semantics).
      draft.overlayUrl = exp.asset_url;
      draft.overlayIsBuiltin = false;
    }
    if (exp.config?.transform) draft.transform = { ...exp.config.transform };
    return draft;
  }

  // 3d_attachment
  draft.assetUrl = exp.asset_url ?? null;
  draft.proceduralId = exp.config?.procedural ?? null;
  const cfg = exp.config?.anchor;
  if (cfg) {
    draft.anchor = cfg.anchor ?? 'crown';
    draft.anchorConfig = {
      offset: { ...(cfg.offset ?? { x: 0, y: 0, z: 0 }) },
      rotation: { ...(cfg.rotation ?? { x: 0, y: 0, z: 0 }) },
      scale: cfg.scale ?? 1,
    };
  }
  return draft;
}

/**
 * Build the create/update payload from a draft. `resolvedAssetUrl` /
 * `resolvedThumbUrl` are the post-upload URLs (or null) supplied by the shell.
 */
export function draftToPayload(
  draft: StudioDraft,
  resolvedAssetUrl: string | null,
  resolvedThumbUrl: string | null,
): ExperienceDraft {
  const config: ExperienceConfig = {};

  if (draft.kind === 'shader') {
    config.shader = { shaderId: draft.shaderId, params: draft.shaderParams };
  } else if (draft.kind === 'border' || draft.kind === '2d_filter') {
    config.transform = { ...draft.transform };
    config.opacity = 1;
  } else {
    config.anchor = {
      anchor: draft.anchor,
      offset: { ...draft.anchorConfig.offset },
      rotation: { ...draft.anchorConfig.rotation },
      scale: draft.anchorConfig.scale,
    };
    if (draft.proceduralId) config.procedural = draft.proceduralId;
  }

  if (draft.scene) config.scene = draft.scene;
  // Only persist the opt-OUT — absent means "occlude", keeping every
  // pre-existing config valid and the booth default unchanged.
  if (!draft.occlusion) config.occlusion = false;

  return {
    name: draft.name,
    kind: draft.kind,
    asset_url: draft.kind === '3d_attachment' && draft.proceduralId ? null : resolvedAssetUrl,
    thumbnail_url: resolvedThumbUrl,
    config,
    is_published: draft.isPublished,
    featured: draft.featured,
    sort_order: 0,
  };
}
