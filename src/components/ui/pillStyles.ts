/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared status → pill styling. Consolidates the three copy-pasted `statusPill`
 * helpers (host EventsList/EventStudio use the event lifecycle; CardsTab uses the
 * greeting-card lifecycle) into one tone map, and extends it with the states the
 * admin suite needs (orders, subscriptions, users). Pure — unit tested.
 */
export type PillTone = 'success' | 'warn' | 'danger' | 'info' | 'special' | 'muted' | 'neutral';

/** Exact classes preserved from the original three helpers, plus `danger`. */
const TONE_CLASS: Record<PillTone, string> = {
  success: 'bg-emerald-500/15 text-emerald-400',
  warn: 'bg-amber-500/15 text-amber-400',
  danger: 'bg-rose-500/15 text-rose-300',
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
  // Platform-admin marker on /admin/users. `special` is the purple the screen
  // already hand-rolled for it, so the pill looks identical — it just stops
  // being a second copy of StatusPill's classes.
  admin: 'special',
  // A disputed charge is money being clawed back with a deadline attached. It
  // had no entry at all, so it fell through to `neutral` and read as an
  // ordinary unknown grey on the one screen where it needs to be the loudest
  // thing on the row.
  disputed: 'danger',
  uncollectible: 'danger',
};

/**
 * The pill's human label.
 *
 * The pill used to render the raw column value, so an operator read `past_due`
 * — a database enum leaking straight through the UI. Underscores become spaces;
 * the pill's own CSS uppercases the result, so "PAST DUE" needs no word list to
 * maintain and a status added server-side still reads as English rather than
 * breaking the screen.
 */
export function statusLabel(status: string | null | undefined): string {
  if (status === null || status === undefined) return '';
  return status.trim().replace(/[_-]+/g, ' ');
}

export function statusTone(status: string | null | undefined): PillTone {
  if (!status) return 'neutral';
  return STATUS_TONE[status.toLowerCase()] ?? 'neutral';
}

/** The background/text classes for a status (no layout — the component adds that). */
export function pillClass(status: string | null | undefined): string {
  return TONE_CLASS[statusTone(status)];
}
