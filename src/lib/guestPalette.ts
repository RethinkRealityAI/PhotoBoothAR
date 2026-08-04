/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Guest colour picker model — PURE. When a scene's 3D attachment carries a
 * configurator template with a guest-pickable region (host opt-in via the
 * `guestPick` flag, or a region literally named 'lens' as the sensible
 * default for a visor), the booth shows a swatch row and the guest's pick
 * overrides that region's hex FOR THIS SESSION ONLY — it never persists, and
 * because the override rides the ordinary customization path it recolours the
 * lens AND any 'auto'-coloured beam in one move.
 */

import type { ExperienceLayer } from '../types';
import { normalizeTemplate } from './studio/assetTemplate';
import { POWER_PALETTE } from './studio/powerFx';

export interface GuestColorSlot {
  layerId: string;
  regionId: string;
  /** Short caption over the swatch row ("Lens" / the region's label). */
  label: string;
  /** Host default first, then the curated palette, de-duped, ≤ 7. */
  swatches: string[];
  /** The colour showing before any guest pick (host customization or default). */
  currentHex: string;
}

const MAX_SWATCHES = 7;

/**
 * The one region a guest may recolour in this scene, or null. First layer
 * whose template flags a region `guestPick`; falls back to a recolourable
 * region literally named 'lens' so a host who never saw the toggle still gets
 * the obvious behaviour on a visor.
 */
export function guestColorSlot(
  layers: readonly ExperienceLayer[] | null | undefined,
): GuestColorSlot | null {
  if (!layers) return null;
  for (const layer of layers) {
    if (layer.kind !== '3d_attachment') continue;
    const template = normalizeTemplate(layer.template);
    if (template === null) continue;
    const region =
      template.regions.find((r) => r.guestPick === true && r.recolourable) ??
      template.regions.find((r) => r.id === 'lens' && r.recolourable);
    if (region === undefined) continue;
    const hostHex = layer.customization?.parts?.[region.id]?.hex;
    const currentHex = (hostHex !== undefined && hostHex !== null ? hostHex : region.defaultHex).toLowerCase();
    const swatches: string[] = [];
    for (const hex of [currentHex, ...POWER_PALETTE.map((p) => p.hex)]) {
      const h = hex.toLowerCase();
      if (!swatches.includes(h)) swatches.push(h);
      if (swatches.length >= MAX_SWATCHES) break;
    }
    return {
      layerId: layer.id,
      regionId: region.id,
      label: region.label,
      swatches,
      currentHex,
    };
  }
  return null;
}

/**
 * `layers` with the slot's region hex overridden by the guest's pick. Returns
 * the SAME array reference when there is nothing to do (hex null / no slot /
 * hex equals current), so Booth's overlayPieces memo never churns for the
 * overwhelming majority of sessions where no one touches the row.
 */
export function applyGuestColor<T extends readonly ExperienceLayer[]>(
  layers: T | null | undefined,
  slot: GuestColorSlot | null,
  hex: string | null,
): T | null | undefined {
  if (!layers || slot === null || hex === null) return layers;
  const h = hex.toLowerCase();
  if (h === slot.currentHex) return layers;
  return layers.map((l) => {
    if (l.id !== slot.layerId) return l;
    const parts = { ...(l.customization?.parts ?? {}) };
    parts[slot.regionId] = { ...(parts[slot.regionId] ?? {}), hex: h };
    return { ...l, customization: { ...(l.customization ?? {}), parts } };
  }) as unknown as T;
}
