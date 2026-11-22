/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * designSkins — how a card design dresses the READING view, after its opening:
 * the shape of each photo's frame, the paper cut-outs tucked into the page
 * corners, and whether the page keeps the formal gold filigree.
 *
 * Colours come from the design's palette (lib/cardDesigns.ts); a skin only
 * adds the cut-outs' own paper colours, taken from the design's scene so the
 * page looks like a piece of it. Pure data: the card reads it through
 * components/cards/designSkin.tsx, and lib/designPacks.ts checks every design
 * has one.
 */
import type { CardDesignId } from './cardDesigns';

/** The photo's frame. All are border-radius shapes, so a shadow and ring follow them. */
export type PhotoShape = 'rounded' | 'arch' | 'oval' | 'blob' | 'deco';
export const PHOTO_SHAPES = ['rounded', 'arch', 'oval', 'blob', 'deco'] as const satisfies readonly PhotoShape[];

/** The cut-outs in the page corners. */
export type DecorKind =
  | 'wisteria'
  | 'balloons'
  | 'deco'
  | 'fans'
  | 'stars'
  | 'lanterns'
  | 'clouds'
  | 'laurel'
  | 'palms'
  | 'snow'
  | 'leaves'
  | 'roses'
  | 'marigolds'
  | 'crescent'
  | 'grasses';
export const DECOR_KINDS = [
  'wisteria',
  'balloons',
  'deco',
  'fans',
  'stars',
  'lanterns',
  'clouds',
  'laurel',
  'palms',
  'snow',
  'leaves',
  'roses',
  'marigolds',
  'crescent',
  'grasses',
] as const satisfies readonly DecorKind[];

export interface DesignSkin {
  photo: PhotoShape;
  decor: DecorKind;
  /** Keep the formal gold filigree frame (gala, graduation) or let the cut-outs carry the page. */
  filigree: boolean;
  /** The cut-outs' paper: main, second, a small bright touch. */
  colors: readonly [string, string, string];
}

export const DESIGN_SKINS: Record<CardDesignId, DesignSkin> = {
  'garden-gate': { photo: 'arch', decor: 'wisteria', filigree: false, colors: ['#B9A2E8', '#6E8B5A', '#FFE6B8'] },
  'balloon-bash': { photo: 'blob', decor: 'balloons', filigree: false, colors: ['#F07B6B', '#7C83D6', '#FFD36B'] },
  'gala-night': { photo: 'deco', decor: 'deco', filigree: true, colors: ['#E8C77A', '#F3D58C', '#FFFFFF'] },
  owambe: { photo: 'deco', decor: 'fans', filigree: true, colors: ['#F0B54A', '#3FBF9A', '#FF8A6B'] },
  'city-lights': { photo: 'rounded', decor: 'stars', filigree: false, colors: ['#FFD9A0', '#FFF2CF', '#FFC56B'] },
  'moon-gate': { photo: 'oval', decor: 'lanterns', filigree: false, colors: ['#FF6B4A', '#F2B65A', '#FFD08A'] },
  'cloud-nine': { photo: 'blob', decor: 'clouds', filigree: false, colors: ['#FFFFFF', '#FBE3EA', '#FFE3A8'] },
  'grand-hall': { photo: 'arch', decor: 'laurel', filigree: true, colors: ['#E3C27A', '#C9A35E', '#FFFFFF'] },
  'island-sunset': { photo: 'rounded', decor: 'palms', filigree: false, colors: ['#2E6B5A', '#3F8A6E', '#FFB38A'] },
  'love-notes': { photo: 'oval', decor: 'roses', filigree: false, colors: ['#E0566E', '#3D7058', '#F6B3C2'] },
  'festival-of-lights': { photo: 'arch', decor: 'marigolds', filigree: false, colors: ['#FF9F1C', '#FFC93C', '#E63973'] },
  'crescent-night': { photo: 'arch', decor: 'crescent', filigree: false, colors: ['#FFE9B0', '#D9B06A', '#7FD1C4'] },
  'golden-hour': { photo: 'rounded', decor: 'grasses', filigree: false, colors: ['#D9B25E', '#B58C3E', '#F7C6A3'] },
  'jungle-party': { photo: 'blob', decor: 'leaves', filigree: false, colors: ['#2C8C57', '#57B474', '#FF6B6B'] },
  'winter-glow': { photo: 'arch', decor: 'snow', filigree: false, colors: ['#FFFFFF', '#DCEBFF', '#FFE6B8'] },
};

export function designSkin(id: CardDesignId): DesignSkin {
  return DESIGN_SKINS[id];
}

/** CSS border-radius for each frame shape (on a 4:5 photo). */
export const PHOTO_SHAPE_RADIUS: Record<PhotoShape, string> = {
  rounded: '1.4rem',
  arch: '50% 50% 1.2rem 1.2rem / 38% 38% 1.2rem 1.2rem',
  oval: '50%',
  blob: '44% 56% 50% 50% / 38% 44% 56% 62%',
  deco: '0.5rem',
};
