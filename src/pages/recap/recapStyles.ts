/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared class strings for the album page. Every colour reads the `--k-*`
 * variables EventRecap sets from the host's keepsake theme (lib/recapKeepsake),
 * never the platform tokens — the page runs outside EventProvider and an ivory
 * keepsake must not inherit Beamwall's white-on-night glass.
 */

/** A frosted card on the theme's surface colour. */
export const K_GLASS =
  'border border-[color:var(--k-line)] bg-[rgba(var(--k-surface-rgb),0.66)] backdrop-blur-xl shadow-[0_30px_70px_-40px_var(--k-shadow)]';

/** Primary call to action: solid accent, readable ink, soft glow. ≥48px tall. */
export const K_PRIMARY =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[color:var(--k-accent)] px-7 font-label uppercase tracking-luxe text-[11px] text-[color:var(--k-on-accent)] shadow-[0_12px_36px_-14px_rgba(var(--k-accent-rgb),0.85)] transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100';

/** Secondary: hairline pill. ≥44px tall. */
export const K_SECONDARY =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[color:var(--k-line)] bg-[rgba(var(--k-surface-rgb),0.5)] px-5 font-label uppercase tracking-luxe text-[10px] text-[color:var(--k-ink)] transition-colors hover:border-[color:var(--k-accent)] hover:text-[color:var(--k-accent-text)]';

export const K_EYEBROW = 'font-label uppercase tracking-luxe text-[10px] text-[color:var(--k-accent-text)]';
export const K_H2 = 'font-serif italic text-[1.75rem] leading-tight text-[color:var(--k-ink)] sm:text-[2rem]';
export const K_BODY = 'font-sans text-sm leading-relaxed text-[color:var(--k-muted)]';
