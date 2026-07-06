/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Display formatting for the admin suite (currency, counts, dates). Pure —
 * unit tested. Amounts are integer cents everywhere (never floats).
 */

/** Format integer cents as currency. null/NaN → em dash. Unknown code → "N.NN CODE". */
export function formatCents(cents: number | null | undefined, currency = 'usd'): string {
  if (cents == null || Number.isNaN(cents)) return '—';
  const code = (currency || 'usd').toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${code}`;
  }
}

/** Thousands-grouped integer. null/NaN → em dash. */
export function formatCount(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US').format(n);
}

/** Short absolute date ("Jul 6, 2026"). Empty/invalid → em dash. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(t));
}
