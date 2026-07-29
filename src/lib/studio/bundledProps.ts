/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BUNDLED 3D PROPS — the head pieces that ship as real GLB files.
 *
 * Each one is the Meshy image-to-3D of the product shot isolated out of a
 * starter scene's own preview image, so the prop on the card is the prop the
 * guest wears. Three of the four are deliberately UNTEXTURED (0 materials,
 * 216-542KB) and take their look from `finish.ts`: the textured PBR bakes of
 * the same meshes were 5.9-11.2MB, which is not something to hand a guest on
 * venue wifi.
 *
 * ONE list, TWO consumers. `starterScenes.ts` references these by id and the
 * studio library renders them as tiles, so a prop can never be offered in one
 * place and missing from the other — which is exactly what went wrong first
 * time round: the new crown existed only inside three starter scenes, so a host
 * who added "Royal Crown" from the library still got the old procedural mesh.
 *
 * The procedural HEAD_PIECES stay in the render path: they are instant, need no
 * network, and every legacy coded event and already-saved experience resolves
 * them by `proceduralId`. They are only hidden from the shelf where a bundled
 * prop supersedes them (see `supersedes`).
 *
 * Pure data + pure selectors. No React, no DOM, no network.
 */
import type { HeadAnchor } from '../../types';

export interface BundledProp {
  id: string;
  name: string;
  /** App-absolute path under public/ — never a third-party CDN (a GLB on the
   *  booth's critical path is the face_landmarker mistake; see CLAUDE.md). */
  url: string;
  /** Square preview for the library tile. */
  thumb: string;
  anchor: HeadAnchor;
  /** finish.ts id. The untextured meshes carry no material of their own. */
  finish: string;
  /**
   * Head-space centimetres, like HEAD_PIECES config.
   *
   * `scale` is TUNED AGAINST THE REAL RIG, not derived: computePropFitScale
   * would author 12.64 for a 1.9-unit bbox (PROP_TARGET_CM / maxDim) and at
   * that value the crown covers the whole face. Auto-fit never re-runs on load
   * (draftMapping copies anchorConfig verbatim), so these values are what the
   * booth uses, and they were set by eye against a tracked face.
   */
  offset: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  /**
   * The procedural HEAD_PIECES id this prop replaces IN THE LIBRARY.
   *
   * Without this the dock listed two tiles called "Royal Crown" — the new GLB
   * and the old procedural mesh — with nothing to tell them apart, which is the
   * confusion that got reported. Hiding is shelf-only: the procedural piece
   * still renders wherever an existing scene references it.
   */
  supersedes?: string;
}

export const BUNDLED_PROPS: readonly BundledProp[] = [
  {
    id: 'prop-royal-crown',
    name: 'Royal Crown',
    url: '/models/props/royal-crown.glb',
    thumb: '/models/props/royal-crown.webp',
    anchor: 'crown',
    finish: 'gold',
    offset: [0, 2, -0.6],
    rotation: [0, 0, 0],
    scale: 5.5,
    supersedes: 'royal-crown',
  },
  {
    id: 'prop-queens-tiara',
    name: "Queen's Tiara",
    url: '/models/props/queens-tiara.glb',
    thumb: '/models/props/queens-tiara.webp',
    anchor: 'forehead',
    finish: 'gold',
    offset: [0, 1.6, 0.4],
    rotation: [0, 0, 0],
    scale: 4.5,
    supersedes: 'queen-tiara',
  },
  {
    id: 'prop-halo-ring',
    name: 'Halo Ring',
    url: '/models/props/halo-ring.glb',
    thumb: '/models/props/halo-ring.webp',
    anchor: 'crown',
    finish: 'gold',
    offset: [0, 6, -1],
    rotation: [0, 0, 0],
    scale: 6,
    supersedes: 'hope-halo',
  },
  {
    id: 'prop-neon-shades',
    name: 'Neon Shades',
    url: '/models/props/neon-shades.glb',
    thumb: '/models/props/neon-shades.webp',
    anchor: 'noseBridge',
    // The only TEXTURED prop, and the only one that must be: magenta-and-cyan
    // IS the asset's identity, and a finish paints one colour over a whole
    // mesh. `original` keeps the bake exactly as exported.
    finish: 'original',
    offset: [0, 1.4, 1.6],
    rotation: [0, 0, 0],
    scale: 4.2,
    supersedes: 'neon-shades',
  },
];

export const BUNDLED_PROP_MAP: Record<string, BundledProp> = Object.fromEntries(
  BUNDLED_PROPS.map((p) => [p.id, p]),
);

/** Every bundled prop GLB, for cache warming. */
export function bundledPropUrls(): string[] {
  return Array.from(new Set(BUNDLED_PROPS.map((p) => p.url)));
}

/** Procedural head-piece ids a bundled prop replaces on the library shelf. */
export function supersededPieceIds(): Set<string> {
  return new Set(BUNDLED_PROPS.flatMap((p) => (p.supersedes ? [p.supersedes] : [])));
}

/**
 * The prop's placement in the shape `createObject3D`'s `anchorConfig` wants,
 * so neither consumer has to restate the axis order.
 */
export function propAnchorConfig(p: BundledProp): {
  offset: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: number;
} {
  return {
    offset: { x: p.offset[0], y: p.offset[1], z: p.offset[2] },
    rotation: { x: p.rotation[0], y: p.rotation[1], z: p.rotation[2] },
    scale: p.scale,
  };
}
