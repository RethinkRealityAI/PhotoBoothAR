/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * openingLook — the ONE answer to "which look does the booth open with?".
 *
 * The opening look lives in two stores: `app_settings` 'wall'
 * (`defaultExperienceId`, by slug — the only store a frozen legacy site can
 * write) and `events.config.defaultExperienceId` (by uuid — platform events).
 * The booth reads `wall ?? config` (Booth.tsx), so a writer that touched only
 * ONE store could be silently overruled by the other: the copilot pinned a 3D
 * prop (both stores), then "Use as booth frame" wrote only config, and the
 * booth kept opening on the prop while the Library said the frame opened first.
 *
 * Now every writer goes through host.setOpeningLook, which writes the SAME id
 * to every store the event has (this module decides which), and every reader
 * (booth, Library, LooksPicker, Settings) resolves through
 * effectiveOpeningLookId — so what a host is told and what a guest sees are
 * the same expression. PURE: no React, no supabase.
 */

/** A store that holds the opening look. */
export type OpeningLookStore = 'config' | 'wall';

/** Where an event's opening look is written. `eventUuid` null = a coded
 *  (legacy) event with no events row — wall only, exactly as before. */
export interface OpeningLookTarget {
  slug: string;
  eventUuid: string | null;
}

/** What a write did. A failure names the store that refused, so the host is
 *  told instead of a half-applied pin passing as saved. Flat, not a
 *  discriminated union: tsconfig is not `strict`, so `ok` would not narrow.
 *  Invariant: `ok === (failed === null)`. */
export interface OpeningLookResult {
  ok: boolean;
  failed: OpeningLookStore | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * The look the booth opens with — `route ?? wall ?? config` — with the exact
 * `??` semantics Booth.tsx has always used (a non-string reads as absent; a
 * string, even '', wins over the store below it).
 */
export function effectiveOpeningLookId(wallId: unknown, configId: unknown, routeId?: unknown): string | null {
  return str(routeId) ?? str(wallId) ?? str(configId) ?? null;
}

/**
 * The stores a write must touch, in write order. config first: it is the one
 * that may carry a larger patch (a looks save), and if it refuses nothing has
 * changed yet. The wall last, because it is the store the booth prefers.
 */
export function openingLookStores(target: OpeningLookTarget): OpeningLookStore[] {
  return typeof target.eventUuid === 'string' && target.eventUuid !== '' ? ['config', 'wall'] : ['wall'];
}

/** Host copy for a write that did not fully land. Both writes are idempotent,
 *  so "try again" converges. */
export function openingLookErrorCopy(failed: OpeningLookStore | null): string {
  if (failed === null) return 'Couldn’t save. Check your connection and try again.';
  return failed === 'config'
    ? 'Couldn’t change the look the booth opens with — nothing was changed. Check your connection and try again.'
    : 'Couldn’t finish changing the look the booth opens with — the booth may still open with the old one. Try again.';
}
