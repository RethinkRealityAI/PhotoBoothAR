/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useBeamyAssets — the homepage's asset slots: the bundled defaults, with the
 * admin's published overrides (/admin/home-assets) laid over them once they
 * load. First paint is always the bundled set; a failed fetch keeps it.
 */
import { useMemo } from 'react';
import { HOME_ASSET_DEFAULTS, type HomeAssets } from '../../lib/beamyAssets';
import { mergeHomeAssets } from '../../lib/beamyAssetsMerge';
import { useHomeAssets } from '../../lib/landingContentClient';

export function useBeamyAssets(): HomeAssets {
  const overrides = useHomeAssets();
  return useMemo(() => mergeHomeAssets(HOME_ASSET_DEFAULTS, overrides), [overrides]);
}
