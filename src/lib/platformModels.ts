/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Every 3D model the platform already ships, for /admin/library/import's
 * "Already on the platform" section. Pure: no React, no DOM, no network.
 *
 * Two homes, both IN CODE (not database rows), so neither can be retired from
 * the admin — the section says so instead of offering controls it cannot honour:
 *  - BUNDLED_PROPS (studio/bundledProps.ts): the ready-made props, incl. the
 *    Christmas set, each with a .webp thumbnail.
 *  - libraryAssets() (studio/assetLibrary.ts): the customisable models (cap,
 *    visor, wand, gauntlet) — no thumbnail image, so the tile uses the entry's
 *    own two-colour swatch.
 * Shared-library rows (the third home) come from admin-api at runtime and are
 * merged in by the page; `isLibrary3dKind` decides which of them count.
 *
 * Host-made models (inside a customer's own event) are deliberately NOT here:
 * they belong to that customer until they choose to share them.
 */
import { BUNDLED_PROPS } from './studio/bundledProps';
import { assetTemplateOf, libraryAssets } from './studio/assetLibrary';

export type PlatformModelSource = 'prop' | 'customisable';

export interface PlatformModel {
  id: string;
  name: string;
  source: PlatformModelSource;
  /** App-absolute .glb path, for the 3D preview. */
  url: string;
  /** Square preview image, or null (customisable models have none). */
  thumb: string | null;
  /** Two-colour fallback tile when there is no thumbnail. */
  swatch: [string, string] | null;
  /** Plain-words slot: "Top of head", "Eyes", "Hand"… */
  sitsOn: string;
  /** Seasonal set, e.g. 'christmas'; absent = evergreen. */
  collection?: string;
}

const HEAD_SLOTS: Record<string, string> = {
  crown: 'Top of head',
  forehead: 'Forehead',
  noseBridge: 'Eyes',
  noseTip: 'Nose',
  mouth: 'Mouth',
  chin: 'Chin',
  leftEar: 'Ears',
  rightEar: 'Ears',
};
const HAND_SLOTS: Record<string, string> = {
  grip: 'Hand',
  wristBack: 'Wrist',
};

/** Where a piece rides, in words an operator reads. A hand anchor wins. */
export function sitsOnLabel(anchor: string | undefined, handAnchor?: string): string {
  if (handAnchor) return HAND_SLOTS[handAnchor] ?? 'Hand';
  return (anchor && HEAD_SLOTS[anchor]) || 'Top of head';
}

/** The props and customisable models built into the app, props first. */
export function builtInModels(): PlatformModel[] {
  const props: PlatformModel[] = BUNDLED_PROPS.map((p) => ({
    id: p.id,
    name: p.name,
    source: 'prop',
    url: p.url,
    thumb: p.thumb,
    swatch: null,
    sitsOn: sitsOnLabel(p.anchor),
    ...(p.collection ? { collection: p.collection } : {}),
  }));
  const custom: PlatformModel[] = [];
  for (const a of libraryAssets()) {
    const t = assetTemplateOf(a);
    if (!t) continue; // an invalid descriptor never renders anywhere; don't list it
    custom.push({
      id: a.id,
      name: a.name,
      source: 'customisable',
      url: t.glbUrl,
      thumb: null,
      swatch: a.swatch,
      sitsOn: sitsOnLabel(a.anchor, a.handAnchor),
    });
  }
  return [...props, ...custom];
}

/** Library kinds that carry a 3D model: a lone prop, or a scene of layers. */
export function isLibrary3dKind(kind: string): boolean {
  return kind === '3d_attachment' || kind === 'composite';
}

/** Comparison key for "is this the same model?": case, spacing and punctuation ignored. */
export function modelNameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * The existing name a new model's name collides with, or null. Used to warn —
 * never to block: two different props may honestly share a name.
 */
export function existingModelNamed(name: string, existing: readonly string[]): string | null {
  const key = modelNameKey(name);
  if (key === '') return null;
  return existing.find((n) => modelNameKey(n) === key) ?? null;
}
