/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * I/O half of the platform landing-page CMS: the one anonymous read.
 *
 * Kept separate from landingContent.ts ON PURPOSE — that module is pure so its
 * test can run in vitest's node env; this one imports src/lib/supabase.ts,
 * whose createClient throws without env vars, so NO test file may import this
 * module (see the repo test trap in docs/STATE.md).
 */
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { normalizeLandingContent, type LandingContent } from './landingContent';
import { EMPTY_HOME_ASSETS, type HomeAssets } from './homeAssets';

/**
 * The published landing content, normalized — or the bundled defaults on ANY
 * failure. Never throws, never returns null: the marketing page renders its
 * defaults instantly and this only ever swaps validated overrides in.
 */
export async function fetchLandingContent(): Promise<LandingContent> {
  try {
    const { data, error } = await supabase.rpc('get_landing_content');
    if (error !== null) {
      console.error('[landingContent] get_landing_content', error);
      return normalizeLandingContent(undefined);
    }
    return normalizeLandingContent(data);
  } catch (e) {
    console.error('[landingContent] get_landing_content', e);
    return normalizeLandingContent(undefined);
  }
}

/** One shared in-flight read per page load: several sections may call the hook. */
let homeAssetsPromise: Promise<HomeAssets> | null = null;

/**
 * The published homepage ASSET overrides (/admin/home-assets). Starts as
 * EMPTY_HOME_ASSETS (= every slot uses the page's bundled default, so first
 * paint never waits on the network) and swaps in the published overrides once
 * they arrive. Never throws: any failure leaves the defaults in place.
 */
export function useHomeAssets(): HomeAssets {
  const [assets, setAssets] = useState<HomeAssets>(EMPTY_HOME_ASSETS);
  useEffect(() => {
    let live = true;
    homeAssetsPromise ??= fetchLandingContent().then((c) => c.home);
    void homeAssetsPromise.then((a) => {
      if (live) setAssets(a);
    });
    return () => {
      live = false;
    };
  }, []);
  return assets;
}
