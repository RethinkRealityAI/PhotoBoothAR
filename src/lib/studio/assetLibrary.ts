/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CONFIGURABLE ASSET LIBRARY — the curated shelf of base models a host can pick
 * up and personalise (per-region colour, per-region finish, an engraved name).
 *
 * Pure data plus pure selectors, following ./starterScenes.ts: no React, no
 * network, no three, so vitest exercises the whole catalogue including every
 * descriptor it ships.
 *
 * ── What is actually IN here, stated plainly ──────────────────────────────
 *
 * `LIBRARY_ASSETS` is EMPTY, and that is a truthful state rather than an
 * oversight. A configurable asset is a GLB **plus** an authored descriptor, and
 * this repository contains exactly one GLB: `public/models/reference-head.glb`,
 * which is the studio's fit-reference bust. A head is not a wearable, so it does
 * not belong on a shelf a host shops from — putting it there to make the
 * catalogue look populated would be the same lie as a fake testimonial.
 *
 * `DEMO_LIBRARY_ASSETS` therefore carries that bust as a single, clearly-marked
 * DEV-only entry. It exists so the whole path — pick, recolour, engrave, render
 * through the real booth renderers — can be driven and screenshotted against a
 * genuine 30k-triangle mesh in development. `libraryAssets()` never returns it
 * outside DEV, so a host's library is empty until the owner adds real content.
 *
 * ── What the owner has to supply ──────────────────────────────────────────
 * See LIBRARY_ASSET_CHECKLIST. Short version: a GLB in `public/models/` (or the
 * assets bucket) and a descriptor produced by `/dev/asset-prep`.
 *
 * ── Generic by mandate ────────────────────────────────────────────────────
 * Owner, verbatim: "make sure we remove all the hard-coded templates, like the
 * SCAGO gala or any that have specific branding for any of the legacy events.
 * We're just on generic frames and assets that will be part of the template
 * library that all users will have access to." The colocated test enforces this
 * against a deny-list of legacy tokens, exactly as starterScenes.test.ts
 * enforces it against `BuiltinBorder.legacy` — so branded content cannot arrive
 * here by a later edit either.
 */
import { normalizeTemplate, type AssetTemplate } from './assetTemplate';

/** One shelf entry: a model, its descriptor, and how it reads in the grid. */
export interface ConfigurableAsset {
  id: string;
  name: string;
  /** One line the host reads on the tile — what this is, not how it works. */
  blurb: string;
  /** Two colours for the tile, so it reads at thumbnail size with no image. */
  swatch: [string, string];
  /**
   * The configurator descriptor, as raw data. Deliberately NOT pre-validated:
   * every consumer runs it through `normalizeTemplate`, which is the one place
   * an untrusted descriptor becomes a render spec, and a catalogue that bypassed
   * it would be the one source of templates nobody checked.
   */
  template: unknown;
  /**
   * DEV-only demo content. `libraryAssets()` filters these out of any production
   * build; nothing else in the app reads the flag.
   */
  demo?: boolean;
}

/**
 * Real-world size of the reference bust along its longest local axis.
 *
 * Measured: the GLB's POSITION accessor spans 1.0835 x 1.5262 x 1.9106 local
 * units, so it is a normalised export and its real size has to be stated rather
 * than read (assetPrep.proposeFitCm returns `confident: true` with exactly that
 * reasoning). 24cm is a human head plus the bust's shoulder base.
 */
const BUST_FIT_CM = 24;

/**
 * The bust is exported with NO materials and NO textures, so three applies the
 * glTF default: an untextured white MeshStandardMaterial whose `diffuseColor`
 * IS its base colour, at a linear luminance of exactly 1.
 *
 * That number is `refLuminance`, and getting it wrong is not cosmetic. It is the
 * DIVISOR: leave it at the 0.18 mid-grey default and every texel divides 1 by
 * 0.18, pegs at MAX_TINT_RATIO and the whole piece renders as a blown-out slab
 * of the requested hue. (FaceRig's `applyRegionTint` carries the same warning
 * from the other side.)
 */
const BUST_REF_LUMINANCE = 1;

/**
 * The DEV-only demo entry.
 *
 * ONE region, no `regionIds`. That is not a simplification — it is the shape a
 * real generated asset actually has. Meshy's remesher emits one watertight
 * manifold (measured: `connectedComponents` on this exact file returns 1), so
 * "the whole piece is region 0" is the honest descriptor for it, and FaceRig
 * supports it explicitly: with no per-vertex attribute every fragment reads
 * region 0 and still gets the bake preserved as relative shading. Multi-region
 * descriptors are authored in `/dev/asset-prep`, which is where the human
 * painting that produces them happens.
 *
 * ── The trap in the numbers below, which cost a wrong first draft ─────────
 * The GLB's single node carries `rotation: [0.7071, 0, 0, 0.7071]` — a +90
 * degree turn about X — so the MESH data is Z-up while the SCENE is Y-up. Every
 * value here is in the MESH's own space, because that is the space
 * `AssetTextSlot.position` lives in: `assetDecal.attachLabelDecal` targets
 * `largestMesh(root)` and `withRestPose` identities that mesh's world matrix
 * before carving, so the node's rotation is not in play.
 *
 * In that space, measured from the POSITION accessor rather than assumed:
 *   · +Y is the FRONT   — the front-most vertex is the nose, at (0, 0.762, −0.07)
 *   · −Z is UP          — the top-most world vertex is the crown, at local z −0.44
 * A bounding box cannot tell you either of those. `frontAxis: [0, 0, 1]` looks
 * like the obvious answer and would have engraved the name on the top of the head.
 *
 * `preparedBy: 'human'` is therefore earned: the axes and the slot were derived
 * from the file's own vertices and confirmed in the running prep tool.
 */
const REFERENCE_BUST_TEMPLATE = {
  id: 'demo-reference-bust',
  name: 'Reference bust',
  glbUrl: '/models/reference-head.glb',
  fitCm: BUST_FIT_CM,
  // Mesh-local +Y. See the docblock: this is NOT [0,0,1].
  frontAxis: [0, 1, 0],
  regions: [
    {
      id: 'surface',
      label: 'Whole piece',
      recolourable: true,
      defaultHex: '#d8d2c8',
      refLuminance: BUST_REF_LUMINANCE,
    },
  ],
  textSlots: [
    {
      id: 'front',
      label: 'Forehead',
      // Probed against the real vertices, not the bounding box: at world-up
      // +0.25 (local z −0.25) the front-most vertex within 6cm of the centre
      // line sits at local y 0.610 — the flat of the forehead above the brow.
      // The bounding-box front (y 0.763) is the NOSE TIP, and a decal projected
      // onto that curve shears (assetDecal note 3).
      position: [0, 0.6, -0.25],
      normal: [0, 1, 0],
      up: [0, 0, -1],
      // 6cm at the bust's 24cm fit is 0.48 model units — inside the ~0.8-unit
      // width of the forehead, so the name does not wrap onto the temples.
      maxWidthCm: 6,
      // 12% of the 1.526-unit FRONT-TO-BACK depth (assetPrep.proposeDecalDepth
      // along the projection axis) — deep enough to reach the surface, shallow
      // enough not to engrave the back of the skull too.
      decalDepth: 0.18,
    },
  ],
  preparedBy: 'human',
} as const;

/**
 * The shipped, host-facing shelf.
 *
 * EMPTY on purpose — see this module's docblock. Add entries here, never to
 * DEMO_LIBRARY_ASSETS.
 */
export const LIBRARY_ASSETS: ConfigurableAsset[] = [];

/** DEV-only. Never returned by `libraryAssets()` in a production build. */
export const DEMO_LIBRARY_ASSETS: ConfigurableAsset[] = [
  {
    id: 'demo-reference-bust',
    name: 'Reference bust (demo)',
    blurb: 'The studio fit reference, wired up as a configurable asset so the colour and engraving controls can be driven end to end.',
    swatch: ['#d8d2c8', '#4a463f'],
    template: REFERENCE_BUST_TEMPLATE,
    demo: true,
  },
];

/**
 * The shelf, for a given build.
 *
 * `includeDemo` is the caller's `import.meta.env.DEV`, passed IN rather than
 * read here: this module is pure data, a test must be able to ask for both
 * answers, and `import.meta.env` is exactly the kind of ambient global that
 * makes a pure module untestable.
 */
export function libraryAssets(includeDemo = false): ConfigurableAsset[] {
  const shipped = LIBRARY_ASSETS.filter((a) => !a.demo);
  return includeDemo ? [...shipped, ...DEMO_LIBRARY_ASSETS] : shipped;
}

/** An entry's descriptor, validated. Null = the entry is not configurable. */
export function assetTemplateOf(asset: ConfigurableAsset): AssetTemplate | null {
  return normalizeTemplate(asset.template);
}

export function findLibraryAsset(id: string, includeDemo = false): ConfigurableAsset | null {
  return libraryAssets(includeDemo).find((a) => a.id === id) ?? null;
}

/**
 * What an entry needs before it can go in `LIBRARY_ASSETS` — shown verbatim in
 * the dock's empty state, because a host looking at an empty shelf deserves to
 * know it is empty by design and what would fill it.
 */
export const LIBRARY_ASSET_CHECKLIST: readonly string[] = [
  'A .glb of the piece itself — one mesh, ideally 20-40k triangles, in public/models/ or the event assets bucket.',
  'A descriptor from /dev/asset-prep: real-world size, which way it faces, which parts recolour, and where a name is engraved.',
  'A reference luminance measured from the asset\'s own bake — without it a recoloured part renders blown out.',
];

/** The one-line empty state, so the dock and any future surface agree. */
export const LIBRARY_EMPTY_MESSAGE =
  'No configurable models yet. These are base pieces a guest can have in their own colours, with their own name on them.';
