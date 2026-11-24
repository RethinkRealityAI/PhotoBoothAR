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
  /**
   * Wraps around (or sits behind the front of) the head, so it needs the head
   * occluder to hide the parts the guest's own head would block. Opt-in, like
   * HeadPieceDef.occlude, because a piece that rests ON the face would be
   * clipped by it.
   */
  occlude?: true;
  /** Shelf grouping for seasonal sets (e.g. 'christmas'); absent = evergreen. */
  collection?: 'christmas';
  /**
   * Below the quality bar for anything a host or prospect is OFFERED (2026-11-23
   * showcase cleanup: thin wire tiara, plain ring, neon shutter shades). Kept in
   * this list so every saved scene and live event that already uses it still
   * renders; only the pick-lists (offeredBundledProps) and showcases drop it.
   */
  retired?: true;
}

export const BUNDLED_PROPS: readonly BundledProp[] = [
  {
    id: 'prop-royal-crown',
    name: 'Royal Crown',
    url: '/models/props/royal-crown.glb',
    thumb: '/models/props/royal-crown.webp',
    anchor: 'crown',
    finish: 'gold',
    // 6.8 (was 5.5): at 5.5 it read as a child's crown on a phone — about 10cm
    // across against a ~15cm head. The model is centred, so growing it drops
    // its base; y +0.7 keeps the base on the hairline where it sat before.
    offset: [0, 2.7, -0.6],
    rotation: [0, 0, 0],
    scale: 6.8,
    supersedes: 'royal-crown',
    // Its back band sits behind the head: without the occluder the far inside
    // of the crown shows through the forehead (seen on the /try demo).
    occlude: true,
  },
  {
    id: 'prop-queens-tiara',
    retired: true,
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
    retired: true,
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
    retired: true,
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
  /* — CHRISTMAS COLLECTION (2026-11-17). Meshy text-to-3D with PBR textures,
     then optimized (meshopt geometry, 1024px WebP textures, 0.07-1.5MB each)
     and BAKED AT 3x so the authored scales sit in the same 1-8 band as the
     four props above (the raw meshes are ~1.9 units across). Two exceptions:
     elf-ears is a mirrored PAIR baked in head-space centimetres (scale 1, one
     object instead of two left/right copies that could drift apart), and
     rudolph-nose is a procedural glossy sphere (radius 1). `finish:
     'original'` keeps each bake — the colours ARE the asset. */
  {
    id: 'prop-santa-hat',
    name: 'Santa Hat',
    url: '/models/props/santa-hat.glb',
    thumb: '/models/props/santa-hat.webp',
    anchor: 'crown',
    finish: 'original',
    offset: [0, 3.8, -4],
    rotation: [0.12, 0, 0],
    scale: 2.8,
    occlude: true,
    collection: 'christmas',
  },
  {
    id: 'prop-santa-beard',
    name: 'Santa Beard',
    url: '/models/props/santa-beard.glb',
    thumb: '/models/props/santa-beard.webp',
    anchor: 'chin',
    finish: 'original',
    offset: [0, -0.2, 1.8],
    rotation: [0, 0, 0],
    scale: 3.4,
    collection: 'christmas',
  },
  {
    id: 'prop-elf-hat',
    name: 'Elf Hat',
    url: '/models/props/elf-hat.glb',
    thumb: '/models/props/elf-hat.webp',
    anchor: 'crown',
    finish: 'original',
    offset: [0, 8, -5],
    rotation: [-0.12, 0, 0],
    scale: 4.6,
    occlude: true,
    collection: 'christmas',
  },
  {
    id: 'prop-elf-ears',
    name: 'Elf Ears',
    url: '/models/props/elf-ears.glb',
    thumb: '/models/props/elf-ears.webp',
    anchor: 'noseBridge',
    finish: 'original',
    offset: [0, 0.5, -7.3],
    rotation: [0, 0, 0],
    scale: 1,
    occlude: true,
    collection: 'christmas',
  },
  {
    id: 'prop-reindeer-antlers',
    name: 'Reindeer Antlers',
    url: '/models/props/reindeer-antlers.glb',
    thumb: '/models/props/reindeer-antlers.webp',
    anchor: 'crown',
    finish: 'original',
    offset: [0, 7.5, -4.5],
    rotation: [0, 0, 0],
    scale: 4.6,
    occlude: true,
    collection: 'christmas',
  },
  {
    id: 'prop-rudolph-nose',
    name: 'Rudolph Nose',
    url: '/models/props/rudolph-nose.glb',
    thumb: '/models/props/rudolph-nose.webp',
    anchor: 'noseTip',
    finish: 'original',
    offset: [0, 0.2, 0.6],
    rotation: [0, 0, 0],
    scale: 2,
    collection: 'christmas',
  },
  {
    id: 'prop-holly-crown',
    name: 'Holly Crown',
    url: '/models/props/holly-crown.glb',
    thumb: '/models/props/holly-crown.webp',
    anchor: 'crown',
    finish: 'original',
    offset: [0, 2, -5],
    rotation: [-1.35, 0, 0],
    scale: 4.2,
    occlude: true,
    collection: 'christmas',
  },
  {
    id: 'prop-snowflake-tiara',
    name: 'Snowflake Tiara',
    url: '/models/props/snowflake-tiara.glb',
    thumb: '/models/props/snowflake-tiara.webp',
    anchor: 'forehead',
    finish: 'original',
    offset: [0, 3.5, -5.4],
    rotation: [-0.3, 0, 0],
    scale: 2.9,
    occlude: true,
    collection: 'christmas',
  },
  {
    id: 'prop-tree-hat',
    name: 'Christmas Tree Hat',
    url: '/models/props/tree-hat.glb',
    thumb: '/models/props/tree-hat.webp',
    anchor: 'crown',
    finish: 'original',
    offset: [0, 11, -5.5],
    rotation: [-0.15, 0, 0],
    scale: 4.5,
    occlude: true,
    collection: 'christmas',
  },
];

export const BUNDLED_PROP_MAP: Record<string, BundledProp> = Object.fromEntries(
  BUNDLED_PROPS.map((p) => [p.id, p]),
);

/** The props a host may pick: everything except the retired ones. */
export function offeredBundledProps(): BundledProp[] {
  return BUNDLED_PROPS.filter((p) => p.retired !== true);
}

/** True for a prop that still renders but is no longer offered anywhere. */
export function isRetiredProp(id: string): boolean {
  return BUNDLED_PROP_MAP[id]?.retired === true;
}

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
