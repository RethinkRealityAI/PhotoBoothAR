/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One line of truth under a CAPPED admin list.
 *
 * Four admin lists are not paged — the promo codes, the admin roster, the
 * feature-flag registry and the billing catalogue. They are small by
 * construction (flags and catalogue rows arrive by migration; only an operator
 * ever adds an admin or a promo), so a Load-more pager on them would be
 * furniture. What they were missing is a ceiling: each one selected its whole
 * table with no limit, so the response size was whatever the table held.
 * admin-api now caps them, and this is what the screen says about that.
 *
 * `listFootnote` in src/lib/serverList.ts is the paged sibling of this string.
 * It is not reused here because it closes with "Search to narrow it down", and
 * none of these four screens has a search box to narrow anything with.
 */

/**
 * Mirrors `REGISTRY_CAP` in supabase/functions/admin-api/index.ts.
 *
 * A second copy of a number is normally how these two drift apart, but this one
 * is only ever compared against rows the server already trimmed: if the server
 * cap were lowered, a screen holding the older value would simply never reach
 * it and would print the plain count — quieter than the truth, never wronger.
 */
export const REGISTRY_CAP = 500;

/**
 * @param shown rows actually received (already capped by the server)
 * @param noun  singular noun for the row, e.g. 'promo code'
 */
export function registryNote(shown: number, noun: string, cap: number = REGISTRY_CAP): string {
  // Nothing to say about an empty list: every one of these screens already has
  // its own "no promo codes yet" copy, and "0 admins." next to it reads as a
  // bug. Same rule as listFootnote.
  if (shown <= 0) return '';
  const plural = shown === 1 ? '' : 's';
  // At the cap the count is the SERVER's ceiling, not the size of the table, so
  // it must not be stated as a total — that is the exact lie this note exists
  // to prevent.
  if (shown >= cap) {
    return `Showing the first ${shown} ${noun}${plural} — the list is capped, so there may be more.`;
  }
  return `${shown} ${noun}${plural}.`;
}
