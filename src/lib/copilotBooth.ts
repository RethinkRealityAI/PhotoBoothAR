/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure guest-surface URL builders for the Event Concierge's "Test experience"
 * widget. The canonical booth link is `${origin}/e/${slug}` + surface path —
 * the identical pattern used in Concierge.tsx, EventStudio.tsx, ShareKit.tsx.
 * Kept pure so it's node-tested and importable anywhere.
 */

/** `${origin}/e/${slug}` — the event root a guest QR points at. */
export function eventUrl(origin: string, slug: string): string {
  return `${origin}/e/${slug}`;
}

/** The general booth surface (the guest picks any published experience). */
export function boothUrl(origin: string, slug: string): string {
  return `${eventUrl(origin, slug)}/booth`;
}

/** Deep link that opens the booth straight to one saved experience
 *  (guest route `/e/:slug/experience/:id`). */
export function experienceUrl(origin: string, slug: string, experienceId: string): string {
  return `${eventUrl(origin, slug)}/experience/${experienceId}`;
}

/** The signage/landing surface (instructions before the booth). */
export function welcomeUrl(origin: string, slug: string): string {
  return `${eventUrl(origin, slug)}/welcome`;
}
