/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Keyboard movement for the wizard's tab rows (WizardTabs). Pure, so the
 * WAI-ARIA tablist behaviour is unit-tested: Left / Right step one tab and
 * wrap round, Home and End jump to the ends. Anything else is not ours.
 */

/** The tab index a key moves to, or null when the key does not move tabs. */
export function tabIndexForKey(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  const at = Math.min(Math.max(current, 0), count - 1);
  switch (key) {
    case 'ArrowRight': return (at + 1) % count;
    case 'ArrowLeft': return (at - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}
