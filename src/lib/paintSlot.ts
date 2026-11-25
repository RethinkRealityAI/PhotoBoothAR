/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The booth's face-paint slot, as pure functions.
 *
 * Paint used to share the 3D slot with props, so picking a paint took the
 * guest's hat off. It now has its own slot (Dapo, 2026-11-25): the booth keeps
 * a paint look beside the prop look and renders both through the SAME layer
 * pipeline (Overlay3D pieces), so a paint costs no extra tracking — it rides
 * the face mesh the props already use.
 */
import type { Experience, ExperienceLayer } from '../types';
import { isPaintLook } from './lookStrip';

/** Id given to a single-piece prop when it has to join a layered scene. */
export const SINGLE_PROP_LAYER_ID = 'booth:prop';

/**
 * A prop saved through the singular path (no config.layers: asset_url +
 * config.anchor/procedural/occlusion) as ONE layer, so it can sit beside a
 * paint in the pieces list. Exactly what Overlay3D's single-piece path draws:
 * same asset, procedural id, anchor and scene-level occlusion, no animation.
 */
export function singlePropLayer(exp: Experience): ExperienceLayer | null {
  const anchor = exp.config?.anchor;
  const procedural = exp.config?.procedural;
  if (!anchor || (!exp.asset_url && !procedural)) return null;
  return {
    id: SINGLE_PROP_LAYER_ID,
    kind: '3d_attachment',
    asset_url: exp.asset_url ?? null,
    anchor,
    ...(procedural ? { procedural } : {}),
    ...(exp.config?.occlusion === true ? { occlusion: true } : {}),
  };
}

/**
 * The layers the booth renders for its prop slot plus its paint slot.
 *
 * With no paint this returns the prop's own `config.layers` BY REFERENCE (or
 * undefined), so a booth without paint renders exactly as before. A paint's
 * layers ride after the prop's; any id that collides with a prop layer is
 * prefixed so React keys and per-layer pulses stay distinct.
 */
export function mergePaintLayers(
  attach: Experience | null,
  paint: Experience | null,
): ExperienceLayer[] | undefined {
  const own = attach?.config?.layers;
  const paintLayers = paint && isPaintLook(paint) ? paint.config?.layers ?? [] : [];
  if (paintLayers.length === 0) return own;
  let base: ExperienceLayer[] = [];
  if (own && own.length > 0) base = own;
  else if (attach) {
    const single = singlePropLayer(attach);
    if (single) base = [single];
  }
  const taken = new Set(base.map((l) => l.id));
  const added = paintLayers.map((l) => (taken.has(l.id) ? { ...l, id: `paint:${l.id}` } : l));
  return [...base, ...added];
}
