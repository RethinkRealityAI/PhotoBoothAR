/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Keepsake curation — deciding what actually ends up in the card.
 *
 * `hidden` is the include/exclude switch a host flips per contribution. The
 * arithmetic around it (how many guests will see, what the filter shows, and
 * whether "Include all" has anything to do) is the part worth testing, so it
 * lives here as pure functions rather than inline in the studio component.
 *
 * Deliberately typed on a minimal row shape, not the full ContributionRow: the
 * only field that decides inclusion is `hidden`, and narrowing it that way lets
 * the tests state the rules without constructing whole rows.
 */

export type CurationFilter = 'all' | 'included' | 'hidden';

export interface CuratableRow {
  hidden: boolean;
}

export interface CurationSummary {
  total: number;
  /** What a guest opening the keepsake will actually see. */
  included: number;
  hidden: number;
  /** "Include all" is only worth offering when something is excluded. */
  canIncludeAll: boolean;
}

export function curationSummary(rows: readonly CuratableRow[]): CurationSummary {
  const total = rows.length;
  const hidden = rows.reduce((n, r) => n + (r.hidden ? 1 : 0), 0);
  const included = total - hidden;
  return { total, included, hidden, canIncludeAll: hidden > 0 };
}

/**
 * The rows a filter shows. Returns the SAME order it was given — the host's
 * manual `sort_order` is the card's running order, so filtering must never
 * reshuffle it.
 */
export function filterContributions<T extends CuratableRow>(
  rows: readonly T[],
  filter: CurationFilter,
): T[] {
  if (filter === 'all') return [...rows];
  const wantHidden = filter === 'hidden';
  return rows.filter((r) => r.hidden === wantHidden);
}

/**
 * Whether the All/In/Hidden filter is worth showing at all. A short card is
 * easier to read as one list than to page through three tabs.
 */
export const FILTER_MIN_ROWS = 4;

export function shouldOfferFilter(rows: readonly CuratableRow[]): boolean {
  return rows.length >= FILTER_MIN_ROWS;
}
