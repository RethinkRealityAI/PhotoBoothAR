/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The dashboard spotlight tour — pure policy, no React, no supabase import.
 * SpotlightTour.tsx renders it; EventsList decides when it starts.
 *
 * Persistence: the outcome lives in the auth user's metadata
 * (`onboarding_tour_v1`), so it follows the host across devices with no
 * migration; localStorage is only a fast cache so a reload does not flash the
 * tour before the session user has been read.
 */

/** A tour stop. `target` is the value of a `data-tour` attribute on the page. */
export interface TourStep {
  target: string;
  title: string;
  body: string;
}

export const TOUR_METADATA_KEY = 'onboarding_tour_v1';
export const TOUR_CACHE_KEY = 'beamwall.onboardingTour.v1';
/** Long enough for covers and the lazily mounted assistant button to appear. */
export const TOUR_START_DELAY_MS = 800;

export type TourOutcome = 'done' | 'skipped';

export const DASHBOARD_TOUR: readonly TourStep[] = [
  {
    target: 'share',
    title: 'Share the QR',
    body: 'Share the QR: print it or put it on screens. Guests need no app.',
  },
  {
    target: 'manage',
    title: 'Manage your event',
    body: 'Change looks, challenges and the live wall any time, even during the event.',
  },
  {
    target: 'assistant',
    title: 'Ask Beamy',
    body: 'Ask Beamy to change anything in plain words.',
  },
];

/** Reads a stored outcome; anything else (absent, null, a typo) is "not yet". */
export function parseTourOutcome(v: unknown): TourOutcome | null {
  return v === 'done' || v === 'skipped' ? v : null;
}

/** The outcome from the auth user's metadata object, if any. */
export function tourOutcomeFromMetadata(meta: unknown): TourOutcome | null {
  if (meta === null || typeof meta !== 'object') return null;
  return parseTourOutcome((meta as Record<string, unknown>)[TOUR_METADATA_KEY]);
}

/**
 * Show the tour once: the host has at least one LIVE event and has neither
 * finished nor skipped it (on this device's cache OR in their account).
 */
export function shouldShowTour(input: {
  eventStatuses: readonly string[];
  metadataOutcome: TourOutcome | null;
  cachedOutcome: TourOutcome | null;
}): boolean {
  if (input.metadataOutcome !== null || input.cachedOutcome !== null) return false;
  return input.eventStatuses.some((s) => s === 'live');
}

/** Keeps only the stops whose target is on the page right now. */
export function availableSteps(steps: readonly TourStep[], isPresent: (target: string) => boolean): TourStep[] {
  return steps.filter((s) => isPresent(s.target));
}

/** Clamps a step index into [0, count-1]; 0 when there are no steps. */
export function clampStep(i: number, count: number): number {
  if (count <= 0 || !Number.isFinite(i)) return 0;
  return Math.min(Math.max(Math.trunc(i), 0), count - 1);
}

export function nextStep(i: number, count: number): number {
  return clampStep(i + 1, count);
}

export function prevStep(i: number, count: number): number {
  return clampStep(i - 1, count);
}

export function isLastStep(i: number, count: number): boolean {
  return count > 0 && i >= count - 1;
}

/** "Step 2 of 3". */
export function stepLabel(i: number, count: number): string {
  return `Step ${clampStep(i, count) + 1} of ${Math.max(count, 1)}`;
}

/** A rectangle in viewport px. */
export interface Rect { top: number; left: number; width: number; height: number }

/**
 * Where the popover goes: below the target when it fits, else above, clamped
 * into the viewport with a gutter on every side so it never overflows a
 * 390px phone. Width shrinks to the viewport minus both gutters.
 */
export function placePopover(
  target: Rect,
  pop: { width: number; height: number },
  viewport: { width: number; height: number },
  opts: { gutter?: number; gap?: number } = {},
): { top: number; left: number; width: number; side: 'below' | 'above' } {
  const gutter = opts.gutter ?? 16;
  const gap = opts.gap ?? 12;
  const width = Math.max(0, Math.min(pop.width, viewport.width - gutter * 2));
  const centre = target.left + target.width / 2;
  const maxLeft = Math.max(gutter, viewport.width - gutter - width);
  const left = Math.min(Math.max(centre - width / 2, gutter), maxLeft);
  const below = target.top + target.height + gap;
  const above = target.top - gap - pop.height;
  const fitsBelow = below + pop.height <= viewport.height - gutter;
  const fitsAbove = above >= gutter;
  const side: 'below' | 'above' = fitsBelow || !fitsAbove ? 'below' : 'above';
  const raw = side === 'below' ? below : above;
  const maxTop = Math.max(gutter, viewport.height - gutter - pop.height);
  const top = Math.min(Math.max(raw, gutter), maxTop);
  return { top, left, width, side };
}
