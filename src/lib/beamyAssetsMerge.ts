/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * beamyAssetsMerge — lays the owner's published homepage overrides
 * (landing_content.home, edited at /admin/home-assets; lib/homeAssets) over
 * the homepage's bundled defaults (lib/beamyAssets HOME_ASSET_DEFAULTS).
 * Pure, DOM-free, tested in node.
 *
 * This is how the page READS its slots; the bundled rows themselves are
 * untouched. Override-only: an empty slot keeps the bundled one, so a fresh
 * CMS, or a failed fetch (EMPTY_HOME_OVERRIDES), renders the page exactly as
 * shipped. The overrides are already normalized (every url passed the gate).
 */
import { DEFAULT_FIT_BY_CATEGORY, type HomeAssets, type HomeLook } from './beamyAssets';
import { KEEPSAKE_MIN_PHOTOS, WALL_MIN_PHOTOS, type HomeOverrides } from './homeAssets';

/** The page's slots after the overrides: its own shape, plus step 6's card photos (empty = the bundled picks). */
export type MergedHomeAssets = HomeAssets & { virtualPhotos: string[] };

/**
 * An override look as the page wears it. A frame with no window of its own
 * borrows the measured window of a bundled frame with the same file (else the
 * page uses its typical window); a prop with no fit gets its category default.
 */
function toPageLook(l: HomeLook, defaults: readonly HomeLook[]): HomeLook {
  if (l.category === 'frame' && l.opening === undefined) {
    const opening = defaults.find((d) => d.category === 'frame' && d.url === l.url && d.opening !== undefined)?.opening;
    if (opening !== undefined) return { ...l, opening };
  }
  if (l.category === 'prop' && l.fit === undefined) return { ...l, fit: DEFAULT_FIT_BY_CATEGORY.prop };
  return l;
}

export function mergeHomeAssets(d: HomeAssets, o: HomeOverrides): MergedHomeAssets {
  const all = [...d.heroLooks, ...d.arLooks];
  const looks = (over: readonly HomeLook[], base: HomeLook[]) => (over.length > 0 ? over.map((l) => toPageLook(l, all)) : base);
  const challengePhoto = o.challengePhoto ?? d.challengePhoto;
  const demoEventSlug = o.demoEventSlug ?? d.demoEventSlug;
  const keepsakePhotos = o.keepsakePhotos.length >= KEEPSAKE_MIN_PHOTOS ? o.keepsakePhotos : d.keepsakePhotos;
  return {
    films: d.films,
    heroLooks: looks(o.heroLooks, d.heroLooks),
    arLooks: looks(o.arLooks, d.arLooks),
    // By index: a spot the override leaves blank keeps the page's prop.
    sceneProps: d.sceneProps.map((u, i) => (o.sceneProps[i] !== undefined && o.sceneProps[i] !== '' ? o.sceneProps[i] : u)),
    wallPhotos: o.wallPhotos.length >= WALL_MIN_PHOTOS ? o.wallPhotos : d.wallPhotos,
    ...(challengePhoto === undefined ? {} : { challengePhoto }),
    ...(demoEventSlug === undefined ? {} : { demoEventSlug }),
    ...(keepsakePhotos === undefined ? {} : { keepsakePhotos }),
    virtualPhotos: o.virtualPhotos,
  };
}
