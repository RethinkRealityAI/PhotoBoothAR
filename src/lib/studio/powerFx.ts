/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Power FX builder model — the PURE half of the "Power-Ups" mini-app
 * (components/studio/PowerFxBuilder.tsx renders it). Everything the modal
 * means — gear catalogue, palette, validation, and exactly what gets added to
 * the scene — lives here under the node test suite.
 *
 * The built beam trigger deliberately carries NO objectId: reducer object ids
 * are generated at dispatch time, and a beam without an emitter id resolves to
 * the scene's first 3D piece — which IS the gear this builder just added. That
 * one convention removes an entire id-plumbing failure mode.
 */

import type { AssetCustomization } from '../../types';
import { beamRegionId } from './beam';
import { normalizeTemplate, type AssetTemplate } from './assetTemplate';
import type { BeamStyle, TriggerConfig, TriggerSource } from './triggers';

export type PowerGearKind = 'headpiece' | 'library';

export interface PowerGearDef {
  id: string;
  name: string;
  blurb: string;
  kind: PowerGearKind;
  /** HEAD_PIECES id (headpiece) or ConfigurableAsset id (library). */
  refId: string;
  /** Suggested pairing, preselected when the gear is picked. */
  defaultSource: TriggerSource;
  defaultStyle: BeamStyle;
  swatch: [string, string];
}

/**
 * The curated gear shelf. Library entries only appear in the builder when the
 * id exists in LIBRARY_ASSETS (availableGear filters) — so this list may name
 * assets ahead of their vendoring without ever showing a dead tile.
 */
export const POWER_GEAR: readonly PowerGearDef[] = [
  {
    id: 'cyclops-visor',
    name: 'Optic Visor',
    blurb: 'One-lens hero visor — blast fires from your eyes',
    kind: 'library',
    refId: 'cyclops-visor',
    defaultSource: 'handToTemple',
    defaultStyle: 'optic',
    swatch: ['#23262e', '#ff2b4a'],
  },
  {
    id: 'cyclops-visor-lite',
    name: 'Optic Visor (classic)',
    blurb: 'The built-in visor — instant, ruby lens',
    kind: 'headpiece',
    refId: 'cyclops-visor',
    defaultSource: 'handToTemple',
    defaultStyle: 'optic',
    swatch: ['#23262e', '#ff2b4a'],
  },
  {
    id: 'wizard-wand',
    name: 'Wizard Wand',
    blurb: 'Held in the hand — pinch to stream sparkles',
    kind: 'library',
    refId: 'wizard-wand',
    defaultSource: 'pinch',
    defaultStyle: 'sparkle',
    swatch: ['#4a2c17', '#b388ff'],
  },
  {
    id: 'power-gauntlet',
    name: 'Power Gauntlet',
    blurb: 'Armored glove — open your palm to blast',
    kind: 'library',
    refId: 'power-gauntlet',
    defaultSource: 'palmOpen',
    defaultStyle: 'energy',
    swatch: ['#2b2e35', '#18ffff'],
  },
  {
    id: 'none',
    name: 'No gear',
    blurb: 'Just the blast — fires from your eyes or hand',
    kind: 'headpiece',
    refId: '',
    defaultSource: 'fistClench',
    defaultStyle: 'energy',
    swatch: ['#1a1d24', '#7df9ff'],
  },
];

/** Gear whose asset actually exists right now. `libraryIds` = the ids present
 *  in LIBRARY_ASSETS (passed in so this module stays import-light and pure). */
export function availableGear(libraryIds: readonly string[]): PowerGearDef[] {
  return POWER_GEAR.filter((g) => g.kind === 'headpiece' || libraryIds.includes(g.refId));
}

export const POWER_PALETTE: readonly { hex: string; label: string }[] = [
  { hex: '#ff2b4a', label: 'Ruby' },
  { hex: '#00e676', label: 'Emerald' },
  { hex: '#2979ff', label: 'Sapphire' },
  { hex: '#b388ff', label: 'Violet' },
  { hex: '#ffd740', label: 'Gold' },
  { hex: '#18ffff', label: 'Ice' },
];

export interface PowerFxSpec {
  gearId: string;
  /** Lens / blast colour. */
  hex: string;
  /** Let guests re-pick the colour in the booth (library gear only). */
  guestPick: boolean;
  source: TriggerSource;
  style: BeamStyle;
}

export function defaultPowerFxSpec(gear: PowerGearDef): PowerFxSpec {
  return {
    gearId: gear.id,
    hex: '#ff2b4a',
    guestPick: true,
    source: gear.defaultSource,
    style: gear.defaultStyle,
  };
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function validatePowerFxSpec(s: PowerFxSpec): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!POWER_GEAR.some((g) => g.id === s.gearId)) errors.push('Pick a gear option.');
  if (!HEX_RE.test(s.hex)) errors.push('Pick a colour.');
  return { ok: errors.length === 0, errors };
}

export interface PowerFxAdditions {
  /** What to add to the scene, or null for gear 'none'. */
  gear:
    | { kind: 'headpiece'; pieceId: string }
    | { kind: 'library'; libraryId: string }
    | null;
  /**
   * Lens customization for library gear — parts[lensRegion].hex = the chosen
   * colour, so the visor lens AND the 'auto' beam colour agree. Null when the
   * gear has no recolourable template (procedural pieces keep authored looks).
   */
  customization: AssetCustomization | null;
  triggers: TriggerConfig[];
}

let trgCounter = 0;
/** Deterministic-in-test trigger ids (same idiom as state.ts object ids). */
function nextTriggerId(): string {
  return `trg-pfx-${++trgCounter}`;
}

/**
 * The single dispatchable result of the builder. `template` is the library
 * gear's raw descriptor (validated here) so the lens region can be resolved;
 * pass null for headpiece/none gear.
 */
export function buildPowerFxAdditions(spec: PowerFxSpec, template: unknown): PowerFxAdditions {
  const gearDef = POWER_GEAR.find((g) => g.id === spec.gearId) ?? null;
  const isLibrary = gearDef !== null && gearDef.kind === 'library';
  const tpl: AssetTemplate | null = isLibrary ? normalizeTemplate(template) : null;
  const lensRegion = beamRegionId(tpl);

  let customization: AssetCustomization | null = null;
  if (tpl !== null && lensRegion !== null) {
    customization = { parts: { [lensRegion]: { hex: spec.hex.toLowerCase() } } };
  }

  const gear: PowerFxAdditions['gear'] =
    gearDef === null || gearDef.refId === ''
      ? null
      : isLibrary
        ? { kind: 'library', libraryId: gearDef.refId }
        : { kind: 'headpiece', pieceId: gearDef.refId };

  // 'auto' whenever a lens region will carry the colour (so a guest's booth
  // re-pick follows through to the blast); explicit hex otherwise.
  const color = customization !== null ? 'auto' : spec.hex.toLowerCase();

  return {
    gear,
    customization,
    triggers: [
      {
        id: nextTriggerId(),
        source: spec.source,
        action: { type: 'beam', style: spec.style, color },
      },
    ],
  };
}
