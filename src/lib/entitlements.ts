/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useEntitlements — entitlements resolved for the event currently in context.
 *
 * The plan table, tier helpers and copy formatters live in ./plans (pure, no
 * React or Supabase imports) and are re-exported here, so every existing
 * `from './entitlements'` import keeps working unchanged.
 */
import { useEffect, useState } from 'react';
import { useEvent } from '../events/EventContext';
import { eventOrgHasActivePro } from './host';
import { ENTITLEMENTS, LEGACY_ENTITLEMENTS, entitlementsFor, normalizeTier, type Entitlements } from './plans';

export {
  ENTITLEMENTS,
  LEGACY_ENTITLEMENTS,
  entitlementsFor,
  normalizeTier,
  formatPostCap,
  formatRetention,
} from './plans';
export type { Entitlements, PlanTier } from './plans';

/**
 * Entitlements for the current event (must render inside <EventProvider>).
 *
 * - Coded/legacy events (source === 'code') → LEGACY_ENTITLEMENTS: watermark
 *   always on, nothing gated. This covers all VITE_EVENT builds.
 * - DB events → events.plan_tier, upgraded by THIS EVENT's org's active Pro
 *   subscription (scoped to the event's org, not the viewer's own). RLS only
 *   exposes subscriptions to signed-in members of that org, so anonymous
 *   guests and members of other orgs resolve false — the Pro floor never
 *   leaks onto a foreign event (helper caches per event-uuid).
 */
export function useEntitlements(): Entitlements {
  const { planTier, source, eventUuid } = useEvent();
  const [hasPro, setHasPro] = useState(false);

  useEffect(() => {
    if (source === 'code' || !eventUuid) return;
    let alive = true;
    eventOrgHasActivePro(eventUuid).then((v) => { if (alive) setHasPro(v); });
    return () => { alive = false; };
  }, [source, eventUuid]);

  if (source === 'code') return LEGACY_ENTITLEMENTS;
  return entitlementsFor(normalizeTier(planTier), hasPro);
}
