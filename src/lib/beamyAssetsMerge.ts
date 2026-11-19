/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * beamyAssetsMerge — lays the admin's homepage overrides (landing_content.home,
 * edited at /admin/home-assets) over the homepage's bundled defaults
 * (beamyAssets HOME_ASSET_DEFAULTS). Pure, DOM-free, tested in node.
 *
 * Override-only: an empty slot keeps the bundled default, so a fresh CMS (or
 * a failed fetch, which yields EMPTY_HOME_ASSETS) renders the page unchanged.
 * The override is already normalized (every url passed the asset gate).
 */
import { DEFAULT_FIT_BY_CATEGORY, type HomeAssets as BeamyAssets, type HomeLook as BeamyLookSlot } from './beamyAssets';
import { WALL_MIN_PHOTOS, type HomeAssets as HomeOverrides, type HomeLook as OverrideLook } from './homeAssets';

/** An override look in the page's shape. A frame with no window of its own
 *  borrows the measured window of a default frame with the same file. */
function toPageLook(l: OverrideLook, defaults: readonly BeamyLookSlot[]): BeamyLookSlot {
  const opening = l.opening ?? (l.category === 'frame' ? defaults.find((d) => d.url === l.url && d.opening !== undefined)?.opening : undefined);
  return {
    id: l.id,
    name: l.name,
    category: l.category,
    url: l.url,
    ...(l.thumb === undefined ? {} : { thumb: l.thumb }),
    ...(l.line === undefined ? {} : { line: l.line }),
    ...(l.category === 'prop' ? { fit: l.fit ?? DEFAULT_FIT_BY_CATEGORY.prop } : {}),
    ...(opening === undefined ? {} : { opening }),
  };
}

export function mergeHomeAssets(d: BeamyAssets, o: HomeOverrides): BeamyAssets {
  const allDefaults = [...d.heroLooks, ...d.arLooks];
  const looks = (over: readonly OverrideLook[], base: BeamyLookSlot[]) =>
    over.length > 0 ? over.map((l) => toPageLook(l, allDefaults)) : base;
  const films = { ...d.films };
  for (const id of Object.keys(films) as (keyof typeof films)[]) {
    const f = o.films[id];
    if (f !== undefined) films[id] = { ...films[id], ...f };
  }
  const keepsake = o.keepsakePhotos.length > 0 ? o.keepsakePhotos : d.keepsakePhotos;
  return {
    films,
    heroLooks: looks(o.heroLooks, d.heroLooks),
    arLooks: looks(o.arLooks, d.arLooks),
    sceneProps: d.sceneProps.map((u, i) => o.sceneProps[i] ?? u),
    wallPhotos: o.wallPhotos.length >= WALL_MIN_PHOTOS ? o.wallPhotos : d.wallPhotos,
    ...((o.challengePhoto ?? d.challengePhoto) === undefined ? {} : { challengePhoto: o.challengePhoto ?? d.challengePhoto }),
    ...((o.demoEventSlug ?? d.demoEventSlug) === undefined ? {} : { demoEventSlug: o.demoEventSlug ?? d.demoEventSlug }),
    ...(keepsake === undefined ? {} : { keepsakePhotos: keepsake }),
  };
}
