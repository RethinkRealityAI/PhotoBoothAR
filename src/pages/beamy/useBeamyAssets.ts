/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useBeamyAssets — the homepage's asset slots: the bundled defaults (lib/
 * beamyAssets HOME_ASSET_DEFAULTS), with the owner's published overrides
 * (/admin/home-assets) laid over them once they load (lib/beamyAssetsMerge).
 * First paint is always the bundled set; a failed read keeps it. Every
 * section can call it: they share one read and one merged snapshot.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { HOME_ASSET_DEFAULTS } from '../../lib/beamyAssets';
import { mergeHomeAssets, type MergedHomeAssets } from '../../lib/beamyAssetsMerge';
import { getHomeOverrides, subscribeHomeOverrides } from '../../lib/landingContentClient';

export function useBeamyAssets(): MergedHomeAssets {
  const overrides = useSyncExternalStore(subscribeHomeOverrides, getHomeOverrides);
  return useMemo(() => mergeHomeAssets(HOME_ASSET_DEFAULTS, overrides), [overrides]);
}
