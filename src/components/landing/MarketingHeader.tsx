/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The public marketing chrome's sticky top bar, hoisted out of Landing.tsx
 * unchanged so every public page (landing, guides) carries the same header.
 *
 * `anchorBase` is what makes it portable: Landing renders it with '' so #demo
 * and #pricing stay same-page jumps, while another route passes '/' to send
 * them to '/#demo' on the landing page.
 */
import { Link } from 'react-router-dom';

export default function MarketingHeader({
  active,
  anchorBase = '',
}: {
  active?: 'demo' | 'pricing' | 'guides';
  anchorBase?: string;
}) {
  // Landing passes no `active`, so its rendered markup is byte-identical to
  // what shipped; a page that names itself only swaps the muted link colour.
  const navLink = (id: 'demo' | 'pricing' | 'guides') =>
    `hidden sm:inline rounded-full px-4 py-2 font-label uppercase tracking-luxe text-[10px] font-semibold ${
      active === id ? 'text-brand-fg' : 'text-brand-muted/70'
    } hover:text-brand-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]`;

  return (
    <header className="sticky top-0 z-40 -mx-6 flex items-center justify-between border-b border-white/5 bg-brand-bg/70 px-6 py-3 backdrop-blur-md">
      <span className="font-serif text-xl sm:text-2xl font-semibold tracking-wide text-foil-static">Beamwall</span>
      <nav className="liquid-glass flex items-center gap-1.5 rounded-full p-1.5">
        <a href={`${anchorBase}#demo`} className={navLink('demo')}>
          Demo
        </a>
        <a href={`${anchorBase}#pricing`} className={navLink('pricing')}>
          Pricing
        </a>
        {/* Same hidden-below-sm treatment as Demo/Pricing, so the 390px pill
            collision noted below is untouched — the nav items are not rendered
            at that width at all. A route, so a <Link>, not an anchor. */}
        <Link to="/guides" className={navLink('guides')}>
          Guides
        </Link>
        {/* Sign in stays reachable on phones too (tighter padding <sm);
            Create your event keeps the primary treatment. Both pills are
            nowrap with a short signup label <sm — at 390px the wrapped
            two-line pills collided with the wordmark. */}
        <Link
          to="/login"
          className="inline-flex whitespace-nowrap rounded-full border border-white/15 bg-white/[0.04] px-3 py-2 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-fg transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] sm:px-5"
        >
          Sign in
        </Link>
        <Link
          to="/signup"
          className="whitespace-nowrap rounded-full bg-foil px-3 py-2 font-label uppercase tracking-luxe text-[10px] font-bold text-white glow-accent transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] sm:px-5"
        >
          <span className="sm:hidden">Create event</span>
          <span className="hidden sm:inline">Create your event</span>
        </Link>
      </nav>
    </header>
  );
}
