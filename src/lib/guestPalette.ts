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
  /** The first (or only) region the pick recolours. */
  regionId: string;
  /** EVERY region the pick recolours. One entry for a visor's lens; a
   *  masquerade mask paints its base AND feathers in one tap. */
  regionIds: string[];
  /** Spoken names per swatch hex ("Emerald"), when the template names them. */
  names?: Record<string, string>;
  /** Short caption over the swatch row ("Lens" / the region's label). */
  label: string;
  /** Host default first, then the curated palette, de-duped, ≤ 7. */
  swatches: string[];
  /** The colour showing before any guest pick (host customization or default). */
  currentHex: string;
  /** CSS background per swatch whose button is striped (a flag colourway). */
  fills?: Record<string, string>;
  /** What a colourway swatch does beyond one hex: per-region colours and/or a
   *  baked variant model. Keyed like `swatches`. */
  picks?: Record<string, { parts?: Record<string, string>; glbUrl?: string }>;
}

/** CSS for a swatch button: a flat colour, or equal vertical stripes. */
export function swatchFill(colors: readonly string[]): string {
  if (colors.length < 2) return colors[0] ?? 'transparent';
  const step = 100 / colors.length;
  const stops = colors.map((c, i) => `${c} ${(i * step).toFixed(2)}% ${((i + 1) * step).toFixed(2)}%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

const MAX_SWATCHES = 7;
/** A template's named palette may run one longer (host pick + 10 named). */
const MAX_TEMPLATE_SWATCHES = 11;

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
    // A template with no paintable region can still offer baked variants
    // (flag-print shades): its swatches swap the model instead.
    const modelSwatches = template.guestSwatches?.some((sw) => sw.glbUrl !== undefined) === true;
    if (region === undefined && !modelSwatches) continue;
    const hostHex = region ? layer.customization?.parts?.[region.id]?.hex : undefined;
    const currentHex = region
      ? (hostHex !== undefined && hostHex !== null ? hostHex : region.defaultHex).toLowerCase()
      // No region: the swatch already drawing this layer's model, else the first.
      : (template.guestSwatches!.find((sw) => sw.glbUrl === layer.asset_url) ?? template.guestSwatches![0]).hex;
    // A template with its own named swatches (a masquerade mask) recolours
    // every guest-pickable region together and offers ITS palette, in order.
    if (template.guestSwatches) {
      const regionIds = template.regions
        .filter((r) => r.guestPick === true && r.recolourable)
        .map((r) => r.id);
      const ids = regionIds.length > 0 ? regionIds : region ? [region.id] : [];
      const names: Record<string, string> = {};
      const fills: Record<string, string> = {};
      const picks: NonNullable<GuestColorSlot['picks']> = {};
      const swatches: string[] = [];
      // The host's own pick leads when it is not one of the template's.
      if (!template.guestSwatches.some((sw) => sw.hex === currentHex)) {
        swatches.push(currentHex);
        names[currentHex] = 'Event colour';
      }
      for (const sw of template.guestSwatches) {
        if (swatches.length >= MAX_TEMPLATE_SWATCHES) break;
        if (swatches.includes(sw.hex)) continue;
        swatches.push(sw.hex);
        names[sw.hex] = sw.name;
        if (sw.dot) fills[sw.hex] = swatchFill(sw.dot);
        if (sw.parts || sw.glbUrl) {
          picks[sw.hex] = {
            ...(sw.parts ? { parts: sw.parts } : {}),
            ...(sw.glbUrl ? { glbUrl: sw.glbUrl } : {}),
          };
        }
      }
      return {
        layerId: layer.id,
        regionId: ids[0] ?? '',
        regionIds: ids,
        names,
        label: 'Colour',
        swatches,
        currentHex,
        ...(Object.keys(fills).length > 0 ? { fills } : {}),
        ...(Object.keys(picks).length > 0 ? { picks } : {}),
      };
    }
    if (region === undefined) continue;
    const swatches: string[] = [];
    for (const hex of [currentHex, ...POWER_PALETTE.map((p) => p.hex)]) {
      const h = hex.toLowerCase();
      if (!swatches.includes(h)) swatches.push(h);
      if (swatches.length >= MAX_SWATCHES) break;
    }
    return {
      layerId: layer.id,
      regionId: region.id,
      regionIds: [region.id],
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
  const pick = slot.picks?.[h];
  return layers.map((l) => {
    if (l.id !== slot.layerId) return l;
    const parts = { ...(l.customization?.parts ?? {}) };
    for (const id of slot.regionIds) parts[id] = { ...(parts[id] ?? {}), hex: pick?.parts?.[id] ?? h };
    // A colourway may also paint recolourable regions outside the guest's
    // usual reach (normalizeTemplate already dropped locked ones).
    for (const [id, hx] of Object.entries(pick?.parts ?? {})) parts[id] = { ...(parts[id] ?? {}), hex: hx };
    const next = Object.keys(parts).length > 0
      ? { ...l, customization: { ...(l.customization ?? {}), parts } }
      : { ...l };
    return pick?.glbUrl ? { ...next, asset_url: pick.glbUrl } : next;
  }) as unknown as T;
}
