/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Studio access — may this host open the creative Studio for this event?
 *
 * The Studio is an ADD-ON for teams and large organisations (the `studio`
 * feature flag, migration 039). The context defaults to `{ studio: true }` so
 * every mount that does not provide it — the three frozen legacy sites
 * (adminRoutes in App.tsx), /dev harnesses — renders exactly as before. Only
 * the platform studio (EventStudio) provides a resolved value.
 *
 * This is a sales gate, not a security boundary: the decision itself lives in
 * the pure `studioAllowed` (features.ts) and fails OPEN on every unknown.
 */
import { createContext, useContext } from 'react';
import { supabase } from '../../lib/supabase';
import { checkIsPlatformAdmin } from '../../lib/admin';
import { LEGACY_EVENT_IDS } from '../../events/runtime';
import { normalizeResolvedFeatures, studioAllowed, type FeatureSet } from '../../lib/features';

export interface StudioAccess {
  /** The Studio (and its Assets tab) is available to this viewer. */
  studio: boolean;
}

export const StudioAccessContext = createContext<StudioAccess>({ studio: true });

export function useStudioAccess(): StudioAccess {
  return useContext(StudioAccessContext);
}

export interface ResolvedStudioAccess {
  /** The resolver's answer, or null when the read failed (fail open). */
  features: FeatureSet | null;
  isPlatformAdmin: boolean;
  studio: boolean;
}

/**
 * Ask the DB resolver (`event_features(p_slug text) returns jsonb`, migration
 * 028 — anon/authenticated, self-authorizing on event_is_public OR
 * is_event_member) plus the platform-admin check, in parallel.
 *
 * HANDLED FAILURES: an RPC error or a non-object answer → `features: null`
 * (studio allowed); the admin check failing reads as "not an admin", which is
 * harmless because the features half already failed open or answered.
 */
export async function fetchStudioAccess(slug: string): Promise<ResolvedStudioAccess> {
  const [featRes, isPlatformAdmin] = await Promise.all([
    supabase.rpc('event_features', { p_slug: slug }).then(
      (r) => r,
      (e: unknown) => ({ data: null, error: e }),
    ),
    checkIsPlatformAdmin().catch(() => false),
  ]);
  let features: FeatureSet | null = null;
  if (featRes.error) {
    console.error('[studioAccess] event_features', featRes.error);
  } else if (featRes.data !== null && typeof featRes.data === 'object' && !Array.isArray(featRes.data)) {
    features = normalizeResolvedFeatures(featRes.data);
  }
  return {
    features,
    isPlatformAdmin,
    studio: studioAllowed({ features, isPlatformAdmin, legacySlug: LEGACY_EVENT_IDS.has(slug) }),
  };
}
