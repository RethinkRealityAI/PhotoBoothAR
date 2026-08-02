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
import { supabase } from './supabase';
import { normalizeLandingContent, type LandingContent } from './landingContent';

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
