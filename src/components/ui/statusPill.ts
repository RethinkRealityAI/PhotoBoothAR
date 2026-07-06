/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared status → pill styling. Consolidates the three copy-pasted `statusPill`
 * helpers (host EventsList/EventStudio use the event lifecycle; CardsTab uses the
 * greeting-card lifecycle) into one tone map, and extends it with the states the
 * admin suite needs (orders, subscriptions, users). Pure — unit tested.
 */
export type PillTone = 'success' | 'warn' | 'info' | 'special' | 'muted' | 'neutral';

/** Exact classes preserved from the original three helpers. */
const TONE_CLASS: Record<PillTone, string> = {
  success: 'bg-emerald-500/15 text-emerald-400',
  warn: 'bg-amber-500/15 text-amber-400',
  info: 'bg-sky-500/15 text-sky-300',
  special: 'bg-purple-500/15 text-purple-300',
  muted: 'bg-white/[0.05] text-brand-muted/40',
  neutral: 'bg-white/[0.08] text-brand-muted/70',
};

const STATUS_TONE: Record<string, PillTone> = {
  // Event lifecycle (EventsList / EventStudio)
  live: 'success',
  ended: 'warn',
  archived: 'muted',
  draft: 'neutral',
  // Greeting-card lifecycle (CardsTab)
  collecting: 'info',
  published: 'success',
  rendered: 'special',
  // Admin: orders / subscriptions / users
  paid: 'success',
  active: 'success',
  refunded: 'warn',
  failed: 'warn',
  past_due: 'warn',
  canceled: 'muted',
  cancelled: 'muted',
  banned: 'muted',
  disabled: 'muted',
};

export function statusTone(status: string | null | undefined): PillTone {
  if (!status) return 'neutral';
  return STATUS_TONE[status.toLowerCase()] ?? 'neutral';
}

/** The background/text classes for a status (no layout — the component adds that). */
export function pillClass(status: string | null | undefined): string {
  return TONE_CLASS[statusTone(status)];
}
