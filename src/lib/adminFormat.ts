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

/**
 * An audit action as English: `set_event_status` → "Set event status".
 *
 * Derived rather than looked up in a maintained table, on purpose. A new action
 * added to admin-api should read correctly on the audit screen the day it ships
 * — a word list would instead show the raw enum until someone remembered to
 * update it, which is exactly how `past_due` ended up on an operator's screen.
 */
export function auditActionLabel(action: string | null | undefined): string {
  const raw = (action ?? '').trim().replace(/[_-]+/g, ' ');
  if (!raw) return '—';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/**
 * The `meta` blob as a readable line: `{delta: 25, reason: "goodwill"}` →
 * "delta 25 · reason goodwill".
 *
 * It was rendered as `JSON.stringify(meta)`, so the detail an operator most
 * needs — how many credits, which status — arrived wrapped in braces, quotes
 * and escapes inside a truncated 10px cell. Nested values fall back to compact
 * JSON rather than being dropped: an unreadable value beats a missing one on an
 * audit trail.
 */
export function auditMetaSummary(meta: Record<string, unknown> | null | undefined): string {
  if (meta === null || meta === undefined) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(meta)) {
    if (value === null || value === undefined) continue;
    const shown = typeof value === 'object' ? JSON.stringify(value) : String(value);
    parts.push(`${key.replace(/[_-]+/g, ' ')} ${shown}`);
  }
  return parts.join(' · ');
}

/** Short absolute date ("Jul 6, 2026"). Empty/invalid → em dash. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(t));
}
