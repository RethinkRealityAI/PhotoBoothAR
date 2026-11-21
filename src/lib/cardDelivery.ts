/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Scheduled card delivery — the pure half (no React, no supabase import, so
 * cardDelivery.test.ts runs in vitest's node env).
 *
 * A host picks a DATE, a TIME and the TIMEZONE they mean it in ("9 am on Mum's
 * birthday, Lagos time"). That wall-clock reading becomes one UTC instant
 * (cards.deliver_at); the zone is kept for display only. At that instant the
 * card-publish edge function (deliver_due, migration 047) closes the card to
 * new contributions, publishes it and emails the recipient.
 *
 * The server re-validates the instant (1 min – 400 days out); the window here
 * is deliberately a little stricter (5 min) so a host never schedules a time
 * that will have passed by the time they finish reading the confirmation.
 */
import { formatSlotLong, isValidTimeZone, TIMEZONE_OPTIONS, tzCity, wallTime, zonedWallTimeToUtc } from './booking';

export const DEFAULT_SEND_TIME = '09:00';
export const MIN_LEAD_MS = 5 * 60_000;
export const MAX_LEAD_MS = 400 * 24 * 60 * 60 * 1000;

export type DeliveryState = 'scheduled' | 'sending' | 'sent' | 'failed';

/** The delivery columns of a cards row (047). */
export interface DeliveryFields {
  deliver_at: string | null;
  deliver_time_zone: string | null;
  delivery_state: DeliveryState | string | null;
  delivery_error: string | null;
  delivered_at: string | null;
}

export type ScheduleProblem = 'invalid' | 'past' | 'too_soon' | 'too_far';

/**
 * The UTC instant for a wall-clock date + time in `tz`, or null when the input
 * is malformed or names a time that does not exist (a spring-forward gap).
 * Inputs are the raw <input type=date|time> values: 'YYYY-MM-DD' and 'HH:MM'.
 */
export function scheduleInstant(date: string, time: string, tz: string): number | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (dm === null || tm === null || !isValidTimeZone(tz)) return null;
  const y = Number(dm[1]);
  const mo = Number(dm[2]);
  const d = Number(dm[3]);
  const h = Number(tm[1]);
  const mi = Number(tm[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const minutes = h * 60 + mi;
  const ms = zonedWallTimeToUtc(y, mo, d, minutes, tz);
  // Round-trip: rejects Feb 30 (rolls to March) and DST-gap times alike.
  const w = wallTime(ms, tz);
  if (w.y !== y || w.mo !== mo || w.d !== d || w.minutes !== minutes) return null;
  return ms;
}

export function scheduleProblem(ms: number | null, nowMs: number): ScheduleProblem | null {
  if (ms === null || !Number.isFinite(ms)) return 'invalid';
  if (ms <= nowMs) return 'past';
  if (ms < nowMs + MIN_LEAD_MS) return 'too_soon';
  if (ms > nowMs + MAX_LEAD_MS) return 'too_far';
  return null;
}

export function scheduleProblemCopy(p: ScheduleProblem): string {
  switch (p) {
    case 'invalid':
      return 'Pick a date and a time that exists.';
    case 'past':
      return 'That moment has already passed. Pick a time in the future.';
    case 'too_soon':
      return 'Pick a time at least 5 minutes from now, or use Email now instead.';
    case 'too_far':
      return 'Cards can be scheduled up to about a year ahead.';
  }
}

/** Date + time input values for an instant, read in `tz` (editing a schedule). */
export function inputValuesFor(ms: number, tz: string): { date: string; time: string } {
  const w = wallTime(ms, isValidTimeZone(tz) ? tz : 'UTC');
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${w.y}-${pad(w.mo)}-${pad(w.d)}`,
    time: `${pad(Math.floor(w.minutes / 60))}:${pad(w.minutes % 60)}`,
  };
}

/** The zone choices: the short curated list, with the viewer's own zone first
 *  when it is not already on it (so the default is always selectable). */
export function timeZoneChoices(viewerTz: string): { id: string; label: string }[] {
  const list = TIMEZONE_OPTIONS.map((o) => ({ ...o }));
  if (isValidTimeZone(viewerTz) && !list.some((o) => o.id === viewerTz)) {
    list.unshift({ id: viewerTz, label: tzCity(viewerTz) });
  }
  return list;
}

/** "Thursday 3 December, 9:00 am (Lagos time)". */
export function formatDelivery(ms: number, tz: string | null): string {
  const zone = tz !== null && isValidTimeZone(tz) ? tz : 'UTC';
  return `${formatSlotLong(ms, zone)} (${tzCity(zone)} time)`;
}

/** "today" / "tomorrow" / "in 12 days" / "in 3 hours" — coarse on purpose. */
export function relativeWhen(ms: number, nowMs: number): string {
  const diff = ms - nowMs;
  if (diff <= 0) return 'any moment now';
  const hours = diff / 3_600_000;
  if (hours < 1) {
    const mins = Math.max(1, Math.round(diff / 60_000));
    return `in ${mins} minute${mins === 1 ? '' : 's'}`;
  }
  if (hours < 24) {
    const h = Math.round(hours);
    return `in ${h} hour${h === 1 ? '' : 's'}`;
  }
  const days = Math.round(hours / 24);
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

/** Host-facing copy for a delivery_error code written by card-publish. */
export function deliveryErrorCopy(code: string | null): string {
  switch (code) {
    case 'email_not_configured':
      return 'Email sending is still being switched on for Beamwall. Your card is safe and will go out automatically as soon as it is.';
    case 'invalid_recipient':
      return 'The recipient email doesn’t look right. Fix it and schedule again.';
    case 'upgrade_required':
      return 'Sending a card needs Premium or above for this event. Upgrade, then schedule again.';
    case 'email_rejected':
      return 'The email provider refused this address. Check it and schedule again.';
    case 'email_failed':
      return 'The last send attempt didn’t go through. We’re retrying automatically.';
    case 'features_unavailable':
    case 'publish_failed':
      return 'We hit a temporary problem and are retrying automatically.';
    default:
      return code ? 'Something went wrong delivering this card.' : '';
  }
}

export type DeliveryKind = 'none' | 'scheduled' | 'waiting' | 'retrying' | 'sending' | 'sent' | 'failed';

export interface DeliveryDescription {
  kind: DeliveryKind;
  /** One line for the card row ("Sends tomorrow"). Empty for 'none'. */
  short: string;
  /** Full sentence for the panel. */
  detail: string;
}

/**
 * What the host should read about this card's delivery right now. A row that
 * is 'scheduled' with an error is mid-retry (or waiting on email setup) — the
 * time it was meant to go has passed, so "Sends in 3 days" would be false.
 */
export function describeDelivery(row: DeliveryFields, nowMs: number): DeliveryDescription {
  const at = row.deliver_at !== null ? Date.parse(row.deliver_at) : NaN;
  const tz = row.deliver_time_zone;
  switch (row.delivery_state) {
    case 'scheduled': {
      if (!Number.isFinite(at)) return { kind: 'none', short: '', detail: '' };
      if (row.delivery_error === 'email_not_configured') {
        return { kind: 'waiting', short: 'Waiting to send', detail: deliveryErrorCopy(row.delivery_error) };
      }
      if (row.delivery_error) {
        return { kind: 'retrying', short: 'Retrying send', detail: deliveryErrorCopy(row.delivery_error) };
      }
      return {
        kind: 'scheduled',
        short: `Sends ${relativeWhen(at, nowMs)}`,
        detail: `Sends ${formatDelivery(at, tz)}.`,
      };
    }
    case 'sending':
      return { kind: 'sending', short: 'Sending now', detail: 'Publishing the card and sending the email right now.' };
    case 'sent': {
      const sent = row.delivered_at !== null ? Date.parse(row.delivered_at) : NaN;
      return {
        kind: 'sent',
        short: 'Delivered',
        detail: Number.isFinite(sent) ? `Delivered ${formatDelivery(sent, tz)}.` : 'Delivered.',
      };
    }
    case 'failed':
      return { kind: 'failed', short: 'Not delivered', detail: deliveryErrorCopy(row.delivery_error) };
    default:
      return { kind: 'none', short: '', detail: '' };
  }
}
