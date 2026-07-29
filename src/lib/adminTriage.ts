/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Is anything on fire?" for the /admin overview. Pure — unit tested.
 *
 * Every signal here is derived from data the platform ALREADY returns
 * (`admin_counts` on support-api, `list_orders` and `overview_metrics` on
 * admin-api). Nothing is estimated and nothing is invented: a metric that would
 * need a column the API does not select is described in the UI as missing
 * rather than approximated, because an operator who learns a number is a guess
 * stops reading the whole strip.
 *
 * The `unknown` severity is the point of the module. A read that failed must
 * not render as "all clear" — that is the same class of lie as an empty state
 * on a failed list (see lib/listState.ts), and on this screen it is the more
 * expensive one: nobody investigates a green tile.
 */

export type TriageSeverity = 'critical' | 'warning' | 'calm' | 'unknown';

export type TriageId = 'support' | 'money' | 'live';

export interface TriageSignal {
  id: TriageId;
  label: string;
  /** The headline number, already formatted for display. */
  value: string;
  /** One line saying what the number means, or why it is missing. */
  detail: string;
  severity: TriageSeverity;
  /** Where an operator goes to act on it. */
  to: string;
}

/** Only the order fields triage cares about — deliberately not OrderRow, so
 *  this module stays free of the admin client's Supabase import graph. */
export interface TriageOrder {
  status: string;
}

export interface TriageInput {
  /** null when the support-desk read failed. */
  support: { open: number; unread: number } | null;
  /** Most recent orders, newest first. null when the read failed. */
  recentOrders: TriageOrder[] | null;
  /** How many orders were actually scanned — every money claim is scoped to it. */
  ordersWindow: number;
  /** Events with status 'live'. null when the metrics read failed. */
  liveEvents: number | null;
}

const RANK: Record<TriageSeverity, number> = { critical: 3, warning: 2, unknown: 1, calm: 0 };

function supportSignal(support: TriageInput['support']): TriageSignal {
  if (support === null) {
    return {
      id: 'support', label: 'Support', value: '—', severity: 'unknown',
      detail: 'Couldn’t reach the support desk — this is not "no tickets".',
      to: '/admin/support',
    };
  }
  // Unread outranks open: an open ticket someone has read is being worked;
  // an unread one is a customer talking to nobody.
  if (support.unread > 0) {
    return {
      id: 'support', label: 'Support', value: String(support.unread), severity: 'critical',
      detail: `${support.unread} unread · ${support.open} open`,
      to: '/admin/support',
    };
  }
  if (support.open > 0) {
    return {
      id: 'support', label: 'Support', value: String(support.open), severity: 'warning',
      detail: `${support.open} open, all read`,
      to: '/admin/support',
    };
  }
  return {
    id: 'support', label: 'Support', value: '0', severity: 'calm',
    detail: 'No open tickets', to: '/admin/support',
  };
}

function moneySignal(orders: TriageInput['recentOrders'], window: number): TriageSignal {
  if (orders === null) {
    return {
      id: 'money', label: 'Payments', value: '—', severity: 'unknown',
      detail: 'Couldn’t read orders — this is not "no disputes".',
      to: '/admin/payments',
    };
  }
  let disputed = 0;
  let refunded = 0;
  for (const o of orders) {
    if (o.status === 'disputed') disputed += 1;
    else if (o.status === 'refunded') refunded += 1;
  }
  // The window is always stated. "0 disputes" over the last 50 orders is a
  // different claim from "0 disputes ever", and only one of them is true here.
  const scope = `in the last ${window} order${window === 1 ? '' : 's'}`;
  if (disputed > 0) {
    return {
      id: 'money', label: 'Disputes', value: String(disputed), severity: 'critical',
      detail: `${disputed} disputed ${scope}`, to: '/admin/payments',
    };
  }
  if (refunded > 0) {
    return {
      id: 'money', label: 'Refunds', value: String(refunded), severity: 'warning',
      detail: `${refunded} refunded ${scope}`, to: '/admin/payments',
    };
  }
  return {
    id: 'money', label: 'Payments', value: '0', severity: 'calm',
    detail: `No disputes or refunds ${scope}`, to: '/admin/payments',
  };
}

function liveSignal(liveEvents: TriageInput['liveEvents']): TriageSignal {
  if (liveEvents === null) {
    return {
      id: 'live', label: 'Live now', value: '—', severity: 'unknown',
      detail: 'Couldn’t read event status.', to: '/admin/events',
    };
  }
  // Never a fire on its own — a live event is the product working. It sits in
  // the strip because it is the context for every other number: one disputed
  // order matters more while eight walls are up.
  return {
    id: 'live', label: 'Live now', value: String(liveEvents), severity: 'calm',
    detail: liveEvents === 0 ? 'No events running' : `${liveEvents} wall${liveEvents === 1 ? '' : 's'} running`,
    to: '/admin/events',
  };
}

export function triageSignals(input: TriageInput): TriageSignal[] {
  // Fixed order, never sorted by severity: a strip whose tiles rearrange
  // themselves cannot be scanned by muscle memory, which is the only way an
  // operator reads it on the twentieth day.
  return [
    supportSignal(input.support),
    moneySignal(input.recentOrders, input.ordersWindow),
    liveSignal(input.liveEvents),
  ];
}

/** The single worst thing in the strip. A blind spot never outranks a known fire. */
export function overallSeverity(signals: TriageSignal[]): TriageSeverity {
  let worst: TriageSeverity = 'calm';
  for (const s of signals) if (RANK[s.severity] > RANK[worst]) worst = s.severity;
  return worst;
}

/** One honest sentence for the top of the screen. */
export function triageHeadline(signals: TriageSignal[]): string {
  const worst = overallSeverity(signals);
  if (worst === 'critical') {
    const names = signals.filter((s) => s.severity === 'critical').map((s) => s.label.toLowerCase());
    return `Needs attention: ${names.join(', ')}.`;
  }
  if (worst === 'warning') {
    const names = signals.filter((s) => s.severity === 'warning').map((s) => s.label.toLowerCase());
    return `Worth a look: ${names.join(', ')}.`;
  }
  if (worst === 'unknown') {
    const names = signals.filter((s) => s.severity === 'unknown').map((s) => s.label.toLowerCase());
    return `Can’t confirm ${names.join(', ')} — treat as unknown, not clear.`;
  }
  return 'Nothing needs attention.';
}
