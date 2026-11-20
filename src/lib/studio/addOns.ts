/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Power-Ups — the studio's self-contained mini-app builders. Each entry is a
 * full-screen modal (lazy-loaded by AssetsDock's ADDON_VIEWS map) that guides
 * the host through one rich creation and then writes ordinary objects/triggers
 * back into the scene, so PropertiesDock needs zero special cases.
 *
 * React-free registry (icons are lucide NAMES resolved in the dock), same
 * contract idiom as assetLibrary.ts, so the node suite can assert it.
 */

export interface AddOnDef {
  id: 'power-fx' | 'name-jewelry' | 'face-paint' | 'contacts';
  name: string;
  blurb: string;
  /** lucide-react icon name, resolved by the dock. */
  icon: string;
  swatch: [string, string];
}

export const ADD_ONS: readonly AddOnDef[] = [
  {
    id: 'power-fx',
    name: 'Power FX',
    blurb: 'Visor, wand or gauntlet — gesture-fired energy blasts',
    icon: 'Zap',
    swatch: ['#ff2b4a', '#18ffff'],
  },
  {
    id: 'name-jewelry',
    name: '3D Name Jewelry',
    blurb: 'A necklace, earrings or floating text built from a name',
    icon: 'Gem',
    swatch: ['#d4a017', '#e8e2d6'],
  },
  {
    id: 'face-paint',
    name: 'Face Paint',
    blurb: 'Living paint that moves with every smile — or your logo on a cheek',
    icon: 'Palette',
    swatch: ['#f2851f', '#e0409a'],
  },
  {
    id: 'contacts',
    name: 'Coloured Contacts',
    blurb: 'Lenses that follow every glance — natural tints, cat eyes, hearts or a glow',
    icon: 'Eye',
    swatch: ['#3f7fd0', '#18b08a'],
  },
];
